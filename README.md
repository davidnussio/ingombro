# Ingombro

<p align="center">
  <img src="assets/icon.png" alt="Ingombro" width="128" />
</p>

<p align="center">
  Analyze disk space and clean up unnecessary directories.
</p>

---

Ingombro is a macOS desktop app built with [Electrobun](https://electrobun.dev/) and [Bun](https://bun.sh/). It scans any directory, visualizes disk usage with an interactive treemap, and helps you free up space by removing bloated project folders like `node_modules`, `target`, `.venv`, build caches, and more.

![Home screen](images/ingombro-1.png)

## Features

### Interactive treemap

Proportional visualization of disk usage. Click any folder to drill down with smooth transition animations.

![Treemap and directory list](images/ingombro-2.png)

### File preview

Side panel with file and folder details: size, dates, type distribution, text and image previews.

![File preview](images/ingombro-3.png)

### Deep navigation

Clickable breadcrumb to jump to any level. On-demand loading of subdirectories for fast scans even on huge directory trees.

![Deep navigation](images/ingombro-4.png)

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

Select the folders to clean and remove them in batch with a single click.

![Smart Clean](images/ingombro-5.png)

## Requirements

- macOS
- [Bun](https://bun.sh/) ≥ 1.0
- [Electrobun](https://electrobun.dev/) CLI

## Quick start

```bash
# Install dependencies
bun install

# Start in development mode
bun run dev

# Canary build
bun run build:canary
```

## Installation

Download the latest release from the [Releases](../../releases) page and drag the app into your Applications folder.

> ⚠️ **macOS Security Notice**
>
> Ingombro is not signed with an Apple Developer certificate, so macOS may show a **"damaged and can't be opened"** warning.
>
> To fix this, open Terminal and run:
>
> ```bash
> xattr -d com.apple.quarantine /Applications/Ingombro.app
> ```
>
> Learn more about [macOS Gatekeeper](https://support.apple.com/en-us/guide/security/sec5599b66df/web).

## Settings

Accessible from the home screen, saved in `~/.ingombro/settings.json`:

- **Max cache entries** — number of scans kept in cache
- **Scan depth** — maximum recursion levels
- **Delete mode** — macOS Trash or permanent deletion

## Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Desktop framework**: [Electrobun](https://electrobun.dev/)
- **Language**: TypeScript
- **UI**: Vanilla HTML/CSS + Canvas (treemap)

## License

See [LICENSE](LICENSE).
