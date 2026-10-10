#!/usr/bin/env bash
# Tests `domicile-settings-host` as Chrome runs it: framed messages on stdin
# and stdout, and the desktop asked over DOMICILE_SOCK.
#
#   ./scripts/test-the-settings-host-edits-the-desktops-files.sh
#
# The unit tests cover the protocol (`domicile_launch::settings`). This covers
# the binary: the framing on real pipes, reading and writing real files, the
# read-only check, and the change notice when a file is edited elsewhere. The
# desktop is a fake that answers `settings_files`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo"; exit 77; }
command -v python3 >/dev/null 2>&1 || { echo "SKIP: no python3"; exit 77; }

echo "== building domicile-settings-host =="
( cd "$ROOT" && cargo build -q -p domicile-launch --bin domicile-settings-host ) || {
  echo "FAIL: domicile-settings-host would not build"; exit 1; }
HOST="$TARGET/debug/domicile-settings-host"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$HOST" "$WORK" <<'PY'
import json, os, socket, struct, subprocess, sys, threading, time

host, work = sys.argv[1], sys.argv[2]
config = os.path.join(work, "domicile.json")
shell = os.path.join(work, "shell.ts")
with open(config, "w") as f:
    f.write('{"theme":{"mode":"dark"}}\n')
with open(shell, "w") as f:
    f.write("export const Shell = runManganese();\n")
os.chmod(shell, 0o444)

# The desktop: answers each connection's one line.
sock_path = os.path.join(work, "control.sock")
server = socket.socket(socket.AF_UNIX)
server.bind(sock_path)
server.listen()

def desktop():
    while True:
        conn, _ = server.accept()
        request = json.loads(conn.makefile().readline())
        assert request == {"type": "settings_files"}, request
        reply = {"type": "settings_files",
                 "files": {"config": config, "evaluated": None, "shell": shell}}
        conn.sendall((json.dumps(reply) + "\n").encode())
        conn.close()

threading.Thread(target=desktop, daemon=True).start()

proc = subprocess.Popen([host], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        env={**os.environ, "DOMICILE_SOCK": sock_path})

def send(message):
    body = json.dumps(message).encode()
    proc.stdin.write(struct.pack("=I", len(body)) + body)
    proc.stdin.flush()

def receive():
    length = struct.unpack("=I", proc.stdout.read(4))[0]
    return json.loads(proc.stdout.read(length))

failed = False
def check(what, ok, said):
    global failed
    print(("  ok    " if ok else "  FAIL  ") + what + ("" if ok else f": {said}"))
    failed = failed or not ok

send({"id": 1, "type": "read"})
files = receive()
check("it reads the config the desktop names",
      files.get("config", {}).get("text") == '{"theme":{"mode":"dark"}}\n', files)
check("it says a read-only shell cannot be written",
      files.get("shell", {}).get("writable") is False or os.geteuid() == 0, files)

send({"id": 2, "type": "write", "file": "config",
      "text": '{"theme":{"mode":"light"}}\n'})
written = receive()
# The write is seen by the watch too, so a notice may come first.
while written.get("type") == "changed":
    written = receive()
check("it writes the config", written == {"id": 2, "type": "written"}, written)
with open(config) as f:
    check("the file holds what was written",
          f.read() == '{"theme":{"mode":"light"}}\n', "")

send({"id": 3, "type": "write", "file": "config", "text": '{"theme":{"mode":"system"}}'})
refused = receive()
while refused.get("type") == "changed":
    refused = receive()
check("it refuses a config the compositor would", refused.get("type") == "refused", refused)

# Let the notices from the writes above arrive before editing elsewhere.
time.sleep(0.5)
with open(config, "w") as f:
    f.write('{"idle":{"blank_after_seconds":60}}\n')
noticed = receive()
check("it tells the app of an edit made elsewhere", noticed == {"type": "changed"}, noticed)

proc.stdin.close()
check("it ends when the app goes", proc.wait(timeout=5) == 0, proc.returncode)
sys.exit(1 if failed else 0)
PY
