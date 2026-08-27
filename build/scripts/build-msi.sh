#!/usr/bin/env bash
# build-msi.sh — Build Windows .msi installer via WiX
# Requires: WiX Toolset v3.11+ (wix CLI), Wine (for cross-compile)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/build/dist/windows"
WXS="$ROOT/build/windows/s-ai-setup.wxs"

echo "=== S-AI Build: Windows MSI Installer ==="
echo ""

# Ensure exe exists
if [ ! -f "$OUT/s-ai.exe" ]; then
  echo "ERROR: s-ai.exe not found. Run build-exe.sh first."
  exit 1
fi

echo "[1/3] Checking WiX toolset..."
if command -v wix &>/dev/null; then
  echo "  Found: $(wix --version 2>/dev/null || echo 'installed')"
elif command -v candle &>/dev/null; then
  echo "  Found WiX v3 candle/light"
else
  echo "  WiX not found. Install options:"
  echo "    - Windows: choco install wixtoolset"
  echo "    - Linux/macOS: brew install wix (via Wine)"
  echo "    - Or use GitHub Actions (build.yml)"
  echo ""
  echo "  Attempting Docker-based build..."
  if command -v docker &>/dev/null; then
    echo "  Building MSI via Docker..."
    docker run --rm \
      -v "$ROOT:/app" \
      -w /app \
      mcr.microsoft.com/windows/servercore:ltsc2022 \
      cmd /c "cd \\app && choco install wixtoolset -y && \\tools\\wix\\candle.exe -nologo -out \\app\\build\\dist\\windows\\s-ai-setup.wixobj \\app\\build\\windows\\s-ai-setup.wxs && \\tools\\wix\\light.exe -nologo -out \\app\\build\\dist\\windows\\s-ai-setup.msi \\app\\build\\dist\\windows\\s-ai-setup.wixobj"
  else
    echo "  Docker not available either. Skipping MSI build."
    echo "  Install WiX manually or use CI/CD."
    exit 0
  fi
fi

echo "[2/3] Compiling WiX source..."
if command -v wix &>/dev/null; then
  wix build "$WXS" \
    -o "$OUT/s-ai-setup.msi" \
    -d "VERSION=5.1.0" \
    -d "EXE=$OUT/s-ai.exe"
elif command -v candle &>/dev/null; then
  candle -nologo -out "$OUT/s-ai-setup.wixobj" "$WXS"
  light -nologo -out "$OUT/s-ai-setup.msi" "$OUT/s-ai-setup.wixobj"
fi

echo "[3/3] Done!"
echo ""
echo "Output:"
ls -lh "$OUT/s-ai-setup.msi" 2>/dev/null || echo "  MSI not found"
echo ""
echo "Install:"
echo "  msiexec /i s-ai-setup.msi"
