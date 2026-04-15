# Piano di Migrazione: Electrobun → Tauri v2

## Panoramica

Migrazione di **Ingombro** (disk space analyzer) da Electrobun 1.16 a Tauri v2.
Il progetto attuale è composto da ~1160 righe di backend (Bun/TypeScript), ~1650 righe di frontend (TypeScript vanilla + Canvas), ~900 righe CSS, sistema i18n con 7 lingue, e un workflow CI/CD con Homebrew tap.

**Tempo stimato totale: 3–5 giorni** (5–7 se Rust è nuovo)

---

## Fase 0 — Scaffolding (0.5 giorni)

### Inizializzazione progetto

```bash
bun create tauri-app ingombro-tauri --template vanilla-ts
```

### Struttura target

```
ingombro-tauri/
├── src/                          # Frontend (da src/mainview/)
│   ├── index.html
│   ├── index.css
│   ├── index.ts
│   ├── i18n.ts
│   └── i18n/
│       ├── types.ts
│       ├── it.ts, en.ts, es.ts, fr.ts, de.ts, pt.ts, ja.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   └── src/
│       ├── main.rs               # Entry point
│       ├── scanner.rs            # Filesystem scanner
│       ├── cache.rs              # Cache gzip
│       ├── cleanables.rs         # Smart clean detection (~50 regole)
│       ├── settings.rs           # Settings JSON
│       ├── stats.rs              # Stats tracking
│       └── commands.rs           # 18 #[tauri::command] handlers
├── package.json
└── vite.config.ts
```

### Configurazione tauri.conf.json

Mapping delle opzioni principali:

| Electrobun (`electrobun.config.ts`)     | Tauri (`tauri.conf.json`)                          |
|-----------------------------------------|----------------------------------------------------|
| `app.name: "Ingombro"`                  | `productName: "Ingombro"`                          |
| `app.identifier`                        | `identifier: "dev.ingombro.app"`                   |
| `app.version`                           | `version` in `Cargo.toml`                          |
| `titleBarStyle: "hiddenInset"`          | `windows[0].titleBarStyle: "overlay"`              |
| `frame: { width: 1100, height: 750 }`  | `windows[0].width: 1100, height: 750, center: true`|
| `release.baseUrl`                       | Plugin `tauri-plugin-updater`                      |

---

## Fase 1 — Backend Rust (2 giorni)

Il cuore della migrazione. Tutte le funzionalità di `src/bun/index.ts` vanno riscritte in Rust.

### 1.1 — Dipendenze Cargo.toml

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
flate2 = "1"              # sostituto di Bun.gzipSync
glob = "0.3"              # sostituto di Bun.Glob
trash = "5"               # sostituto di osascript trash
walkdir = "2"             # scanning ricorsivo
chrono = "0.4"            # date per stats
dirs = "6"                # homedir cross-platform
tauri-plugin-dialog = "2" # dialog nativi
tauri-plugin-shell = "2"  # comandi shell se necessario
```

### 1.2 — Mapping API Bun → Rust

| Bun API                        | Rust equivalente                              |
|--------------------------------|-----------------------------------------------|
| `Bun.file().json()`           | `std::fs::read_to_string` + `serde_json`      |
| `Bun.write()`                 | `std::fs::write`                               |
| `Bun.gzipSync()` / `gunzipSync()` | `flate2::write::GzEncoder/GzDecoder`     |
| `Bun.Glob`                    | `glob::glob()` o `globset`                     |
| `Bun.hash()`                  | `std::hash::Hasher` o crc32                    |
| `Bun.nanoseconds()`           | `std::time::Instant::now()`                    |
| `Bun.sleep(1)`                | `tokio::time::sleep` (async)                   |
| `Bun.$\`osascript ...\``      | `trash::delete()` crate (cross-platform!)      |
| `readdirSync` + `statSync`    | `std::fs::read_dir` + `fs::metadata`           |
| `rmSync()`                    | `std::fs::remove_dir_all`                      |
| `homedir()`                   | `dirs::home_dir()`                              |
| `join()`, `basename()`        | `std::path::PathBuf`, `.file_name()`           |

### 1.3 — I 18 command handler da implementare

Ogni handler RPC diventa una funzione `#[tauri::command]`:

```rust
#[tauri::command]
async fn scan_directory(dir_path: String, app: tauri::AppHandle) -> Result<ScanResult, String> {
    // ...
}
```

Lista completa:

| # | Handler                | Complessità | Note                                           |
|---|------------------------|-------------|-------------------------------------------------|
| 1 | `scan_directory`       | Alta        | Scanner ricorsivo async + progress events       |
| 2 | `get_children`         | Media       | Lookup nella cache in-memory                    |
| 3 | `delete_entry`         | Bassa       | `trash::delete()` o `fs::remove_dir_all`        |
| 4 | `get_cache_list`       | Bassa       | Lettura cache store                             |
| 5 | `delete_cache_entry`   | Bassa       | Rimozione entry dalla cache                     |
| 6 | `list_dir`             | Media       | Autocomplete path con filtro                    |
| 7 | `validate_path`        | Bassa       | `fs::metadata().is_dir()`                       |
| 8 | `get_settings`         | Bassa       | Lettura JSON                                    |
| 9 | `save_settings`        | Bassa       | Scrittura JSON                                  |
| 10| `detect_cleanables`    | Alta        | Port delle ~50 regole + sentinel detection      |
| 11| `get_cached_cleanables`| Bassa       | Lookup cache                                    |
| 12| `save_cached_cleanables`| Bassa      | Update cache                                    |
| 13| `batch_delete`         | Media       | Loop delete + aggiornamento cache               |
| 14| `get_entry_info`       | Media       | Stat + preview testo/immagine                   |
| 15| `cancel_scan`          | Bassa       | Flag atomico `AtomicBool`                       |
| 16| `get_stats`            | Bassa       | Lettura stats JSON                              |
| 17| `record_deletion`      | Bassa       | Aggiornamento stats                             |

### 1.4 — Progress events (scanProgress)

Electrobun usa `rpc.send.scanProgress()`. In Tauri:

```rust
// Backend
app.emit("scan-progress", ScanProgress { current_dir: dir.clone() })?;

// Frontend
import { listen } from "@tauri-apps/api/event";
await listen("scan-progress", (event) => {
    updateProgressUI(event.payload.current_dir);
});
```

### 1.5 — Cleanable rules

Le ~50 regole in `CLEANABLE_RULES` vanno portate in una struct Rust:

```rust
struct CleanableRule {
    project_type: &'static str,
    category: Category,
    sentinels: &'static [&'static str],
    risk: RiskLevel,
    note: Option<&'static str>,
}

static RULES: phf::Map<&str, CleanableRule> = phf_map! {
    "node_modules" => CleanableRule { category: Dev, project_type: "Node / Bun", risk: Low, sentinels: &["package.json"], note: None },
    // ... tutte le altre regole
};
```

Questo è il blocco più tedioso ma meccanico — è un port 1:1 della HashMap TypeScript.

---

## Fase 2 — Frontend (1 giorno)

### 2.1 — File riusabili al 100% (zero modifiche)

- `index.css` (~900 righe) — copia diretta
- `i18n/types.ts` — copia diretta
- `i18n/it.ts`, `en.ts`, `es.ts`, `fr.ts`, `de.ts`, `pt.ts`, `ja.ts` — copia diretta
- `i18n.ts` — copia diretta

### 2.2 — index.html — Modifiche minime

```diff
- <link rel="stylesheet" href="views://mainview/index.css" />
+ <link rel="stylesheet" href="/index.css" />

- <img class="welcome-icon" src="views://mainview/assets/icon.png" />
+ <img class="welcome-icon" src="/assets/icon.png" />

- <script type="module" src="views://mainview/index.js"></script>
+ <script type="module" src="/index.ts"></script>
```

Nota: ci sono 6 `<div id="statsWidget">` duplicati nell'HTML attuale — da pulire durante la migrazione.

### 2.3 — index.ts — Sostituzione layer RPC

Rimuovere:
```typescript
// RIMUOVERE
import Electrobun, { Electroview } from "electrobun/view";
const rpc = Electroview.defineRPC<AppRPC>({ ... });
const electrobun = new Electrobun.Electroview({ rpc });
```

Aggiungere:
```typescript
// AGGIUNGERE
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
```

### 2.4 — Find & Replace delle chiamate RPC

Tutte le chiamate seguono lo stesso pattern:

```typescript
// PRIMA (Electrobun)
const result = await electrobun.rpc?.request?.scanDirectory({ dirPath });

// DOPO (Tauri)
const result = await invoke<ScanResult>("scan_directory", { dirPath });
```

Lista completa delle sostituzioni (18 chiamate):

| Electrobun                                          | Tauri                                                        |
|-----------------------------------------------------|--------------------------------------------------------------|
| `electrobun.rpc?.request?.scanDirectory({...})`     | `invoke("scan_directory", {...})`                            |
| `electrobun.rpc?.request?.getChildren({...})`       | `invoke("get_children", {...})`                              |
| `electrobun.rpc?.request?.deleteEntry({...})`       | `invoke("delete_entry", {...})`                              |
| `electrobun.rpc?.request?.getCacheList({})`         | `invoke("get_cache_list")`                                   |
| `electrobun.rpc?.request?.deleteCacheEntry({...})`  | `invoke("delete_cache_entry", {...})`                        |
| `electrobun.rpc?.request?.listDir({...})`           | `invoke("list_dir", {...})`                                  |
| `electrobun.rpc?.request?.validatePath({...})`      | `invoke("validate_path", {...})`                             |
| `electrobun.rpc?.request?.getSettings({})`          | `invoke("get_settings")`                                     |
| `electrobun.rpc?.request?.saveSettings({...})`      | `invoke("save_settings", {...})`                             |
| `electrobun.rpc?.request?.detectCleanables({...})`  | `invoke("detect_cleanables", {...})`                         |
| `electrobun.rpc?.request?.getCachedCleanables({...})`| `invoke("get_cached_cleanables", {...})`                    |
| `electrobun.rpc?.request?.saveCachedCleanables({...})`| `invoke("save_cached_cleanables", {...})`                  |
| `electrobun.rpc?.request?.batchDelete({...})`       | `invoke("batch_delete", {...})`                              |
| `electrobun.rpc?.request?.getEntryInfo({...})`      | `invoke("get_entry_info", {...})`                            |
| `electrobun.rpc?.request?.cancelScan({})`           | `invoke("cancel_scan")`                                      |
| `electrobun.rpc?.request?.getStats({...})`          | `invoke("get_stats", {...})`                                 |
| `electrobun.rpc?.request?.recordDeletion({...})`    | `invoke("record_deletion", {...})`                           |

### 2.5 — Messaggi push (events)

```typescript
// PRIMA (Electrobun)
// Definito nel defineRPC handlers.messages
scanProgress: ({ currentDir }) => { ... }

// DOPO (Tauri)
await listen("scan-progress", (event: { payload: { currentDir: string } }) => {
    const { currentDir } = event.payload;
    // ... stessa logica UI
});
```

---

## Fase 3 — CI/CD e Release (0.5 giorni)

### 3.1 — Nuovo workflow `.github/workflows/release.yml`

```yaml
name: Build and Release

on:
  release:
    types: [created]
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag della release (es. v1.0.0)"
        required: true

permissions:
  contents: write

jobs:
  build:
    strategy:
      matrix:
        include:
          - platform: macos-latest
            args: --target aarch64-apple-darwin
            label: macos-arm64
          - platform: macos-latest
            args: --target x86_64-apple-darwin
            label: macos-x64
          - platform: ubuntu-22.04
            args: ""
            label: linux
          - platform: windows-latest
            args: ""
            label: windows
    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - name: Build with Tauri
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ inputs.tag || github.event.release.tag_name }}
          releaseName: "Ingombro ${{ inputs.tag || github.event.release.tag_name }}"
          args: ${{ matrix.args }}

  update-homebrew:
    needs: build
    if: ${{ !github.event.release.prerelease }}
    runs-on: ubuntu-latest
    steps:
      # ... stessa logica attuale, aggiornando:
      # - Nome DMG (cambia il pattern generato da Tauri)
      # - zap trash paths (da electrobun a Tauri paths)
```

### 3.2 — Differenze artifacts

| Piattaforma   | Electrobun (attuale)                    | Tauri (nuovo)                                |
|---------------|-----------------------------------------|----------------------------------------------|
| macOS ARM     | `stable-macos-arm64-Ingombro.dmg`       | `Ingombro_x.x.x_aarch64.dmg`                |
| macOS Intel   | —                                       | `Ingombro_x.x.x_x64.dmg`                    |
| Windows       | —                                       | `Ingombro_x.x.x_x64-setup.exe` + `.msi`     |
| Linux         | —                                       | `Ingombro_x.x.x_amd64.deb` + `.AppImage`    |
| Updater       | `stable-macos-arm64-update.json`        | Generato automaticamente da `tauri-action`   |

### 3.3 — Homebrew cask — Aggiornamenti

```diff
  zap trash: [
-   "~/Library/Application Support/ingombro.electrobun.dev",
-   "~/Library/Preferences/ingombro.electrobun.dev.plist",
+   "~/Library/Application Support/dev.ingombro.app",
+   "~/Library/Preferences/dev.ingombro.app.plist",
+   "~/.ingombro",
  ]

- depends_on arch: :arm64
+ # Rimuovere: con Tauri si può buildare anche x64
```

---

## Fase 4 — Testing e Polish (0.5 giorni)

### Checklist pre-release

- [ ] Scan directory funziona e mostra progress
- [ ] Treemap rendering identico (Canvas, stessi colori)
- [ ] Navigazione breadcrumb + back
- [ ] Delete singolo (trash + permanent)
- [ ] Smart Clean detection (tutte le ~50 regole)
- [ ] Batch delete dal modal Smart Clean
- [ ] Cache persistente (gzip JSON in `~/.ingombro/`)
- [ ] Settings persistenti
- [ ] Stats widget
- [ ] i18n (tutte e 7 le lingue)
- [ ] Info panel slide-in
- [ ] Keyboard shortcuts (Backspace, Esc)
- [ ] Toast "spazio liberato"
- [ ] Autocomplete path input
- [ ] Cancel scan
- [ ] Menu applicazione (Cmd+C, Cmd+V, Cmd+Q)
- [ ] Titlebar hiddenInset
- [ ] Build macOS ARM
- [ ] Build macOS Intel
- [ ] Build Windows
- [ ] Build Linux
- [ ] Auto-updater funzionante
- [ ] Homebrew tap aggiornato

---

## Benefici post-migrazione

| Aspetto              | Electrobun (ora)                | Tauri (dopo)                              |
|----------------------|---------------------------------|-------------------------------------------|
| Piattaforme          | Solo macOS ARM                  | macOS ARM + Intel, Windows, Linux         |
| Bundle size          | ~80MB (Chromium embedded)       | ~8-15MB (WebView nativo)                  |
| Backend performance  | Bun (V8 JIT)                    | Rust (compilato, zero GC)                 |
| Ecosistema           | Piccolo, v1.x                   | Enorme, v2 stabile, 80k+ GitHub stars    |
| Auto-updater         | Custom (`update.json`)          | Plugin ufficiale con signing              |
| Signing              | Manuale                         | Integrato nel build                       |
| Plugin               | Limitati                        | 20+ plugin ufficiali                      |
| Trash                | `osascript` (solo macOS)        | `trash` crate (cross-platform)            |
| CI/CD                | 1 target                        | 4 target con `tauri-action`               |

## Rischi e mitigazioni

| Rischio                                    | Mitigazione                                              |
|--------------------------------------------|----------------------------------------------------------|
| Rust learning curve                        | Le operazioni sono I/O-bound, Rust idiomatico è sufficiente |
| WebView inconsistenze cross-platform       | Testare su Safari (macOS), Edge WebView2 (Win), WebKitGTK (Linux) |
| Performance scanner diversa                | Rust sarà più veloce; benchmark prima/dopo               |
| Perdita funzionalità Bun-specifiche        | Tutte hanno equivalenti Rust maturi                      |
| `stat.blocks` non disponibile su Windows   | Usare `metadata().len()` come fallback                   |
