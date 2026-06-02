# XCoreTech PC Optimizer Manual Test Plan

## 1. Installation And First Launch

- `[ ]` Build the application with `npm run pack` and run it.
- `[ ]` Confirm the app opens without errors and shows the `PRO` badge.
- `[ ]` Confirm there is no activation button, activation modal, purchase button, or payment modal.
- `[ ]` Confirm system information and startup programs load within a few seconds.

## 2. Scanner And Cleaner

- `[ ]` Click **Scan System**.
- `[ ]` Confirm scanning reaches 100% and the junk total updates.
- `[ ]` Click **Optimize Now** after scan results appear.
- `[ ]` Confirm the Windows cleanup prompt appears and statistics update after cleanup.

## 3. Startup Maintenance

- `[ ]` Toggle **Launch at Windows Startup (Auto-Clean)**.
- `[ ]` Confirm the checkbox remains interactive without activation.
- `[ ]` Refresh the Windows startup manifest and toggle an allowed startup entry.

## 4. Technician Mode

- `[ ]` Run **RAM Boost**, **Internet Fix**, and **Auto Fix**.
- `[ ]` Confirm each tool is immediately available without a lock overlay.
- `[ ]` Confirm progress text updates and each operation completes.

## 5. UI Edge Cases

- `[ ]` Try other actions while a scan or cleanup is running.
- `[ ]` Confirm conflicting actions are disabled while work is in progress.
- `[ ]` Close the application and confirm tray behavior works as configured.
