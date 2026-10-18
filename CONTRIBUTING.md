# Contributing to XCoreTech PC Optimizer

Thanks for helping! XCoreTech is free and open source under the
[GNU GPL-3.0](LICENSE). Bug reports, ideas, testing and code are all welcome.

## Ways to help

- **Report a bug**: [open an issue](https://github.com/mhmdrameez/xcoretechelectron/issues/new?template=bug_report.md). Say which system you're on (Windows, macOS or Linux, and which version), what you did, what you expected and what happened. A screenshot helps.
- **Suggest a feature**: [open an issue](https://github.com/mhmdrameez/xcoretechelectron/issues/new?template=feature_request.md) describing the problem you want solved.
- **Test on your system**: trying a release on a Mac or a Linux distro we haven't covered, and telling us how it went, is very useful.
- **Send code**: fix a bug, add a browser or developer cache to clean, improve the wording. See below.

## Run it from source

You need [Node.js](https://nodejs.org/) 20 or newer and git.

```bash
git clone https://github.com/mhmdrameez/xcoretechelectron.git
cd xcoretechelectron
npm install
npm start
```

## Run the tests

```bash
npm run test:ci
```

The tests use Playwright to drive the real Electron app. The first time, install
the browser they need: `npx playwright install chromium-headless-shell`.

- On Linux, run them with a virtual display: `xvfb-run -a npm run test:ci`.
- On Windows, if Electron tests fail because `ELECTRON_RUN_AS_NODE` is set, clear
  it first: `$env:ELECTRON_RUN_AS_NODE=$null` (PowerShell).
- `tests/technician.spec.js` really runs the network and service fixes on your
  machine, so it isn't part of `test:ci`.

GitHub Actions runs `test:ci` on Windows, macOS and Linux for every push and
pull request.

## Where things live

| File | What it does |
|---|---|
| `platform.js` | Everything that differs per OS: folders to clean, protected system folders, developer cache paths |
| `scanner.js` | Finds junk files in the folders from `platform.js` |
| `cleaner.js` | Deletes what the scan found, skipping system paths and locked files |
| `largeFiles.js` | Large file finder |
| `devCaches.js` | Developer cache detection and cleanup |
| `startupItems.js` | Apps that start at sign-in (registry, LaunchAgents, autostart) |
| `technician.js` | Quick fixes |
| `main.js` | Electron main process, IPC and app lifecycle |
| `renderer.js`, `index.html`, `styles.css` | The app's window |

## Making a change

1. Fork the repo and create a branch: `git checkout -b fix-short-description`.
2. Keep the change focused on one thing.
3. **Safety first.** Anything that deletes files must never touch system folders
   or the user's personal files. Add new clean-up locations in `platform.js`, and
   add a test for them.
4. Run `npm run test:ci` and make sure it passes.
5. Open a pull request that explains what changed and why, and how you tested
   it (which OS).

Keep the style of the surrounding code: plain JavaScript, no new dependencies
unless they're really needed, and short, friendly wording in the app.

## License

By contributing, you agree that your contributions are licensed under the
GNU General Public License v3.0 or later, the same license as the project.
