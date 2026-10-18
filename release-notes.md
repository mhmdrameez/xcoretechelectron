What's new in 1.3.33

- XCoreTech now runs on macOS (Apple Silicon and Intel) and Linux (AppImage, .deb and .rpm), not just Windows.
- One command installs it on macOS or Linux:
  curl -fsSL https://raw.githubusercontent.com/mhmdrameez/xcoretechelectron/main/install.sh | bash
- Junk cleanup, Large files, Developer caches, apps that start at sign-in, and auto-clean at sign-in work on all three. The Internet fix flushes the DNS cache on macOS and Linux; Free up memory and the Windows Update & printer fix stay Windows-only.
- macOS: the app isn't signed with an Apple Developer ID yet. If you install from the .dmg, open it the first time with right-click > Open (on macOS 15 and later: System Settings > Privacy & Security > Open Anyway). The install command above skips this step.
