# 🛡️ XCoreTech Disk Cleaner

> **Lightweight, high-performance Windows disk cleaner built with Electron.**  
> Removes junk from temp, cache, prefetch, and system residue folders — fast, safe, and with near-native resource usage.

---

## 📸 Screenshot

![XCoreTech Disk Cleaner](./screenshot.png)

---

## ✨ Features

- **⚡ Fast Parallel Scanning** — Bounded worker-pool directory walk (8 concurrent workers), Dirent-based stat calls, batch I/O to minimize disk latency
- **🗑️ Safe Deletion Pipeline** — Cascading fallback: `unlink` → attribute-strip → `shell del` → reboot-schedule, with 12-second timeout guard
- **🛡️ Trusted Users Badge** — Live community counter showing how many unique devices trust XCoreTech, powered by Google Sheets + Apps Script
- **📊 Session Impact Cards** — Real-time stats: total bytes freed, number of runs, average clean time, estimated speed boost
- **🔄 Auto-Clean on Startup** — Optional Windows registry integration to run a silent clean at login (`--autoclean` flag)
- **📍 System Tray** — Minimizes to tray instead of closing; single-instance lock prevents duplicates
- **🔒 Context Isolation** — `contextIsolation: true`, `nodeIntegration: false`, secure preload bridge
- **🔁 Auto-Update** — `electron-updater` + GitHub Releases: silent background download, amber banner notification, one-click restart-and-install
- **💾 Zero Cache / Fully Stateless** — No localStorage, no file-based cache. Every launch is a clean slate
- **🖥️ 32-bit & 64-bit Builds** — Single NSIS installer auto-selects the correct arch

---

## 🏗️ Architecture

```
xcoretechelectron/
├── index.js          # Entry point (requires main.js)
├── main.js           # Electron main process — IPC, window, tray, scan/clean orchestration
├── preload.js        # Secure context bridge (contextIsolation)
├── renderer.js       # UI logic — fully stateless, RAF-throttled, fire-and-forget analytics
├── scanner.js        # Parallel directory walker — 8-worker bounded pool
├── cleaner.js        # Deletion pipeline — native → shell → reboot fallback
├── analytics.js      # Google Sheets analytics — fire-and-forget, no queue
├── systemInfo.js     # OS/CPU/RAM snapshot (os module)
├── location.js       # IP geolocation with file cache
├── crashHandler.js   # Uncaught exception handler
├── utils.js          # Registry auto-start, formatBytes, debounce
├── index.html        # App UI shell + embedded CSS
├── styles.css        # Additional styles
└── assets/           # App icons (ICO + PNG)
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- Windows 10/11 (x86 or x64)

### Install

```bash
git clone https://github.com/yourname/xcoretechelectron.git
cd xcoretechelectron
npm install
```

### Run (Development)

```bash
npm start
```

Starts Electron with V8 memory cap (`--max-old-space-size=128 --optimize-for-size`) and GPU sandbox disabled for lowest resource usage.

---

## 📦 Build

### Production Installer (32-bit + 64-bit NSIS)

```bash
npm run dist
```

Output: `dist/XCoreTech Disk Cleaner Setup 1.0.0.exe`  
The NSIS installer auto-selects 32-bit or 64-bit based on the user's Windows.

### Unpacked (no installer)

```bash
npm run pack
```

Output: `dist/win-unpacked/` (x64) and `dist/win-ia32-unpacked/` (x86)

---

## ⚙️ Configuration

### Analytics / Tracking Endpoint

Set the Google Apps Script Web App URL via environment variable:

```bash
set TRACKING_SHEET_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
npm start
```

Or update the hardcoded fallback in `main.js`:

```js
const endpoint = String(process.env.TRACKING_SHEET_URL ||
  "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec").trim();
```

### Google Apps Script (server-side)

Deploy the following script as a Web App (Execute as: Me, Anyone can access):

```javascript
function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (e.parameter.type === "count") {
    var data    = sheet.getDataRange().getValues();
    var devices = {};
    // i = 1 to skip header row
    for (var i = 1; i < data.length; i++) {
      var id = String(data[i][3] || "").trim().toUpperCase();
      if (id) devices[id] = true;
    }
    return ContentService
      .createTextOutput(JSON.stringify({ total: Object.keys(devices).length }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([
    new Date(),
    e.parameter.name     || "",
    e.parameter.phone    || "",
    e.parameter.device   || "",
    e.parameter.os       || "",
    e.parameter.cpu      || "",
    e.parameter.ram      || "",
    e.parameter.free     || "",
    e.parameter.junk     || "",
    e.parameter.event    || "",
    e.parameter.location || "",
    e.parameter.error    || ""
  ]);

  return ContentService.createTextOutput("OK");
}
```

**Sheet columns:** `Time | Name | Phone | Device | OS | CPU | RAM | Free | Junk | Event | Location | Error`

---

## 🧠 Performance Optimizations

| Area | Optimization | Savings |
|---|---|---|
| V8 Heap | `--max-old-space-size=128 --optimize-for-size` | ~40–60% less idle RAM |
| GPU | `app.disableHardwareAcceleration()` | ~30 MB VRAM |
| Scanner | 8-worker parallel walk + Dirent flags | 3–5× faster scan |
| Cleaner | Native `unlink` fast-path before shell fallback | Minimal subprocess overhead |
| Post-clean stat | 64-concurrent `Promise.allSettled` batches | Non-blocking recalculate |
| UI paint | Single RAF frame guard (80ms throttle) | Zero layout thrashing |
| Analytics | Fire-and-forget, no queue, no storage | Zero disk I/O |
| Spellcheck | `spellcheck: false` in webPreferences | Reduced renderer overhead |

---

## 🗂️ Scan Targets

Default paths scanned (Windows):

| Category | Paths |
|---|---|
| User Temp | `%TEMP%`, `%LOCALAPPDATA%\Temp` |
| System Temp | `C:\Windows\Temp` |
| Prefetch | `C:\Windows\Prefetch` |
| Browser Cache | Chrome, Edge, Firefox profile caches |
| Windows Update | `C:\Windows\SoftwareDistribution\Download` |
| Recycle Bin | `C:\$Recycle.Bin` (per-user) |

---

## 🔐 Security

- `contextIsolation: true` — renderer has no direct Node.js access
- `nodeIntegration: false` — no global `require` in renderer
- `sandbox: false` — required for preload, main process remains isolated
- System path blacklist in `utils.js` — prevents deletion of critical OS directories
- All IPC calls validated in main process before execution

---

## 🖥️ Auto-Start (Startup Persistence)

The app can register itself to run at Windows login via the registry:

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
→ XCoreTech Disk Cleaner = "path\to\app.exe --autoclean"
```

Toggle via the **Auto Clean on Startup** checkbox in the UI.  
When launched with `--autoclean`, the app silently scans + cleans then exits after 700ms.

---

## 📋 IPC API (Main ↔ Renderer)

| Channel | Direction | Description |
|---|---|---|
| `scan:start` | invoke | Begin parallel directory scan |
| `scan:cancel` | invoke | Cancel running scan |
| `scan:progress` | push | Live progress updates (debounced 120ms) |
| `scan:done` | push | Scan complete with file list + total bytes |
| `clean:start` | invoke | Start deletion pipeline (shows confirm dialog) |
| `clean:progress` | push | Live deletion progress |
| `clean:done` | push | Clean complete with freed bytes + stats |
| `stats:get` | invoke | Get current session stats snapshot |
| `stats:update` | push | Stats updated (after clean) |
| `analytics:track` | invoke | Fire-and-forget analytics event |
| `analytics:getCounts` | invoke | Fetch trusted user count from sheet |
| `system:get` | invoke | Get OS/CPU/RAM system info |
| `autostart:get` | invoke | Read registry auto-start state |
| `autostart:set` | invoke | Write registry auto-start state |

---

## 📜 License

MIT © XCoreTech

---

## 👨‍💻 Built With

- [Electron](https://electronjs.org/) v22
- [electron-builder](https://www.electron.build/) v24
- [axios](https://axios-http.com/) — analytics HTTP
- Google Apps Script — analytics backend
- Vanilla HTML/CSS/JS — zero frontend framework overhead
