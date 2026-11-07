#!/usr/bin/env python3
# Copyright 2026 Tom Mecattaf
# SPDX-License-Identifier: MIT

"""Exercise native Chrome through Domicile's Wayland seat, in runtime-test."""

import argparse
import http.server
import json
import os
from pathlib import Path
import queue
import re
import socket
import subprocess
import threading
import time
import urllib.request

import guard_webview_devtools as cdp_wire


def until(check, description, patience=30):
    deadline = time.monotonic() + patience
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(description)


class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        data = ("<!doctype html><meta name='viewport' content='width=device-width'>"
                "<title>Native gesture fixture</title><style>body{height:6000px;"
                "margin:0;background:linear-gradient(white,steelblue)}</style>"
                "<h1>" + self.path + "</h1>").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--compositor", required=True)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--engine", help="Route input through an isolated nested Domicile engine")
    parser.add_argument("--history-only", action="store_true")
    parser.add_argument("--require-official", action="store_true")
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(mode=0o700)
    runtime = out / "runtime"
    runtime.mkdir(mode=0o700)
    home = out / "home"
    home.mkdir()
    config = out / "config.json"
    config.write_text(json.dumps({"output": {"displays": [
        {"name": "fixture", "size": [1280, 720]}]}}))
    env = dict(os.environ, HOME=str(home), XDG_RUNTIME_DIR=str(runtime),
               XDG_CACHE_HOME=str(out / "cache"), XDG_CONFIG_HOME=str(out / "config"),
               XDG_DATA_HOME=str(out / "data"), XDG_STATE_HOME=str(out / "state"),
               XDG_DATA_DIRS=str(out / "no-data"), WAYLAND_DISPLAY="not-live",
               DBUS_SESSION_BUS_ADDRESS="unix:path=" + str(runtime / "no-bus"),
               DBUS_SYSTEM_BUS_ADDRESS="unix:path=" + str(runtime / "no-system-bus"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d" % server.server_port
    processes = []
    receipt = {"started": time.time(), "input": "Domicile control socket -> Wayland"}
    if args.engine:
        build = Path(args.engine)
        provenance = build / "PROVENANCE"
        receipt["engine_build"] = (provenance if provenance.exists() else build / "args.gn").read_text()
        if args.require_official:
            assert "is_official_build = true" in receipt["engine_build"], receipt
            assert "dcheck_always_on = false" in receipt["engine_build"], receipt
    try:
        compositor = subprocess.Popen([
            args.compositor, "--chrome-socket", str(runtime / "control"),
            "--session", str(out / "session.json"), "--config", str(config),
            "--software-compositing", "yes"], env=env,
            stdout=(out / "compositor.stdout").open("wb"),
            stderr=(out / "compositor.stderr").open("wb"))
        processes.append(compositor)
        until(lambda: (out / "session.json").exists(), "compositor session")
        session = json.loads((out / "session.json").read_text())
        control = socket.socket(socket.AF_UNIX)
        control.connect(str(runtime / "control"))
        messages = queue.Queue()
        def read_control():
            with (out / "host.jsonl").open("w") as log:
                for line in control.makefile("r"):
                    log.write(line)
                    log.flush()
                    messages.put(json.loads(line))
        threading.Thread(target=read_control, daemon=True).start()
        def say(message):
            control.sendall((json.dumps(message) + "\n").encode())
        def wait_message(kind):
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                message = messages.get(timeout=max(0.1, deadline-time.monotonic()))
                if message["type"] == kind:
                    return message
            raise AssertionError("host never sent " + kind)
        say({"type": "hello", "protocol_version": 1})
        wait_message("welcome")
        env["WAYLAND_DISPLAY"] = session["wayland_display"]
        profile = out / "profile"
        chrome = subprocess.Popen([
            args.chrome, "--ozone-platform=wayland", "--disable-gpu", "--no-sandbox",
            "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
            "--disable-component-update", "--password-store=basic",
            "--user-data-dir=" + str(profile), "--remote-debugging-port=0",
            "--window-size=800,600", "--app=" + url + "/a"],
            env=dict(env, WAYLAND_DEBUG="client"),
            stdout=(out / "chrome.stdout").open("wb"),
            stderr=(out / "chrome.stderr").open("wb"))
        processes.append(chrome)
        appeared = wait_message("app_appeared")
        app = appeared["app_id"]
        receipt["app"] = appeared
        say({"type": "set_app_bounds", "app_id": app, "position": [0, 0], "size": [800, 600]})
        say({"type": "focus_app", "app_id": app})
        say({"type": "pointer_motion", "app_id": app, "x": 300, "y": 200, "moved": True})
        input_say = say
        input_app = app
        if args.engine:
            outer_runtime = out / "outer-runtime"
            outer_runtime.mkdir(mode=0o700)
            outer_env = dict(env, XDG_RUNTIME_DIR=str(outer_runtime), WAYLAND_DISPLAY="not-live")
            outer = subprocess.Popen([
                args.compositor, "--chrome-socket", str(outer_runtime / "control"),
                "--session", str(out / "outer-session.json"), "--config", str(config),
                "--software-compositing", "yes"], env=outer_env,
                stdout=(out / "outer.stdout").open("wb"),
                stderr=(out / "outer.stderr").open("wb"))
            processes.append(outer)
            until(lambda: (out / "outer-session.json").exists(), "outer compositor session")
            outer_session = json.loads((out / "outer-session.json").read_text())
            outer_control = socket.socket(socket.AF_UNIX)
            outer_control.connect(str(outer_runtime / "control"))
            def outer_say(message):
                outer_control.sendall((json.dumps(message) + "\n").encode())
            outer_say({"type": "hello", "protocol_version": 1})
            shell = out / "shell"
            shell.mkdir()
            (shell / "pinch.js").write_text('''
export const HostShell = (_root, desktop) => {
  const draw = () => {
    for (const item of desktop.windows) {
      if (document.getElementById(item.appId)) continue;
      const app = document.createElement('app');
      app.id = item.appId;
      app.setAttribute('app-id', item.appId);
      Object.assign(app.style, {position:'fixed',left:'0',top:'0',width:'800px',height:'600px'});
      document.body.append(app);
    }
  };
  desktop.addEventListener('windowschanged', draw);
  draw();
};
''')
            engine_profile = out / "engine-profile"
            outer_env["WAYLAND_DISPLAY"] = outer_session["wayland_display"]
            engine = subprocess.Popen([
                str(Path(args.engine) / "chrome"), "--ozone-platform=wayland", "--disable-gpu",
                "--no-sandbox", "--no-first-run", "--disable-component-update",
                "--disable-background-networking", "--password-store=basic",
                "--user-data-dir=" + str(engine_profile), "--remote-debugging-port=0",
                "--window-size=800,600", "--app=domicile://shell/",
                "--domicile-shell-root=" + str(shell), "--domicile-shell-module=pinch.js",
                "--domicile-control-socket=" + str(runtime / "control"),
                "--domicile-broker-socket=" + str(outer_runtime / "broker")], env=outer_env,
                stdout=(out / "engine.stdout").open("wb"),
                stderr=(out / "engine.stderr").open("wb"))
            processes.append(engine)
            outer_control.settimeout(30)
            for line in outer_control.makefile("r"):
                message = json.loads(line)
                if message["type"] == "app_appeared":
                    input_app = message["app_id"]
                    break
            input_say = outer_say
            outer_say({"type": "set_app_bounds", "app_id": input_app, "position": [0,0], "size": [800,600]})
            outer_say({"type": "focus_app", "app_id": input_app})
            outer_say({"type": "pointer_motion", "app_id": input_app, "x": 300, "y": 200, "moved": True})
            until(lambda: (engine_profile / "DevToolsActivePort").exists(), "engine debugging port")
            engine_port = int((engine_profile / "DevToolsActivePort").read_text().splitlines()[0])
            shell_wire = cdp_wire.connect(cdp_wire.shell_target(engine_port))
            def shell_evaluate(expression):
                return cdp_wire.command(shell_wire, 500, "Runtime.evaluate", {"expression":expression,"returnByValue":True})["result"]["result"].get("value")
            until(lambda: shell_evaluate("!!document.querySelector('app')"), "engine app element")
            receipt["engine"] = args.engine
            receipt["shell_scale_before"] = shell_evaluate("visualViewport.scale")
        portfile = profile / "DevToolsActivePort"
        until(portfile.exists, "Chrome debugging port")
        port = int(portfile.read_text().splitlines()[0])
        def fixture_target():
            with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % port) as response:
                targets = json.load(response)
            return next((t for t in targets if t.get("url", "").startswith(url)), None)
        target = until(fixture_target, "fixture target")
        wire = cdp_wire.connect(target["webSocketDebuggerUrl"])
        sequence = 0
        def command(method, params=None):
            nonlocal sequence
            sequence += 1
            answer = cdp_wire.command(wire, sequence, method, params or {})
            assert "error" not in answer, answer
            return answer["result"]
        def evaluate(expression):
            answer = command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
            assert "exceptionDetails" not in answer, answer
            return answer["result"]["value"]
        def state():
            return evaluate("({url:location.href,scale:visualViewport.scale,scrollY,innerWidth,ready:document.readyState})")
        receipt["version"] = command("Browser.getVersion")
        until(lambda: state()["ready"] == "complete", "page load")
        time.sleep(0.5)
        receipt["before_pinch"] = state()
        def pinch(phase, **fields):
            input_say(dict(type="pointer_pinch", app_id=input_app, phase=phase,
                     device=7, time=int(time.monotonic()*1000) & 0xffffffff, **fields))
        receipt["pinch_checked"] = not args.history_only
        if not args.history_only:
            pinch("begin", fingers=2)
            for scale in [1.05, 1.1, 1.2, 1.35, 1.5]:
                time.sleep(0.03)
                pinch("update", dx=0, dy=0, scale=scale, rotation=0)
            pinch("end", canceled=False)
            time.sleep(0.7)
            receipt["after_pinch"] = state()
            if args.engine:
                receipt["shell_scale_after"] = shell_evaluate("visualViewport.scale")
            (out / "receipt.json").write_text(json.dumps(receipt, indent=2))
            assert receipt["after_pinch"]["scale"] > 1.2, receipt
            if args.engine:
                assert receipt["shell_scale_after"] == receipt["shell_scale_before"], receipt
                command("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
                shell_evaluate("""window.__pinchApp = document.querySelector('app');
                    window.__removeOnPinch = event => {
                      if (event.ctrlKey && event.deltaY !== 0) {
                        window.removeEventListener('wheel', __removeOnPinch, true);
                        __pinchApp.remove();
                      }
                    };
                    window.addEventListener('wheel', __removeOnPinch,
                      {capture:true, passive:true}); true""")
                pinch("begin", fingers=2)
                time.sleep(0.05)
                pinch("update", dx=0, dy=0, scale=1.2, rotation=0)
                time.sleep(0.05)
                pinch("update", dx=0, dy=0, scale=1.4, rotation=0)
                pinch("end", canceled=False)
                time.sleep(0.4)
                receipt["removed_during_pinch"] = {
                    "chrome": state(), "shell_scale": shell_evaluate("visualViewport.scale")}
                assert receipt["removed_during_pinch"]["chrome"]["scale"] == 1, receipt
                assert receipt["removed_during_pinch"]["shell_scale"] == 1, receipt
                trace = re.sub(r"\x1b\[[0-9;]*m", "",
                               (out / "chrome.stderr").read_text())
                canceled_ends = re.findall(
                    r"zwp_pointer_gesture_pinch_v1[^\n]*\.end\(\d+,\s*\d+,\s*1\)",
                    trace)
                receipt["native_pinch_cancellations"] = len(canceled_ends)
                assert canceled_ends, "Chrome received no canceled Wayland pinch end"
                shell_evaluate("document.body.append(__pinchApp); true")
                input_say({"type":"pointer_motion", "app_id":input_app,
                           "x":301,"y":201,"moved":True})
                time.sleep(0.1)
                pinch("begin", fingers=2)
                pinch("update", dx=0, dy=0, scale=1.2, rotation=0)
                pinch("end", canceled=False)
                time.sleep(0.4)
                receipt["pinch_after_removal"] = state()
                assert receipt["pinch_after_removal"]["scale"] > 1.1, receipt
        command("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
        for path in ["/a", "/b", "/c"]:
            command("Page.navigate", {"url": url + path})
            until(lambda: state()["url"] == url+path and state()["ready"] == "complete", "navigate " + path)
        receipt["before_history"] = state()
        def axis(dx, dy, stop=False):
            input_say(dict(type="pointer_axis", app_id=input_app, source="finger", dx=dx, dy=dy,
                     v120_x=0, v120_y=0, stop_x=stop, stop_y=stop))
        def swipe(distance):
            for _ in range(40):
                axis(distance, 0)
                time.sleep(0.01)
            axis(0, 0, True)
            time.sleep(1)
            return state()
        receipt["swipe_negative"] = swipe(-10)
        (out / "receipt.json").write_text(json.dumps(receipt, indent=2))
        assert receipt["swipe_negative"]["url"] == url + "/b", receipt
        receipt["swipe_positive"] = swipe(10)
        (out / "receipt.json").write_text(json.dumps(receipt, indent=2))
        assert receipt["swipe_positive"]["url"] == url + "/c", receipt
        for _ in range(20):
            axis(0, 3)
            time.sleep(0.01)
        axis(0, 0, True)
        time.sleep(0.5)
        receipt["vertical_scroll"] = state()
        assert receipt["vertical_scroll"]["url"] == url + "/c", receipt
        assert receipt["vertical_scroll"]["scrollY"] > 0, receipt
        receipt["passed"] = True
    finally:
        receipt["finished"] = time.time()
        receipt["unexpected_exits"] = [p.poll() for p in processes if p.poll() is not None]
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=20)
        server.shutdown()
        receipt["dumps"] = [str(path.relative_to(out)) for path in out.rglob("*.dmp")]
        (out / "receipt.json").write_text(json.dumps(receipt, indent=2))
    assert not receipt["unexpected_exits"], receipt
    assert not receipt["dumps"], receipt
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
