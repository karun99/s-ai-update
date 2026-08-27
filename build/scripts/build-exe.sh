#!/usr/bin/env bash
# build-exe.sh — Build native executables for Windows, Linux, macOS via pkg
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/build/dist"
PKG_CFG="$ROOT/build/pkg.config.json"

echo "=== S-AI Build: Native Executables ==="
echo ""

# Ensure TypeScript is compiled
if [ ! -f "$ROOT/dist/src/index.js" ]; then
  echo "[1/4] Compiling TypeScript..."
  cd "$ROOT" && npm run build
else
  echo "[1/4] dist/ already built"
fi

echo "[2/4] Installing pkg..."
npx --yes pkg@latest --version > /dev/null 2>&1

echo "[3/4] Building executables..."

# Build for each platform
TARGETS=("node18-win-x64" "node18-linux-x64" "node18-linux-arm64" "node18-macos-x64" "node18-macos-arm64")

for target in "${TARGETS[@]}"; do
  platform=$(echo "$target" | sed 's/node18-//' | sed 's/x64/x64/' | sed 's/arm64/arm64/')
  output_dir="$OUT/$platform"
  mkdir -p "$output_dir"

  echo "  -> $target"
  npx pkg@latest "$ROOT" \
    --targets "$target" \
    --output "$output_dir/s-ai" \
    --config "$PKG_CFG" \
    --compress Brotli \
    2>/dev/null || echo "  WARNING: Failed to build $target (may need cross-compile toolchain)"
done

# Make Linux/macOS executables runnable
chmod +x "$OUT/linux-x64/s-ai" 2>/dev/null || true
chmod +x "$OUT/linux-arm64/s-ai" 2>/dev/null || true
chmod +x "$OUT/macos-x64/s-ai" 2>/dev/null || true
chmod +x "$OUT/macos-arm64/s-ai" 2>/dev/null || true

echo ""
echo "[4/4] Done!"
echo ""
echo "Output:"
ls -lh "$OUT"/*/s-ai* 2>/dev/null || echo "  (check build/dist/ for outputs)"
echo ""
echo "Usage:"
echo "  ./build/dist/windows-x64/s-ai.exe serve"
echo "  ./build/dist/linux-x64/s-ai serve"
echo "  ./build/dist/macos-x64/s-ai serve"
