#!/usr/bin/env bash
# OpenWorker Suite — macOS .app bundle + DMG (srs.md §6, FR-D1)
# Usage: mac-bundle.sh <path-to-universal-binary> [output.dmg]
set -euo pipefail

BIN="${1:?usage: mac-bundle.sh <binary> [out.dmg]}"
OUT="${2:-../dist/OpenWorker-macos.dmg}"
APP_NAME="OpenWorker"

command -v hdiutil >/dev/null 2>&1 || { echo "hdiutil not found — run on macOS" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

APP="$STAGE/$APP_NAME.app/Contents/MacOS"
mkdir -p "$APP" "$STAGE/$APP_NAME.app/Contents/Resources"
cp "$BIN" "$APP/openworker"
chmod +x "$APP/openworker"

cat > "$STAGE/$APP_NAME.app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>OpenWorker</string>
  <key>CFBundleIdentifier</key><string>dev.openworker.app</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>openworker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# Gatekeeper: sign when a cert is available; ad-hoc fallback is documented.
if xcrun --find codesign >/dev/null 2>&1 && security find-identity -v -p codesigning 2>/dev/null | grep -q "Developer ID Application"; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep 'Developer ID Application' | head -1 | sed 's/.*\"\(.*\)\"/\1/')"
  xcrun codesign --force --options runtime --identity "$IDENTITY" "$STAGE/$APP_NAME.app"
else
  echo "[mac-bundle] no Developer ID cert — applying ad-hoc signature."
  echo "  Users will right-click > Open on first launch (documented in README)."
  xcrun codesign --force --deep --sign - "$STAGE/$APP_NAME.app" 2>/dev/null || true
fi

DMG="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
mkdir -p "$(dirname "$DMG")"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG"

echo "built $DMG"
echo "sha256:"
shasum -a 256 "$DMG"
