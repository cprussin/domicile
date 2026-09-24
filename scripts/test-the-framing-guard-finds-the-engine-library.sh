#!/usr/bin/env bash
# The framing guard's probe finds libdomicile_engine.so outside a component
# build. Only a component build gives executables an `$ORIGIN` rpath, so in
# out/Release the probe exited 127 until the guard put the out dir on
# LD_LIBRARY_PATH, as the other guards already do.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-framing.sh"

command -v python3 >/dev/null || {
  echo "no python3 to serve the guard's pages" >&2
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT=out/Release
mkdir -p "$WORK/src/$OUT"

# Opens the broker socket and waits to be killed.
cat >"$WORK/src/$OUT/chrome" <<'EOF'
#!/usr/bin/env bash
for arg; do
  case "$arg" in --domicile-broker-socket=*) broker="${arg#*=}" ;; esac
done
exec python3 -c 'import socket, sys, time
socket.socket(socket.AF_UNIX).bind(sys.argv[1])
time.sleep(60)' "$broker"
EOF

# Exits as the dynamic loader would without the library.
cat >"$WORK/src/$OUT/domicile_color_probe" <<EOF
#!/usr/bin/env bash
case ":\${LD_LIBRARY_PATH:-}:" in
*":$WORK/src/$OUT:"*) exit 0 ;;
esac
echo "libdomicile_engine.so: cannot open shared object file" >&2
exit 127
EOF
chmod +x "$WORK/src/$OUT/chrome" "$WORK/src/$OUT/domicile_color_probe"

PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
OUT="$OUT" PORT="$PORT" BROKER="$WORK/broker" PROFILE="$WORK/profile" \
  HTTP_LOG="$WORK/http.log" "$GUARD" "$WORK/src" >"$WORK/guard.log" 2>&1
status=$?

if [ "$status" -eq 0 ]; then
  echo "the framing guard's probe finds libdomicile_engine.so in $OUT"
  exit 0
fi
cat "$WORK/guard.log" >&2
echo "the guard exited $status" >&2
exit 1
