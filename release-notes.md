What's new in 1.3.31

- Developer caches: check and clean the npm, pnpm, pip, uv and conda caches, Temp files nobody has touched for a week, and Playwright test browsers no project uses. pnpm and conda are only cleaned with their own tools, so packages still in use are kept.
- Large files: find the biggest files in your user folder or on a whole drive, open their folder, and move them to the Recycle Bin or delete them permanently. Windows and program folders are left out.
- A simpler look that follows your Windows light or dark theme, and a new app icon.
- Fixed: searching folders that contain Electron app archives (.asar) no longer lists files that don't exist or keeps those archives locked.
