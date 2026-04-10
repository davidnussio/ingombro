# Ingombro v0.2.0 — Enhanced Smart Clean 🧹

---

## ✨ What's New

### Improved Smart Clean
- Extended detection to **over 40 removable folder types**, organized by category: Node, Python, Rust, Java, Elixir, Zig, Ruby, PHP, Go, iOS, Flutter, build artifacts, infrastructure, AI/ML, design, video, music, macOS/Windows
- **Tag filtering**: filter Smart Clean items by project type (e.g. Node only, Python only, etc.)
- **Contextual navigation**: the Smart Clean banner and item list update as you navigate into subdirectories, showing only what's relevant to the current folder
- Fixed batch selection with checkboxes
- Fixed button layout

### General improvements
- **Scan interruption handling**: scans can now be cleanly interrupted without leaving inconsistent state
- **Updated translations** for all 7 supported languages
- Migrated to native Bun APIs for filesystem operations
- Various stability and UI fixes

---

## 📋 Supported Smart Clean categories

| Category | Detected folders |
|---|---|
| Node / Bun | `node_modules`, `.parcel-cache`, `.turbo` |
| Frameworks | `.next`, `.nuxt`, `.svelte-kit`, `.astro`, `.angular`, `.docusaurus` |
| Python | `__pycache__`, `.venv`, `venv`, `.tox`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `htmlcov` |
| Rust / Java | `target`, `.gradle` |
| Elixir | `_build`, `deps`, `.elixir_ls` |
| Zig / Haskell | `zig-cache`, `zig-out`, `.stack-work` |
| Ruby / PHP / Go | `vendor`, `.bundle` |
| iOS / Flutter | `Pods`, `.dart_tool`, `.pub-cache` |
| Build artifacts | `build`, `dist`, `.cache` |
| Infrastructure | `.terraform`, `.cdk.out`, `.serverless` |
| AI / ML | `.ipynb_checkpoints`, `mlruns`, `wandb`, `lightning_logs` |
| Design | `RECOVER`, `.affinity-autosave`, `Sketch Previews` |
| Video | `Media Cache`, `Render Cache`, `Render Files`, `proxy` |
| Music / DAW | `Bounced Files`, `Freeze Files`, `Rendered`, `fl_studio_cache` |
| macOS / Windows | `.DS_Store`, `Thumbs.db`, `Desktop.ini` |

---

## ⚠️ macOS Security Notice

Ingombro is not signed with an Apple Developer certificate. If macOS shows a "damaged and can't be opened" warning, run:

```bash
xattr -d com.apple.quarantine /Applications/Ingombro.app
```

---

## 📥 Installation

Download the `.app` from the assets below and drag it into your Applications folder.

---

<details>
<summary>v0.1.0 — First Release 🎉</summary>

### Features
- Scan any directory and visualize disk usage with an interactive **treemap** rendered on Canvas
- Smooth **transition animations** when drilling down into folders
- **Clickable breadcrumb** navigation
- Side panel with file/folder details, text/image preview, type distribution chart
- **Smart Clean**: automatic detection of removable project folders with batch removal
- **Freed space indicator** with session-cumulative counter
- **Path autocomplete** with `~` expansion
- **Cached analysis results** for instant reload
- **Settings**: max cache entries, scan depth, delete mode (Trash / permanent)
- **7 languages**: 🇮🇹 🇬🇧 🇪🇸 🇫🇷 🇩🇪 🇧🇷 🇯🇵

</details>
