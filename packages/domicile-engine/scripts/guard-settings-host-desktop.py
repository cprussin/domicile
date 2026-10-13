#!/usr/bin/env python3
"""The desktop for guard-settings-host.sh: answers `settings_files` on a
control socket, naming one config file and no shell.

`domicile-settings-host` asks this over `DOMICILE_SOCK`, which Chrome passes
on from the engine's environment. Prints `listening` once the socket is bound.
"""

import argparse
import json
import socket


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    server = socket.socket(socket.AF_UNIX)
    server.bind(args.socket)
    server.listen()
    print("listening", flush=True)
    reply = {
        "type": "settings_files",
        "files": {"config": args.config, "evaluated": None, "shell": None},
    }
    while True:
        conn, _ = server.accept()
        with conn:
            request = json.loads(conn.makefile().readline())
            print(f"asked {json.dumps(request)}", flush=True)
            if request != {"type": "settings_files"}:
                raise SystemExit(f"the host asked for {request}")
            conn.sendall((json.dumps(reply) + "\n").encode())


if __name__ == "__main__":
    main()
