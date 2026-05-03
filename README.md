# 🛡️ XCoreTech PC Optimizer

> **Professional, high-performance Windows PC optimizer and cleaner built with Electron.**  
> Maximizes system performance by removing junk from temp, cache, prefetch, and system residue folders. Now featuring enterprise-grade online licensing and autonomous background maintenance.

**Current build:** `1.3.19`

---

## 📸 Screenshot

![XCoreTech PC Optimizer](./screenshot.png)

---

## ✨ Features

- **⚡ Fast Parallel Scanning** — Bounded worker-pool directory walk (6 concurrent workers), Dirent-based stat calls, batch I/O to minimize disk latency.
- **🗑️ Safe Deletion Pipeline** — Cascading fallback: `unlink` → attribute-strip → `shell del` → reboot-schedule.
- **🔒 Pro Licensing** — Online key verification with hardware-bound device linking.
- **💳 Built-in Pro Purchase Flow** — ₹399 lifetime Razorpay checkout for card, UPI, wallet, and netbanking payments.
- **🤖 Autonomous Background Maintenance (PRO)** — Fully silent maintenance cycles triggered on system boot, including auto-scan and auto-clean.
- **Free Startup Visibility** - Free installs open the full app on Windows startup and never run automatic cleaning; Pro installs stay silent and auto-clean in the background.
- **⚡ Windows Startup Manifest (PRO)** — Manage and optimize programs that launch on system boot to accelerate load times, with locked-state UI protection for Free users.
- **🛡️ No Administrator Required** — Runs entirely at the user level (`asInvoker`). No UAC prompts required.
- **📍 Persistent System Tray** — Minimizes to the system tray for constant availability.
- **📊 Real-time Analytics** — Granular event tracking logged to the configured analytics backends for impact monitoring.
- **🚀 CDN-Like Live User Count** — Direct, zero-latency frontend fetch seamlessly animates 100% authentic active user numbers on the dashboard.
- **🔐 High Encryption Storage** — License data is encrypted via Electron `safeStorage` and obfuscated in a binary identity file.
- **🔄 Automated Build Pipeline** — Pre-distribution hooks automatically increment version numbers and dynamically generate customized `release-notes.md` for GitHub.

---

## 🏗️ Architecture

```
xcoretechelectron/
├── index.js          # Entry point
├── main.js           # Electron main process — Licensing, Lifecycle, IPC
├── config.js         # Git-ignored XOR obfuscated credential store
├── preload.js        # Secure context bridge
├── renderer.js       # UI logic — Stateless Vanilla JS rendering
├── scanner.js        # Parallel directory walker
├── cleaner.js        # Deletion pipeline
├── analytics.js      # Tracking engine
├── updater.js        # Silent auto-updater
├── technician.js     # Pro technician tools
├── utils.js          # Registry management & path validation
├── styles.css        # App styling and responsive modal layouts
└── index.html        # App UI shell
```

---

## 🚀 Pro Version Activation

XCoreTech PC Optimizer uses a **high-security online activation system**.

### License Features
- **Online Verification**: Keys are verified instantly against the secure cloud database.
- **Device Binding**: Each license is securely linked to a unique hardware-bound **System Identifier**.
- **Offline Persistence**: Once activated, the Pro state is stored in an encrypted binary file (`license/identity.bin`) protected by OS-level credentials.

### How to Activate
1. Open the application.
2. Click **Activate Pro** in the header.
3. Enter your unique license key (Format: `XCORE-XXXX-XXXX-XXXX`).
4. Upon successful verification, all premium features (Auto-Clean, Startup Manifest) are unlocked immediately.

### Buying a License
Users can open the purchase flow from the activation modal. The payment modal shows the ₹399 lifetime amount and launches Razorpay Standard Checkout. On a successful checkout callback, the app stores the Razorpay payment id in the encrypted local license file and unlocks Pro immediately. Set `RAZORPAY_KEY_ID` in `renderer.js` to your Razorpay live key id before releasing a production build.

### Startup License Behavior
On boot, Free users open the full application window and the cleaner pipeline is never executed automatically. Pro users launch silently from Windows Startup and run the auto-scan and auto-clean maintenance flow in the background.

---

## ⚙️ Configuration

### License Service Integration (High Security)
To protect your database credentials, API keys are XOR-obfuscated and isolated in a dedicated `config.js` file which is strictly ignored by Git (`.gitignore`) to prevent accidental leaks.

If you need to rotate your keys, update the encoded strings in `config.js`:
```js
// config.js is automatically packed by electron-builder, but hidden from GitHub
const SB_URL = _d("..."); // XOR Encoded service URL
const SB_KEY = _d("..."); // XOR Encoded Publishable Key
```

### Database Schema
Create a `licenses` table in your license database with the exact following structure:
- `id` (UUID, PK)
- `key` (Text)
- `used` (Boolean, Default: False)
- `device_id` (Text, Nullable)
- `created_at` (Timestampz, Default: now())

> **Security Note:** Ensure Row Level Security (RLS) is either disabled for the `licenses` table, or that proper `SELECT` and `UPDATE` policies are added for the `anon` role, otherwise the application will return a "License key not found" error during activation.

---

## 📦 Automated Publishing & Updates

XCoreTech PC Optimizer features a completely automated build and update pipeline integrated directly with GitHub Releases.

### Pushing an Auto-Update to Users
When you are ready to ship a new version to your users:
1. Ensure your GitHub Personal Access Token is active.
2. In your terminal, set the token:
   - **Windows (PowerShell):** `$env:GH_TOKEN="your_token_here"`
3. Run the automated release script:
   ```bash
   npm run release
   ```
This command will automatically bump the semantic version, generate detailed release notes, compile the installer, and publish the package to GitHub. Installed applications will silently detect the update in the background and prompt the user to apply it upon the next restart.

### Packaged Runtime DLLs
Electron includes runtime DLLs such as `ffmpeg.dll`, `libEGL.dll`, `libGLESv2.dll`, `d3dcompiler_47.dll`, `vk_swiftshader.dll`, and `vulkan-1.dll`. These files are expected in `node_modules/electron/dist` during development and in generated folders such as `dist/win-unpacked` or `dist/win-ia32-unpacked` after packaging. They are build/runtime artifacts and should not be hand-edited.

---

## 📋 IPC API (Updated)

| Channel | Direction | Description |
|---|---|---|
| `license:get` | invoke | Retrieve current encrypted license state |
| `license:verify` | invoke | Trigger online key validation |
| `scan:start` | invoke | Begin parallel directory scan |
| `clean:start` | invoke | Start deletion pipeline (Pro required for auto-clean) |
| `stats:get` | invoke | Get current session/lifetime stats |
| `system:get` | invoke | Get hardware-bound system identifier |
| `autostart:get` | invoke | Check if Auto-Clean is active |
| `autostart:set` | invoke | Enable/Disable Auto-Clean (Pro required) |
| `startup:list` | invoke | Read Windows startup program entries |
| `startup:setEnabled` | invoke | Enable or disable a startup entry (Pro required) |
| `app:openExternal` | invoke | Open supported payment/proof links safely |
| `update:check` | invoke | Check GitHub Releases for updates |
| `update:install` | invoke | Restart and install a downloaded update |
| `tech:ramBoost` | invoke | Run Pro RAM Boost |
| `tech:autoFix` | invoke | Run Pro service/cache repair |
| `tech:internetFix` | invoke | Run Pro network repair |

---

## 🧠 Performance Optimizations

| Area | Optimization |
|---|---|
| V8 Heap | Optimized for 96MB-128MB low-memory environments |
| GPU | Hardware acceleration disabled to save VRAM |
| Encryption | Hardware-bound `safeStorage` for local persistence |
| Transport | Encrypted HTTPS communication with the license REST API |
| Tests | `PLAYWRIGHT_TEST=1` uses a small temp scan fixture so clean tests stay deterministic and avoid real user cache cleanup |
| Startup behavior | Free boot launches open the app; Pro boot launches stay hidden and run auto-clean |

---

## 🧪 Automated Testing

XCoreTech PC Optimizer utilizes an industry-standard **Playwright** testing suite to ensure all UI features, core performance tasks, and Pro functionalities remain stable without requiring manual testing.

### Running the E2E Test Suite
To automatically launch the application and test all features (Scan, Clean, System Info, Payment Modal, IPC UI, Update UI, and Technician Mode):

```bash
npm test
```

If Electron fails to launch locally with a `--remote-debugging-port` error, clear `ELECTRON_RUN_AS_NODE` before running tests:

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
npm test
```

### Test Coverage
- **Core Features**: Validates parallel scanning engines and safely verifies the cleaning pipeline.
- **Dashboard Features**: Verifies System Information data retrieval and Windows Auto Start registry toggles.
- **Activation and Payment Modals**: Verifies Pro activation UI, locked controls, Razorpay checkout launch options, and support action links.
- **Startup License Behavior**: Verifies Free boot launches open the app without auto-cleaning, while Pro boot launches remain silent for auto-clean.
- **IPC-Driven UI**: Verifies renderer reactions to mocked status, scan, clean, stats, technician, and update events.
- **Static Contracts**: Verifies package scripts, Electron entry point, preload bridge, external-link protocol allowlist, payment constants, and local script loading.
- **Technician Mode (PRO)**: Mocks the PRO environment dynamically (`PLAYWRIGHT_TEST=1`) to automatically test the RAM Boost, Auto Fix, and Internet Fix (piping backend CMD operations straight into the test logs).

---

## 📜 License

**Proprietary License**  
© 2024 XCoreTech Team. All rights reserved.  
Unauthorized copying, modification, or distribution is strictly prohibited.

---

## 👨‍💻 Tech Stack

- **Electron 22** — Core Runtime
- **Vanilla JS/HTML/CSS** — Zero-framework UI
- **GitHub Actions** — CI/CD & Releases
- **Google Apps Script** — Analytics Backend
