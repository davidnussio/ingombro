# Disk Scanner — Miglioramenti

- [x] **T001 — Animazione di transizione nel treemap** — Fade/zoom-in animato quando si naviga dentro una cartella, invece del salto brusco attuale.
- [x] **T002 — Breadcrumb di navigazione** — Breadcrumb cliccabile al posto del singolo nome + freccia indietro (es. `Developer > github > repos`), per saltare a qualsiasi livello.
- [x] **T003 — Indicatore di spazio risparmiato** — Toast/badge dopo ogni eliminazione ("Hai liberato 2.3 GB") con counter cumulativo nella sessione.
- [ ] **T004 — Filtro rapido nella lista** — Campo di ricerca sopra la dir-list per filtrare le cartelle per nome.
- [x] **T005 — Keyboard shortcuts** — `Backspace` per tornare indietro, `Esc` per tornare alla home.
- [ ] **T006 — Hover highlight sincronizzato** — Evidenziare il rettangolo nel treemap al passaggio del mouse sulla lista (e viceversa).
- [x] **T007 — Smart clean suggestions** — Riconoscimento automatico di cartelle "pulibili" nei progetti:
  - `node_modules` → progetto Node/Bun (se presente `package.json`)
  - `__pycache__`, `.venv`, `venv`, `.tox` → progetto Python (se presente `requirements.txt` o `pyproject.toml`)
  - `target` → progetto Rust (se presente `Cargo.toml`)
  - `build`, `dist`, `.next`, `.nuxt` → artefatti di build
  - `.cache`, `.parcel-cache` → cache di tool
  - `Pods` → progetto iOS (se presente `Podfile`)
  Banner/badge nella lista con "Puoi liberare X GB" e pulsante "Pulisci progetti" per eliminare in batch.
- [x] **T008 — Fix border-radius treemap** — I rettangoli agli angoli del treemap hanno un radius (4px) non coerente con il container (12px), creando un gap visivo scuro negli angoli. I rettangoli che toccano i bordi del container devono avere un radius che segue quello esterno.
- [x] **T009 — Resta nella directory dopo eliminazione** — Dopo aver eliminato un elemento, la vista non deve spostarsi: rimanere nella stessa directory corrente e aggiornare solo la lista e il treemap rimuovendo l'elemento cancellato.
- [x] **T010 — Impostazioni + Rinomina in Ingombro** — Rinominare l'app in "Ingombro". Aggiungere nella pagina iniziale una sezione impostazioni sempre visibile con:
  - Numero massimo di entry nella cache
  - Modalità eliminazione: cestino o eliminazione definitiva
  Salvare le impostazioni in `~/.ingombro/settings.json`.
