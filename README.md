# 🛡️ XCoreTech PC Optimizer

> **Professional, high-performance Windows PC optimizer and cleaner built with Electron.**  
> Maximizes system performance by removing junk from temp, cache, prefetch, and system residue folders. Now featuring enterprise-grade **Supabase** licensing and autonomous background maintenance.

---

## 📸 Screenshot

![XCoreTech PC Optimizer](./screenshot.png)

---

## ✨ Features

- **⚡ Fast Parallel Scanning** — Bounded worker-pool directory walk (8 concurrent workers), Dirent-based stat calls, batch I/O to minimize disk latency.
- **🗑️ Safe Deletion Pipeline** — Cascading fallback: `unlink` → attribute-strip → `shell del` → reboot-schedule.
- **🔒 Supabase Pro Licensing** — Online key verification with hardware-bound device linking.
- **🤖 Autonomous Background Maintenance (PRO)** — Fully silent maintenance cycles triggered on system boot, including auto-scan and auto-clean.
- **⚡ Windows Startup Manifest (PRO)** — Manage and optimize programs that launch on system boot to accelerate load times.
- **🛡️ No Administrator Required** — Runs entirely at the user level (`asInvoker`). No UAC prompts required.
- **📍 Persistent System Tray** — Minimizes to the system tray for constant availability.
- **📊 Real-time Analytics** — Granular event tracking logged to Google Sheets and Supabase for impact monitoring.
- **🚀 CDN-Like Live User Count** — Direct, zero-latency frontend fetch seamlessly animates 100% authentic active user numbers on the dashboard.
- **🔐 High Encryption Storage** — License data is encrypted via Electron `safeStorage` and obfuscated in a binary identity file.
- **🔄 Automated Build Pipeline** — Pre-distribution hooks automatically increment version numbers and dynamically generate customized `release-notes.md` for GitHub.

---

## 🏗️ Architecture

```
xcoretechelectron/
├── index.js          # Entry point
├── main.js           # Electron main process — Licensing (Supabase), Lifecycle, IPC
├── config.js         # Git-ignored XOR obfuscated credential store
├── preload.js        # Secure context bridge
├── renderer.js       # UI logic — Stateless Vanilla JS rendering
├── scanner.js        # Parallel directory walker
├── cleaner.js        # Deletion pipeline
├── analytics.js      # Tracking engine (Google Sheets + Supabase)
├── updater.js        # Silent auto-updater
├── utils.js          # Registry management & path validation
├── license_generator.js # Tool for generating valid customer keys
└── index.html        # App UI shell
```

---

## 🚀 Pro Version Activation

XCoreTech PC Optimizer uses a **high-security online activation system** powered by Supabase.

### License Features
- **Online Verification**: Keys are verified instantly against the Supabase cloud database.
- **Device Binding**: Each license is securely linked to a unique hardware-bound **System Identifier**.
- **Offline Persistence**: Once activated, the Pro state is stored in an encrypted binary file (`license/identity.bin`) protected by OS-level credentials.

### How to Activate
1. Open the application.
2. Click **Activate Pro** in the header.
3. Enter your unique license key (Format: `XCORE-XXXX-XXXX-XXXX`).
4. Upon successful verification, all premium features (Auto-Clean, Startup Manifest) are unlocked immediately.

---

## ⚙️ Configuration

### Supabase Integration (High Security)
To protect your database credentials, API keys are XOR-obfuscated and isolated in a dedicated `config.js` file which is strictly ignored by Git (`.gitignore`) to prevent accidental leaks.

If you need to rotate your keys, update the encoded strings in `config.js`:
```js
// config.js is automatically packed by electron-builder, but hidden from GitHub
const SB_URL = _d("..."); // XOR Encoded Supabase URL
const SB_KEY = _d("..."); // XOR Encoded Publishable Key
```

### Database Schema
Create a `licenses` table in Supabase with the exact following structure:
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

---

## 📋 IPC API (Updated)

| Channel | Direction | Description |
|---|---|---|
| `license:get` | invoke | Retrieve current encrypted license state |
| `license:verify` | invoke | Trigger Supabase online key validation |
| `scan:start` | invoke | Begin parallel directory scan |
| `clean:start` | invoke | Start deletion pipeline (Pro required for auto-clean) |
| `stats:get` | invoke | Get current session/lifetime stats |
| `system:get` | invoke | Get hardware-bound system identifier |
| `autostart:get` | invoke | Check if Auto-Clean is active |
| `autostart:set` | invoke | Enable/Disable Auto-Clean (Pro required) |

---

## 🧠 Performance Optimizations

| Area | Optimization |
|---|---|
| V8 Heap | Optimized for 96MB-128MB low-memory environments |
| GPU | Hardware acceleration disabled to save VRAM |
| Encryption | Hardware-bound `safeStorage` for local persistence |
| Transport | Encrypted HTTPS communication with Supabase REST API |

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
