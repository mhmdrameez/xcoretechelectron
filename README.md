# XCoreTech PC Optimizer

A desktop cleaner for Windows, macOS and Linux, built with Electron.

## Features

| | Windows | macOS | Linux |
|---|:-:|:-:|:-:|
| Junk cleanup (temp files, browser caches, leftovers) | ✓ | ✓ | ✓ |
| Large file finder with Recycle Bin / Trash or permanent delete | ✓ | ✓ | ✓ |
| Developer caches: npm, pnpm, pip, uv, conda, old temp files, unused Playwright browsers | ✓ | ✓ | ✓ |
| Apps that start at sign-in, with on/off switches | ✓ (registry + Startup folder) | ✓ (LaunchAgents) | ✓ (autostart `.desktop`) |
| Auto-clean when you sign in | ✓ | ✓ | ✓ |
| Internet fix | DNS, Winsock and IP reset | DNS cache flush | DNS cache flush |
| Free up memory, Windows Update & printer fix | ✓ | – | – |
| Automatic updates | ✓ | needs a signed build | AppImage |

System folders (`C:\Windows`, `Program Files`, `/System`, `/usr`, …) are never listed or deleted.

## Downloads

Each [release](https://github.com/mhmdrameez/xcoretechelectron/releases) has:

- **Windows**: `XCoreTech-PC-Optimizer-Setup-<version>.exe` (32- and 64-bit)
- **macOS**: `.dmg` for Apple Silicon (`arm64`) and Intel (`x64`). The app isn't signed with an Apple Developer ID yet, so the first time, right-click the app and choose **Open**.
- **Linux**: `.AppImage` (any distro), `.deb` (Ubuntu, Debian, Mint, Pop!_OS) and `.rpm` (Fedora, openSUSE, RHEL)

## Architecture

```text
xcoretechelectron/
|-- index.js          # Entry point
|-- main.js           # Electron main process, lifecycle, and IPC
|-- preload.js        # Secure context bridge
|-- renderer.js       # Vanilla JS UI logic
|-- platform.js       # Per-OS paths, protected folders and capabilities
|-- scanner.js        # Parallel directory walker for junk files
|-- cleaner.js        # Deletion pipeline
|-- largeFiles.js     # Large file finder
|-- devCaches.js      # Developer cache detection and cleanup
|-- startupItems.js   # Sign-in programs (registry / LaunchAgents / autostart)
|-- technician.js     # Quick fixes
|-- systemInfo.js     # Device and OS details
|-- utils.js          # Auto-start at sign-in, path safety, formatting
|-- analytics.js      # Usage events
|-- updater.js        # Auto-updater
|-- styles.css        # App styling
|-- index.html        # App UI shell
|-- installer/        # NSIS include and macOS after-pack signing hook
`-- .github/workflows # CI tests on all three OSes, and the release build
```

## Development

```bash
npm install
npm start
npm run test:ci
```

`npm run test:ci` runs everything except `tests/technician.spec.js`, which runs the real network and service fixes on your machine, and `tests/stress.spec.js`.

## Releasing

Releases are built by GitHub Actions on Windows, macOS and Linux machines; no personal token is needed.

1. Bump the version: `node pre-dist.js` (also updates the version shown in the app), and edit `release-notes.md`.
2. Commit and push.
3. Tag and push the tag:
   ```bash
   git tag v1.3.33
   git push origin v1.3.33
   ```
4. When the **Release** workflow finishes, open the draft on the Releases page and click **Publish release**. Installed copies then update automatically.

To build locally instead: `npx electron-builder --win` (or `--mac` on a Mac, `--linux` on Linux).

## License

Proprietary License. Copyright 2024 XCoreTech Team.
