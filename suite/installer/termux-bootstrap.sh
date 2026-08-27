#!/data/data/com.termux/files/usr/bin/bash
# OpenWorker Suite — Android Termux bootstrap (srs.md §6, FR-D1, M6)
# One-liner target: curl -fsSL <url>/termux-bootstrap.sh | bash
set -eu

echo "OpenWorker Termux bootstrap"
command -v pkg >/dev/null 2>&1 || { echo "must run inside Termux" >&2; exit 1; }

pkg install -y nodejs-lts git 2>/dev/null || pkg install -y nodejs-lts

INSTALL_DIR="$HOME/.openworker-app"
ENGINE_DIR="$HOME/s-ai"

# Engine: clone s-ai once, build from source (postinstall compiles dist/)
if [ ! -x "$ENGINE_DIR/dist/src/index.js" ] && [ ! -f "$ENGINE_DIR/dist/src/index.js" ]; then
  if [ ! -d "$ENGINE_DIR" ]; then
    git clone --depth 1 https://github.com/nsk/s-ai.git "$ENGINE_DIR"
  fi
  (cd "$ENGINE_DIR" && npm install --omit=dev --no-audit --no-fund)
fi

# Suite harness
mkdir -p "$INSTALL_DIR"
cp -r "$(dirname "$0")/.." "$INSTALL_DIR/" 2>/dev/null || true
cd "$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund
npm run build || true

export OPENWORKER_ENGINE_PATH="$ENGINE_DIR"
mkdir -p "$HOME/bin"
cat > "$HOME/bin/openworker" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/bash
export OPENWORKER_ENGINE_PATH="$HOME/s-ai"
exec node "$HOME/.openworker-app/bin/openworker.js" "$@"
LAUNCHER
chmod +x "$HOME/bin/openworker"

echo
echo "done: ~/bin/openworker"
echo "start the PWA dashboard: openworker serve   (installable via browser home screen)"
