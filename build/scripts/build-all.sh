#!/usr/bin/env bash
# build-all.sh — Build all platform artifacts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  S-AI v5.1 — Full Platform Build"
echo "============================================"
echo ""

# Step 1: Compile TypeScript
echo "[Step 1] Compiling TypeScript..."
cd "$SCRIPT_DIR/../.."
npm run build

# Step 2: Native executables
echo ""
echo "[Step 2] Building native executables..."
bash "$SCRIPT_DIR/build-exe.sh"

# Step 3: Docker
echo ""
echo "[Step 3] Building Docker image..."
bash "$SCRIPT_DIR/build-docker.sh" 2>/dev/null || echo "  Docker build skipped (Docker not available)"

# Step 4: MSI (Windows only or needs WiX)
echo ""
echo "[Step 4] Building Windows MSI..."
bash "$SCRIPT_DIR/build-msi.sh" 2>/dev/null || echo "  MSI build skipped (WiX not available)"

# Step 5: Android APK
echo ""
echo "[Step 5] Building Android APK..."
bash "$SCRIPT_DIR/build-apk.sh" 2>/dev/null || echo "  APK build skipped (Android SDK not available)"

echo ""
echo "============================================"
echo "  Build Complete!"
echo "============================================"
echo ""
echo "Artifacts in: build/dist/"
ls -lhR "$SCRIPT_DIR/../dist/" 2>/dev/null | head -30
