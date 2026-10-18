#!/usr/bin/env bash
# XCoreTech PC Optimizer installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/mhmdrameez/xcoretechelectron/main/install.sh | bash
#
# Downloads the latest release from GitHub and installs it:
#   macOS                          -> /Applications (or ~/Applications)
#   Ubuntu, Debian, Mint, Pop!_OS  -> .deb via apt
#   Fedora, RHEL, CentOS, Rocky    -> .rpm via dnf / yum
#   openSUSE                       -> .rpm via zypper
#   anything else                  -> AppImage in ~/.local/bin, plus a menu entry
#
# Options (environment variables):
#   XCORETECH_FORMAT=appimage|deb|rpm   force a Linux package type
#   XCORETECH_VERSION=1.3.33            install a specific version instead of the latest
#   XCORETECH_DRY_RUN=1                 show what would be downloaded, change nothing

set -euo pipefail

REPO="mhmdrameez/xcoretechelectron"
APP_NAME="XCoreTech PC Optimizer"
BIN_NAME="xcoretech-pc-optimizer"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

DRY_RUN="${XCORETECH_DRY_RUN:-}"
run() { if [ -n "$DRY_RUN" ]; then echo "  (dry run) $*"; else "$@"; fi; }

have curl || die "curl is needed. Install it with your package manager and run this again."

# sudo only when we aren't root already
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if have sudo; then SUDO="sudo"; else SUDO=""; fi
fi
need_sudo() { [ -n "$DRY_RUN" ] || [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ] || die "This step needs root. Install sudo or run as root."; }

# ── what are we on? ──────────────────────────────────────────────────────────
OS="${XCORETECH_OS:-$(uname -s)}"
ARCH_RAW="${XCORETECH_ARCH:-$(uname -m)}"
case "$ARCH_RAW" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) die "Unsupported processor: $ARCH_RAW" ;;
esac

# ── find the release ─────────────────────────────────────────────────────────
if [ -n "${XCORETECH_VERSION:-}" ]; then
  API="https://api.github.com/repos/$REPO/releases/tags/v${XCORETECH_VERSION#v}"
else
  API="https://api.github.com/repos/$REPO/releases/latest"
fi
say "Looking up the release on GitHub…"
RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" \
  || die "Couldn't reach GitHub. Check your connection, or download manually: https://github.com/$REPO/releases"

VERSION="$(printf '%s' "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/')"
URLS="$(printf '%s' "$RELEASE_JSON" | grep '"browser_download_url"' | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')"
[ -n "$VERSION" ] || die "Couldn't read the release version."

asset_url() {  # one or more file name endings, e.g. "-linux-amd64.deb" "-linux-x64.deb"; first match wins
  local ending url
  for ending in "$@"; do
    url="$(printf '%s\n' "$URLS" | grep -F -- "$ending" | grep -v '\.blockmap$' | head -n1 || true)"
    if [ -n "$url" ]; then printf '%s\n' "$url"; return; fi
  done
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

download() {  # $1 = url, $2 = target file
  say "Downloading $(basename "$1")…"
  if [ -n "$DRY_RUN" ]; then echo "  (dry run) $1"; return; fi
  curl -fL --progress-bar -o "$2" "$1" || die "Download failed: $1"
}

no_build() {
  die "Version $VERSION has no $1 build. Get another version from https://github.com/$REPO/releases"
}

# ── macOS ────────────────────────────────────────────────────────────────────
install_macos() {
  local url zip dest
  url="$(asset_url "-mac-$ARCH.zip")"
  [ -n "$url" ] || no_build "macOS ($ARCH)"
  zip="$TMP/app.zip"
  download "$url" "$zip"

  dest="/Applications"
  [ -w "$dest" ] || dest="$HOME/Applications"
  run mkdir -p "$dest"

  if [ -z "$DRY_RUN" ]; then
    ditto -x -k "$zip" "$TMP/unzipped"
    [ -d "$TMP/unzipped/$APP_NAME.app" ] || die "The download didn't contain $APP_NAME.app"
    # quit a running copy so the files can be replaced
    osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
    rm -rf "$dest/$APP_NAME.app"
    ditto "$TMP/unzipped/$APP_NAME.app" "$dest/$APP_NAME.app"
    # downloads made by curl aren't quarantined, but clear it in case
    xattr -dr com.apple.quarantine "$dest/$APP_NAME.app" 2>/dev/null || true
  fi

  say "Installed $APP_NAME $VERSION in $dest"
  echo "    Open it from Launchpad, or run: open -a \"$APP_NAME\""
  echo "    Uninstall: drag it from $dest to the Trash."
}

# ── Linux ────────────────────────────────────────────────────────────────────
linux_format() {
  if [ -n "${XCORETECH_FORMAT:-}" ]; then echo "$XCORETECH_FORMAT"; return; fi
  if have apt-get && have dpkg; then echo deb; return; fi
  if have dnf || have yum || have zypper; then echo rpm; return; fi
  echo appimage
}

install_deb() {
  local url file
  # electron-builder names Linux files after each format's own arch name
  url="$(asset_url "-linux-amd64.deb" "-linux-x64.deb")"
  [ -n "$url" ] || no_build "Linux .deb ($ARCH)"
  file="$TMP/xcoretech.deb"
  download "$url" "$file"
  need_sudo
  say "Installing with apt (it may ask for your password)…"
  run $SUDO apt-get install -y "$file"
  say "Installed $APP_NAME $VERSION."
  echo "    Open it from your app menu, or run: $BIN_NAME"
  echo "    Uninstall: sudo apt remove xcoretech-disk-cleaner"
}

install_rpm() {
  local url file
  url="$(asset_url "-linux-x86_64.rpm" "-linux-x64.rpm")"
  [ -n "$url" ] || no_build "Linux .rpm ($ARCH)"
  file="$TMP/xcoretech.rpm"
  download "$url" "$file"
  need_sudo
  if have dnf; then
    say "Installing with dnf (it may ask for your password)…"
    run $SUDO dnf install -y "$file"
    echo "    Uninstall: sudo dnf remove xcoretech-disk-cleaner"
  elif have zypper; then
    say "Installing with zypper (it may ask for your password)…"
    run $SUDO zypper --non-interactive install --allow-unsigned-rpm "$file"
    echo "    Uninstall: sudo zypper remove xcoretech-disk-cleaner"
  else
    say "Installing with yum (it may ask for your password)…"
    run $SUDO yum install -y "$file"
    echo "    Uninstall: sudo yum remove xcoretech-disk-cleaner"
  fi
  say "Installed $APP_NAME $VERSION."
  echo "    Open it from your app menu, or run: $BIN_NAME"
}

install_appimage() {
  local url bin_dir target apps_dir icon_dir
  url="$(asset_url "-linux-x86_64.AppImage" "-linux-x64.AppImage")"
  [ -n "$url" ] || no_build "Linux AppImage ($ARCH)"
  bin_dir="$HOME/.local/bin"
  apps_dir="$HOME/.local/share/applications"
  icon_dir="$HOME/.local/share/icons/hicolor/512x512/apps"
  target="$bin_dir/$BIN_NAME.AppImage"
  run mkdir -p "$bin_dir" "$apps_dir" "$icon_dir"
  download "$url" "$TMP/app.AppImage"
  run install -m 755 "$TMP/app.AppImage" "$target"
  run curl -fsSL -o "$icon_dir/$BIN_NAME.png" "https://raw.githubusercontent.com/$REPO/main/assets/icon-1024.png" || true

  if [ -z "$DRY_RUN" ]; then
    cat > "$apps_dir/$BIN_NAME.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=Clean junk files, find large files and tidy developer caches
Exec="$target" %U
Icon=$BIN_NAME
Categories=Utility;
Terminal=false
EOF
  fi

  # AppImages need FUSE 2 to mount themselves
  if ! ls /usr/lib*/libfuse.so.2* /lib*/libfuse.so.2* /usr/lib/*/libfuse.so.2* >/dev/null 2>&1; then
    warn "AppImages need FUSE 2 (libfuse2). If the app doesn't open, install it:"
    echo "    Ubuntu 24.04+: sudo apt install libfuse2t64    Older Ubuntu/Debian: sudo apt install libfuse2"
    echo "    Fedora: sudo dnf install fuse-libs    Arch: sudo pacman -S fuse2"
  fi

  say "Installed $APP_NAME $VERSION to $target"
  echo "    Open it from your app menu, or run: $target"
  echo "    It updates itself. Uninstall: rm \"$target\" \"$apps_dir/$BIN_NAME.desktop\""
}

case "$OS" in
  Darwin)
    install_macos ;;
  Linux)
    [ "$ARCH" = "x64" ] || die "Linux builds are 64-bit Intel/AMD (x86_64) only for now."
    case "$(linux_format)" in
      deb)      install_deb ;;
      rpm)      install_rpm ;;
      appimage) install_appimage ;;
      *)        die "XCORETECH_FORMAT must be appimage, deb or rpm" ;;
    esac ;;
  *)
    die "This installer is for macOS and Linux. On Windows, download the installer from https://github.com/$REPO/releases/latest" ;;
esac
