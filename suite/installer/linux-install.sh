#!/bin/sh
# OpenWorker Suite — POSIX Linux installer to ~/.local (srs.md §6, FR-D1)
# No root required. Optional systemd --user unit + .desktop entry.
set -eu

PREFIX="${OPENWORKER_PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
LIB_DIR="$PREFIX/lib/openworker"
RELEASE_URL="${OPENWORKER_RELEASE_URL:-}"

echo "OpenWorker Linux installer -> $PREFIX"

mkdir -p "$BIN_DIR" "$LIB_DIR"

if [ -n "$RELEASE_URL" ]; then
  echo "downloading release tarball from $RELEASE_URL"
  TMP="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$RELEASE_URL" -o "$TMP";
  elif command -v wget >/dev/null 2>&1; then wget -qO "$TMP" "$RELEASE_URL";
  else echo "need curl or wget" >&2; exit 1; fi
  # verify checksum when a .sha256 companion exists (FR-D3)
  if [ -n "${OPENWORKER_RELEASE_SHA256:-}" ]; then
    echo "$OPENWORKER_RELEASE_SHA256  $TMP" | sha256sum -c - || { echo "checksum mismatch" >&2; exit 1; }
  fi
  tar -xzf "$TMP" -C "$LIB_DIR"
  rm -f "$TMP"
else
  echo "no OPENWORKER_RELEASE_URL given — installing from this repository checkout"
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
  cp -r "$SRC"/dist "$LIB_DIR/dist"
  cp -r "$SRC"/bin "$LIB_DIR/bin"
  cp "$SRC/package.json" "$LIB_DIR/" 2>/dev/null || true
fi

cat > "$BIN_DIR/openworker" <<LAUNCHER
#!/bin/sh
export OPENWORKER_ENGINE_PATH="\${OPENWORKER_ENGINE_PATH:-$LIB_DIR/engine}"
exec node "$LIB_DIR/bin/openworker.js" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/openworker"

# engine checkout (optional but recommended)
if [ ! -d "$LIB_DIR/engine" ] && [ -d "$HOME/s-ai" ]; then
  ln -sfn "$HOME/s-ai" "$LIB_DIR/engine" 2>/dev/null || true
fi

case :"$PATH": in
  *:"$BIN_DIR":*) ;;
  *) echo "note: add $BIN_DIR to PATH"; ;;
esac

# Optional systemd --user unit
if command -v systemctl >/dev/null 2>&1 && [ -n "${OPENWORKER_SYSTEMD:-}" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/openworker.service" <<UNIT
[Unit]
Description=OpenWorker dashboard (loopback)
After=network-online.target

[Service]
ExecStart=$BIN_DIR/openworker serve --port 3000
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  echo "systemd unit installed: systemctl --user enable --now openworker"
fi

# Optional .desktop entry
if [ -n "${OPENWORKER_DESKTOP:-}" ] && [ -d "$HOME/.local/share/applications" ]; then
  cat > "$HOME/.local/share/applications/openworker.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=OpenWorker
Exec=$BIN_DIR/openworker serve
Icon=openworker
Categories=Development;
DESKTOP
fi

echo "installed: $BIN_DIR/openworker"
echo "next: openworker import s-ai && openworker ask \"hello\""
