# Ingombro v1.0.0 — First Release 🎉

Ingombro is a macOS desktop app to analyze disk space and clean up unnecessary directories. Built with Electrobun and Bun.

---

## ✨ Features

### Disk Analysis
- Scan any directory and visualize disk usage with an interactive **treemap** rendered on Canvas
- Proportional rectangles show relative sizes at a glance
- Click any folder to drill down with smooth **transition animations**

### Navigation
- **Clickable breadcrumb** to jump to any level in the directory tree
- On-demand loading of subdirectories for fast scans even on large directory trees

### File Preview
- Side panel with file and folder details: size, dates, type distribution
- Text and image preview support
- File type distribution chart

### Smart Clean
Automatic detection of removable folders in development projects:

| Type | Detected folders |
|---|---|
| Node / Bun | `node_modules` |
| Python | `__pycache__`, `.venv`, `venv`, `.tox` |
| Rust | `target` |
| iOS | `Pods` |
| Build | `build`, `dist`, `.next`, `.nuxt` |
| Cache | `.cache`, `.parcel-cache` |

- Banner showing total recoverable space
- Batch selection and removal with a single click
- Freed space indicator with session-cumulative counter

### Settings
- Configurable max cache entries
- Adjustable scan depth
- Delete mode: macOS Trash or permanent deletion
- Settings saved in `~/.ingombro/settings.json`

### Internationalization
7 languages supported out of the box:
🇮🇹 Italiano · 🇬🇧 English · 🇪🇸 Español · 🇫🇷 Français · 🇩🇪 Deutsch · 🇧🇷 Português · 🇯🇵 日本語

Automatic detection of system language with manual override.

---

## 🛠 Tech Stack

- **Runtime**: Bun
- **Desktop framework**: Electrobun
- **Language**: TypeScript
- **UI**: Vanilla HTML/CSS + Canvas

---

## ⚠️ macOS Security Notice

Ingombro is not signed with an Apple Developer certificate. If macOS shows a "damaged and can't be opened" warning, run:

```bash
xattr -d com.apple.quarantine /Applications/Ingombro.app
```

---

## 📥 Installation

Download the `.app` from the assets below and drag it into your Applications folder.
