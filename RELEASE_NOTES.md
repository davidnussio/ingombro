# Ingombro v1.0.0 🎉

---

## ✨ What's New

### Keyboard shortcuts
- `Backspace` to navigate back to the parent directory
- `Esc` to return to the home screen (or close the info panel if open)

### Smarter delete confirmation
- The delete confirmation message now reflects the current deletion mode: "moved to Trash" vs "irreversible" depending on your settings

### Housekeeping
- Package renamed from `electrobun-disk-scanner` to `ingombro`
- Version bumped to 1.0.0

---

## 📋 Full feature set

- **Interactive treemap** with smooth drill-down animations
- **Clickable breadcrumb** navigation
- **Path autocomplete** with `~` expansion
- **Smart Clean** with 40+ detectable folder types across Node, Python, Rust, Java, Elixir, Zig, Ruby, PHP, Go, iOS, Flutter, build artifacts, infrastructure, AI/ML, design, video, music, macOS/Windows
- **Tag filtering** in Smart Clean by project type
- **Contextual Smart Clean** — banner and items update as you navigate subdirectories
- **File/folder info panel** with size, dates, type distribution chart, text/image preview
- **Freed space indicator** with session-cumulative counter
- **Cached analysis results** for instant reload
- **Settings**: language, max cache entries, scan depth, delete mode (Trash / permanent)
- **7 languages**: 🇮🇹 🇬🇧 🇪🇸 🇫🇷 🇩🇪 🇧🇷 🇯🇵
- **Keyboard shortcuts**: `Backspace` (back), `Esc` (home), `⌘↵` (scan)

---

## ⚠️ macOS Security Notice

Ingombro is not signed with an Apple Developer certificate. If macOS shows a "damaged and can't be opened" warning, run:

```bash
xattr -d com.apple.quarantine /Applications/Ingombro.app
```

---

## 📥 Installation

Download the `.app` from the assets below and drag it into your Applications folder.

Or via Homebrew:

```bash
brew install davidnussio/tap/ingombro
```

---

<details>
<summary>v0.2.0 — Enhanced Smart Clean 🧹</summary>

### Improved Smart Clean
- Extended detection to **over 40 removable folder types**, organized by category
- **Tag filtering**: filter Smart Clean items by project type
- **Contextual navigation**: Smart Clean banner updates as you navigate subdirectories
- Fixed batch selection with checkboxes
- Fixed button layout

### General improvements
- **Scan interruption handling**: scans can now be cleanly interrupted
- **Updated translations** for all 7 supported languages
- Migrated to native Bun APIs for filesystem operations
- Various stability and UI fixes

</details>

<details>
<summary>v0.1.0 — First Release</summary>

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
