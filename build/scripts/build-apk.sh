#!/usr/bin/env bash
# build-apk.sh — Build Android APK via Capacitor
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/build/android"
WWW_DIR="$ANDROID_DIR/app/src/main/assets/www"
OUT="$ROOT/build/dist/android"

echo "=== S-AI Build: Android APK ==="
echo ""

# Ensure TypeScript is compiled
if [ ! -f "$ROOT/dist/src/index.js" ]; then
  echo "[1/6] Compiling TypeScript..."
  cd "$ROOT" && npm run build
else
  echo "[1/6] dist/ already built"
fi

echo "[2/6] Copying web assets to Capacitor..."
rm -rf "$WWW_DIR"
mkdir -p "$WWW_DIR"
cp -r "$ROOT/dist" "$WWW_DIR/dist"
cp -r "$ROOT/public" "$WWW_DIR/public"
cp -r "$ROOT/bin" "$WWW_DIR/bin"
cp -r "$ROOT/skills" "$WWW_DIR/skills"
cp "$ROOT/package.json" "$WWW_DIR/"
cp "$ROOT/config.default.json" "$WWW_DIR/"

# Create a minimal Node.js-compatible loader for Android
cat > "$WWW_DIR/index.js" << 'LOADER'
#!/usr/bin/env node
// S-AI Android loader — serves the dashboard on localhost
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  let fp = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(fp)) fp = path.join(PUBLIC, 'index.html');
  const ext = path.extname(fp);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log(`S-AI running on http://localhost:${PORT}`));
LOADER

echo "[3/6] Installing Capacitor..."
cd "$ROOT"
npx --yes @capacitor/cli --version > /dev/null 2>&1

# Initialize Capacitor if needed
if [ ! -f "$ANDROID_DIR/capacitor.config.json" ]; then
  cp "$ROOT/build/android/capacitor.config.json" "$ROOT/"
fi

echo "[4/6] Syncing Capacitor..."
cd "$ANDROID_DIR"
npx cap sync android 2>/dev/null || echo "  (cap sync may need Android SDK)"

echo "[5/6] Building APK..."
mkdir -p "$OUT"

if [ -n "${ANDROID_HOME:-}" ] || [ -n "${ANDROID_SDK_ROOT:-}" ]; then
  cd "$ANDROID_DIR"
  if [ -f "./gradlew" ]; then
    ./gradlew assembleDebug 2>/dev/null || echo "  Gradle build attempted"
  else
    echo "  gradlew not found — run 'npx cap add android' first"
  fi
else
  echo "  Android SDK not found. Install Android Studio or set ANDROID_HOME."
  echo "  APK scaffolding created at: $ANDROID_DIR"
fi

echo "[6/6] Done!"
echo ""
echo "Output:"
find "$OUT" -name "*.apk" 2>/dev/null | head -5 || echo "  (build Android Studio project to generate APK)"
echo ""
echo "To build manually:"
echo "  1. Install Android Studio"
echo "  2. Open $ANDROID_DIR as a project"
echo "  3. Build > Build APK"
