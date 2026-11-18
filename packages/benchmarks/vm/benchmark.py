# One boot of one desktop under one workload: wait for the desktop, start the
# workload's apps, let them settle, then sample memory and CPU over a window.
# desktops.nix fills in `DESKTOP`; the rest comes from the environment
# run.sh sets. See packages/benchmarks/README.md.
import datetime as dt
import json
import os

DESKTOP = json.loads(r"""@DESKTOP@""")
WORKLOAD = os.environ["BENCH_WORKLOAD"]
RESULT = os.environ["BENCH_RESULT"]
RUN = int(os.environ["BENCH_RUN"])
WAIT = dt.timedelta(seconds=300)
SETTLE_SECONDS = int(os.environ.get("BENCH_SETTLE_SECONDS", "120"))
WINDOW_SECONDS = int(os.environ.get("BENCH_WINDOW_SECONDS", "300"))
INTERVAL_SECONDS = 10
WORKLOADS = {
    "rest": [],
    "chat-and-web": ["slack", "browser"],
    "chat-web-and-editor": ["slack", "browser", "editor"],
}


def in_the_session(argv, log):
    """Starts `argv` as alice, in the environment the desktop's apps get."""
    quoted = " ".join(f"'{arg}'" for arg in argv)
    machine.succeed(f"runuser -u alice -- in-session {quoted} >{log} 2>&1 &")


def cdp_targets(port):
    return machine.succeed(f"curl -sf http://127.0.0.1:{port}/json/list || echo '[]'")


def the_desktop_is_up():
    if DESKTOP["compositor"] is None:
        machine.wait_until_succeeds("pgrep -u alice -x bash", timeout=WAIT)
        return
    machine.wait_until_succeeds(f"pgrep -u alice -f '{DESKTOP['compositor']}'", timeout=WAIT)
    machine.wait_until_succeeds("ls /run/user/1000/wayland-[0-9]", timeout=WAIT)


def start_slack():
    link = os.environ["BENCH_SLACK_LINK"]
    in_the_session([arg.replace("@LINK@", link) for arg in DESKTOP["slack"]], "/tmp/slack.log")
    port = DESKTOP["slackDevtoolsPort"]
    # Signed in: the workspace's client page loaded, not the sign-in screen.
    retry(lambda _: "app.slack.com/client" in cdp_targets(port), timeout=WAIT)


def start_browser():
    for index, argv in enumerate(DESKTOP["browser"]):
        in_the_session(argv, f"/tmp/browser-{index}.log")
    port = DESKTOP["browserDevtoolsPort"]
    retry(lambda _: all(page in cdp_targets(port) for page in DESKTOP["pages"]), timeout=WAIT)


def start_editor():
    in_the_session(DESKTOP["editor"], "/tmp/editor.log")
    machine.wait_until_succeeds("pgrep -u alice -f codium", timeout=WAIT)


STARTS = {"slack": start_slack, "browser": start_browser, "editor": start_editor}


def sample():
    return json.loads(machine.succeed("bench-sample"))


def measure():
    samples = [sample()]
    for _ in range(WINDOW_SECONDS // INTERVAL_SECONDS):
        machine.sleep(INTERVAL_SECONDS)
        samples.append(sample())
    return samples


machine.start()
try:
    the_desktop_is_up()
    machine.sleep(SETTLE_SECONDS)
    for app in WORKLOADS[WORKLOAD]:
        STARTS[app]()
    if WORKLOADS[WORKLOAD]:
        machine.sleep(SETTLE_SECONDS)
    machine.screenshot(f"{DESKTOP['name']}-{WORKLOAD}-{RUN}")
    samples = measure()
    machine.screenshot(f"{DESKTOP['name']}-{WORKLOAD}-{RUN}-end")
    result = {
        "cores": int(machine.succeed("nproc").strip()),
        "desktop": DESKTOP["name"],
        "processes": machine.succeed("ps -u alice -o pid=,rss=,args= | cut -c1-200"),
        "run": RUN,
        "samples": samples,
        "top": json.loads(machine.succeed("bench-top")),
        "workload": WORKLOAD,
    }
    with open(RESULT, "w") as file:
        json.dump(result, file, indent=2)
except Exception:
    machine.screenshot(f"{DESKTOP['name']}-{WORKLOAD}-{RUN}-failed")
    for command in [
        "tail -20 /tmp/slack.log /tmp/browser-*.log /tmp/editor.log /tmp/desktop.log 2>/dev/null | cut -c1-200",
        "ps -u alice -o pid=,rss=,args= | cut -c1-160",
    ]:
        print(f"$ {command}")
        print(machine.execute(f"{command} 2>&1")[1])
    raise
finally:
    machine.shutdown()
