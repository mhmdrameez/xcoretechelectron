# XCoreTech PC Optimizer

Windows PC optimizer and cleaner built with Electron.

The application ships as the full version. It does not require activation and does not include a purchase or payment flow.

## Features

- Parallel scanning for temporary files, caches, prefetch data, and system residue.
- Safe cleanup pipeline with fallback handling for files that cannot be removed immediately.
- Silent startup auto-clean support.
- Windows startup program management.
- Technician tools for network repair, RAM optimization, and common Windows service fixes.
- Persistent system tray and automatic updates.
- Analytics and live user-count display.

## Architecture

```text
xcoretechelectron/
|-- index.js          # Entry point
|-- main.js           # Electron main process, lifecycle, and IPC
|-- preload.js        # Secure context bridge
|-- renderer.js       # Vanilla JS UI logic
|-- scanner.js        # Parallel directory walker
|-- cleaner.js        # Deletion pipeline
|-- analytics.js      # Tracking engine
|-- updater.js        # Auto-updater
|-- technician.js     # Technician tools
|-- utils.js          # Registry management and path validation
|-- styles.css        # App styling
`-- index.html        # App UI shell
```

## IPC API

| Channel | Direction | Description |
|---|---|---|
| `scan:start` | invoke | Begin parallel directory scan |
| `scan:cancel` | invoke | Cancel the active scan |
| `clean:start` | invoke | Start cleanup |
| `stats:get` | invoke | Get cleanup statistics |
| `system:get` | invoke | Get system information |
| `autostart:get` | invoke | Read startup auto-clean state |
| `autostart:set` | invoke | Enable or disable startup auto-clean |
| `startup:list` | invoke | Read Windows startup entries |
| `startup:setEnabled` | invoke | Enable or disable a startup entry |
| `update:check` | invoke | Check for an update |
| `update:install` | invoke | Restart and install a downloaded update |
| `tech:ramBoost` | invoke | Run RAM optimization |
| `tech:autoFix` | invoke | Run service and cache repair |
| `tech:internetFix` | invoke | Run network repair |

## Development

```powershell
npm start
npm test
npm run pack
```

If Electron tests fail because `ELECTRON_RUN_AS_NODE` is set:

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
npm test
```

## Publishing

Set a GitHub token and run:

```powershell
$env:GH_TOKEN="your_token_here"
npm run release
```

## License

Proprietary License. Copyright 2024 XCoreTech Team.
