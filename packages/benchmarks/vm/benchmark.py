# One boot of one desktop under one workload: wait for the desktop, start the
# workload's apps, let them settle, then sample memory and CPU over a window.
# desktops.nix fills in `DESKTOP`; the rest comes from the environment
# run.sh sets. See packages/benchmarks/README.md.
import datetime as dt
import json
import os
import shlex
import shutil
import statistics
import subprocess
import time
import traceback

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


def session_command(argv):
    """`argv` as alice, in the environment the desktop's apps get.

    `@LINK@` stands for the Slack link in /tmp/slack-link, read in the VM so
    the one-time link stays out of the log, which prints every command.
    """
    quoted = " ".join('"$(cat /tmp/slack-link)"' if arg == "@LINK@" else f"'{arg}'" for arg in argv)
    # Root reads it: Hyprland's /proc/<pid>/environ isn't readable by alice.
    machine.succeed(
        f"cp /proc/$(pgrep -u alice -o -f '{DESKTOP['compositor']}')/environ /tmp/session-environ"
        " && chmod 644 /tmp/session-environ"
    )
    return f"runuser -u alice -- in-session {quoted}"


def in_the_session(argv, log):
    """Starts `argv` in the session, in the background, as its launcher would."""
    machine.succeed(f"{session_command(DESKTOP['launch'] + argv)} >{log} 2>&1 &")


def focused_window():
    """The window with the keyboard, on a desktop that lists its windows."""
    windows = json.loads(machine.succeed(session_command(DESKTOP["windows"])))
    return next((window for window in windows if window["focused"]), None)


def split_out(matches, what):
    """Moves the focused window out of its tab group, beside it, once it is
    the window `matches` picks: a desktop that tabs new windows (`split`)
    then shows each app at once, as the others do."""
    if DESKTOP["split"] is None:
        return

    def ready(_):
        window = focused_window()
        return window is not None and matches(window)

    retry(ready, timeout=WAIT)
    machine.succeed(session_command(DESKTOP["split"]))
    print(f"split {what} out beside the others")


def cdp_urls():
    """Every DevTools page's address, its query left off, which can hold tokens."""
    return machine.execute(
        "curl -s http://127.0.0.1:9222/json/list http://127.0.0.1:9223/json/list"
        " | grep -o '\"url\": \"[^\"?]*' | cut -c9-120"
    )[1].split()


def cdp_targets(port):
    return machine.succeed(f"curl -sf http://127.0.0.1:{port}/json/list || echo '[]'")


def evaluate(target, expression):
    """`expression`'s value in a DevTools page, a promise's awaited."""
    address = shlex.quote(target["webSocketDebuggerUrl"])
    return json.loads(machine.succeed(f"bench-eval {address} {shlex.quote(expression)}"))


def loaded(target, expression="document.readyState === 'complete'"):
    """Whether a page has loaded, by `expression`: a page that is still
    navigating can't answer yet, which counts as not loaded."""
    address = shlex.quote(target["webSocketDebuggerUrl"])
    status, output = machine.execute(f"bench-eval {address} {shlex.quote(expression)}")
    return status == 0 and json.loads(output) is True


def pages(port, matches):
    """The DevTools documents on `port` whose address `matches`: Domicile's
    windows aren't of type `page`, so only workers are left out."""
    return [
        target
        for target in json.loads(cdp_targets(port))
        if not target.get("type", "").endswith("worker") and matches(target.get("url", ""))
    ]


# Once-per-run measures, by name: see `MEASURES` in src/summary.ts.
MEASURED: dict[str, float] = {}


def the_desktop_is_up():
    if DESKTOP["compositor"] is None:
        machine.wait_until_succeeds("pgrep -u alice -x bash", timeout=WAIT)
        return
    machine.wait_until_succeeds(f"pgrep -u alice -f '{DESKTOP['compositor']}'", timeout=WAIT)
    machine.wait_until_succeeds("ls /run/user/1000/wayland-[0-9]", timeout=WAIT)


def fresh_slack_link():
    """A new one-time link, fetched on the host right before it's used: the
    links expire within minutes, and a boot and settle take several."""
    link = os.environ["BENCH_SLACK_LINK_FILE"]
    with open(link, "w") as file:
        subprocess.run(["slack-magic-link"], check=True, stdout=file)
    machine.copy_from_host(link, "/tmp/slack-link")
    machine.succeed("chmod 644 /tmp/slack-link")


def slack_signed_in(_):
    """The workspace's client page loaded, not the sign-in screen: the
    address alone shows as soon as Slack starts to load it."""
    clients = pages(DESKTOP["slackDevtoolsPort"], lambda url: "app.slack.com/client" in url)
    return any(loaded(target) for target in clients)


def start_slack():
    fresh_slack_link()
    started = time.monotonic()
    in_the_session(DESKTOP["slack"], "/tmp/slack.log")
    try:
        retry(slack_signed_in, timeout=dt.timedelta(seconds=90))
    except Exception:
        # A link given to Slack as it starts can be lost to its first-run
        # screen; given to the running app, it signs in. The launch counts
        # from then: the first try's wait is the link's, not the desktop's.
        print(f"Slack isn't signed in yet: {cdp_urls()}; giving it a new link")
        fresh_slack_link()
        started = time.monotonic()
        in_the_session(DESKTOP["slack"], "/tmp/slack-again.log")
        retry(slack_signed_in, timeout=WAIT)
    MEASURED["slackLaunchSeconds"] = round(time.monotonic() - started, 1)


def browser_pages():
    return pages(
        DESKTOP["browserDevtoolsPort"], lambda url: any(url.startswith(page) for page in DESKTOP["pages"])
    )


def start_browser():
    started = time.monotonic()
    for index, argv in enumerate(DESKTOP["browser"]):
        in_the_session(argv, f"/tmp/browser-{index}.log")
        if index == 0 and "slack" in WORKLOADS[WORKLOAD]:
            # The first page beside Slack; the rest open as its tabs, as
            # the other desktops' browser opens them.
            page = DESKTOP["pages"][0]
            split_out(lambda window: (window.get("url") or "").startswith(page), "the browser")
    def every_page_loaded(_):
        targets = browser_pages()
        return all(any(t["url"].startswith(page) for t in targets) for page in DESKTOP["pages"]) and all(
            loaded(target) for target in targets
        )

    retry(every_page_loaded, timeout=WAIT)
    MEASURED["browserLaunchSeconds"] = round(time.monotonic() - started, 1)


def start_editor():
    started = time.monotonic()
    in_the_session(DESKTOP["editor"], "/tmp/editor.log")

    # Drawn: the workbench's activity bar is on its page.
    def drawn(_):
        workbenches = pages(DESKTOP["editorDevtoolsPort"], lambda url: "workbench" in url)
        return any(
            loaded(target, "!!document.querySelector('.monaco-workbench .part.activitybar')")
            for target in workbenches
        )

    retry(drawn, timeout=WAIT)
    MEASURED["editorLaunchSeconds"] = round(time.monotonic() - started, 1)
    split_out(
        lambda window: "codium" in f"{window.get('app')} {window.get('title')}".lower(), "the editor"
    )


# Every list of processes: the one-time Slack link is on Slack's command
# line, and the log and the artifact are public.
PROCESSES = "ps -u alice -o pid=,rss=,args= | sed 's,magic-login/[^ ]*,magic-login/…,' | cut -c1-200"

STARTS = {"slack": start_slack, "browser": start_browser, "editor": start_editor}


def qemu_pid():
    """QEMU, the driver's child or a descendant of it."""
    parents = {}
    for entry in os.listdir("/proc"):
        if entry.isdigit():
            try:
                with open(f"/proc/{entry}/stat") as file:
                    parents[int(entry)] = int(file.read().rsplit(")", 1)[1].split()[1])
            except OSError:
                continue
    assert machine.process, "the machine isn't running"
    pids = [machine.process.pid]
    while pids:
        pid = pids.pop()
        with open(f"/proc/{pid}/comm") as file:
            # nixpkgs wraps it: `.qemu-system-x8`, its name cut to 15.
            if "qemu-system" in file.read():
                return pid
        pids += [child for child, parent in parents.items() if parent == pid]
    raise RuntimeError("no QEMU under the driver")


# The CI runner's PATH leaves out the system's programs, where NixOS puts it.
NVIDIA_SMI = shutil.which("nvidia-smi") or "/run/current-system/sw/bin/nvidia-smi"


def host_sample(pid):
    """QEMU's CPU ticks and its share of the host's NVIDIA card."""
    with open(f"/proc/{pid}/stat") as file:
        fields = file.read().rsplit(")", 1)[1].split()
    # pmon's columns vary by driver, so they're found by the header's names.
    lines = subprocess.run(
        [NVIDIA_SMI, "pmon", "-c", "1", "-s", "um"], check=True, capture_output=True, text=True
    ).stdout.splitlines()
    header = lines[0].lstrip("#").split()
    rows = [dict(zip(header, line.split())) for line in lines if not line.startswith("#")]
    mine = [row for row in rows if row.get("pid") == str(pid)]

    def total(column):
        return sum(int(row[column]) for row in mine if row.get(column, "-").isdigit())

    return {
        "gpuMib": total("fb"),
        "gpuPercent": total("sm"),
        # utime and stime, every thread's.
        "qemuTicks": int(fields[11]) + int(fields[12]),
        "seconds": time.monotonic(),
    }


def screenshot(name):
    """A picture of the screen in the run's output directory, the proof of
    what the run measured.

    Taken in the session with the desktop's own tool: under virgl, QEMU's
    `screendump` has "no surface" to read. The console has no session.
    """
    if DESKTOP["screenshot"] is None:
        machine.screenshot(name)
        return
    path = f"/tmp/{name}.png"
    # A tool that hangs fails the boot now, not at the driver's timeout.
    machine.succeed(f"timeout 60 {session_command(DESKTOP['screenshot'] + [path])} 2>&1")
    machine.copy_from_machine(path)


# Animates a box on the page for 10 s and answers every frame's time.
ANIMATE = """new Promise((resolve) => {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:0;top:0;width:200px;height:200px;"
    + "background:#c33;z-index:2147483647";
  document.documentElement.append(box);
  const times = [];
  const step = (now) => {
    times.push(now);
    box.style.transform = `translateX(${(now / 5) % 400}px)`;
    if (now - times[0] < 10000) requestAnimationFrame(step);
    else { box.remove(); resolve(times); }
  };
  requestAnimationFrame(step);
})"""

# Times each key press from the event's own stamp to the frame after the
# page painted its answer: a box that changes color.
LISTEN = """(() => {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:0;top:0;width:50px;height:50px;"
    + "background:#33c;z-index:2147483647";
  document.documentElement.append(box);
  window.benchLags = [];
  addEventListener("keydown", (event) => {
    box.style.background = box.style.background === "rgb(51, 51, 204)" ? "#3c3" : "#33c";
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => window.benchLags.push(performance.now() - event.timeStamp);
      channel.port2.postMessage(null);
    });
  }, true);
})()"""

KEY_PRESSES = 20


def smoothness():
    """The frame rate and long frames of an animated page, and the time from
    a key press to its paint, on the browser page that shows and has the
    keyboard: the last one opened, Slack and the editor beside it."""
    if DESKTOP["focusBrowser"] is not None:
        # The desktop's focus reaches the window, but Chromium can keep its
        # own off the page (on the address bar): the page's tab takes it.
        [front] = [target for target in browser_pages() if evaluate(target, "document.visibilityState") == "visible"]
        machine.succeed(f"bench-eval {shlex.quote(front['webSocketDebuggerUrl'])} --front")
        machine.succeed(session_command(DESKTOP["focusBrowser"]))
        machine.sleep(1)
    states = [
        (target, evaluate(target, "[document.visibilityState, document.hasFocus()]"))
        for target in browser_pages()
    ]
    shown = [target for target, state in states if state == ["visible", True]]
    if len(shown) != 1:
        found = [(target["url"].split("?")[0], state) for target, state in states]
        raise RuntimeError(f"{len(shown)} browser pages show with the keyboard, not one: {found}")
    [target] = shown
    times = evaluate(target, ANIMATE)
    seconds = (times[-1] - times[0]) / 1000
    gaps = [later - earlier for earlier, later in zip(times, times[1:])]
    MEASURED["frameRate"] = round(len(gaps) / seconds, 1)
    MEASURED["longFrames"] = round(sum(gap > 25 for gap in gaps) * 10 / seconds, 1)
    if not DESKTOP["keyLag"]:
        return
    evaluate(target, LISTEN)
    for _ in range(KEY_PRESSES):
        machine.send_key("shift")
        time.sleep(0.3)
    machine.sleep(1)
    lags = evaluate(target, "window.benchLags")
    if len(lags) < KEY_PRESSES * 3 // 4:
        raise RuntimeError(f"the page saw {len(lags)} of {KEY_PRESSES} key presses")
    MEASURED["inputLagMs"] = round(statistics.median(lags), 1)
    MEASURED["inputLagP95Ms"] = round(statistics.quantiles(lags, n=20)[-1], 1)


def gpu_busy(seconds):
    """Reads QEMU's share of the card each second for `seconds`, in the
    background: `measure()` collects the average."""
    return subprocess.Popen(
        [NVIDIA_SMI, "pmon", "-d", "1", "-c", str(seconds), "-s", "u"],
        stdout=subprocess.PIPE,
        text=True,
    )


def gpu_busy_average(pmon, pid):
    output, _ = pmon.communicate(timeout=60)
    if pmon.returncode != 0:
        raise RuntimeError(f"nvidia-smi pmon failed: {pmon.returncode}")
    lines = output.splitlines()
    header = lines[0].lstrip("#").split()
    rows = [dict(zip(header, line.split())) for line in lines if not line.startswith("#")]
    # A second in which QEMU drew nothing shows "-".
    busy = [int(row["sm"]) if row["sm"].isdigit() else 0 for row in rows if row.get("pid") == str(pid)]
    if not busy:
        raise RuntimeError("pmon never listed QEMU")
    return round(statistics.mean(busy), 1)


def sample():
    reading = json.loads(machine.succeed("bench-sample"))
    if DESKTOP["gpu"]:
        reading["host"] = host_sample(qemu_pid())
    return reading


def thread_ticks():
    ticks = {}
    for line in machine.succeed("bench-threads").splitlines():
        path, label, count = line.split("\t")
        ticks[path] = (label, int(count))
    return ticks


def busiest(before, after, seconds):
    """The threads that spent the most CPU between two readings, by label,
    as a percentage of one core. A thread that started in between counts
    from zero; one that ended doesn't count."""
    tick = int(machine.succeed("getconf CLK_TCK"))
    spent = {}
    for path, (label, count) in after.items():
        spent[label] = spent.get(label, 0) + count - before.get(path, (label, 0))[1]
    ranked = sorted(spent.items(), key=lambda item: -item[1])[:25]
    return [
        {"name": label, "cpuPercent": round(100 * count / tick / seconds, 2)}
        for label, count in ranked
        if count > 0
    ]


def measure():
    pmon = gpu_busy(WINDOW_SECONDS) if DESKTOP["gpu"] else None
    start, before = time.monotonic(), thread_ticks()
    samples = [sample()]
    for _ in range(WINDOW_SECONDS // INTERVAL_SECONDS):
        machine.sleep(INTERVAL_SECONDS)
        samples.append(sample())
    threads = busiest(before, thread_ticks(), time.monotonic() - start)
    if pmon is not None:
        MEASURED["gpuBusyPercent"] = gpu_busy_average(pmon, qemu_pid())
    return samples, threads


machine.start()
try:
    the_desktop_is_up()
    machine.sleep(SETTLE_SECONDS)
    for app in WORKLOADS[WORKLOAD]:
        STARTS[app]()
    if WORKLOADS[WORKLOAD]:
        machine.sleep(SETTLE_SECONDS)
    if WORKLOAD == "rest":
        # Everything the VM has: the desktop and the same apps on each.
        MEASURED["storeMib"] = int(machine.succeed("du -sm /nix/store").split()[0])
    if WORKLOAD == "chat-and-web":
        # Before the window, so its work isn't measured.
        smoothness()
    if DESKTOP["gpu"]:
        # Proof the desktop draws on the card and not in software: the
        # guest's GL renderer, and the engines' GPU processes' flags.
        print(machine.execute("eglinfo -B -p surfaceless 2>&1 | grep -i renderer")[1])
        print(machine.execute("ps -u alice -o args= | grep -- --type=gpu-process | grep -o -- '--use-[^ ]*\\|--disable-gpu[^ ]*\\|--ozone-platform=[^ ]*' | sort | uniq -c")[1])
    if DESKTOP["split"] is not None:
        # Proof of the layout: each group and the windows in it.
        print(machine.succeed(session_command(["domicile", "send-shell", "get-tree"])))
    screenshot(f"{DESKTOP['name']}-{WORKLOAD}-{RUN}")
    # Let the screenshot's own work finish before measuring.
    machine.sleep(INTERVAL_SECONDS)
    samples, threads = measure()
    screenshot(f"{DESKTOP['name']}-{WORKLOAD}-{RUN}-end")
    result = {
        "cores": int(machine.succeed("nproc").strip()),
        "desktop": DESKTOP["name"],
        "measures": MEASURED,
        **({"hostTicksPerSecond": os.sysconf("SC_CLK_TCK")} if DESKTOP["gpu"] else {}),
        "processes": machine.succeed(PROCESSES),
        "run": RUN,
        "samples": samples,
        "threads": threads,
        "top": json.loads(machine.succeed("bench-top")),
        "workload": WORKLOAD,
    }
    with open(RESULT, "w") as file:
        json.dump(result, file, indent=2)
    # The run in the job's log too, readable without the artifact.
    print(f"result: {json.dumps({**result, 'processes': None})}")
except Exception:
    # The failure first: a failing step below would hide it.
    traceback.print_exc()
    print(f"DevTools pages: {cdp_urls()}")
    # Why a Slack page stalled: what it logged, errors and warnings only, with
    # the workspace's name masked (GitHub masks secrets in the log too).
    workspace = os.environ.get("BENCH_SLACK_WORKSPACE") or "\0"
    for port in (9222, 9223, 9224):
        for target in json.loads(cdp_targets(port)):
            url = target.get("url", "")
            if url.startswith("vscode-file:") and "webSocketDebuggerUrl" in target:
                # Why the editor's workbench didn't draw: how far it got.
                status, shown = machine.execute(
                    f"bench-eval '{target['webSocketDebuggerUrl']}' "
                    + shlex.quote(
                        "[document.readyState, document.querySelector('.monaco-workbench')?.className"
                        " ?? null, document.body?.innerText.slice(0, 300) ?? null]"
                    )
                )
                print(f"== editor page {url.split('/')[-1]}: {shown if status == 0 else 'unreadable'}")
                print(machine.execute(f"bench-console '{target['webSocketDebuggerUrl']}'")[1])
            if "slack.com" in url and "webSocketDebuggerUrl" in target:
                page = target["url"].split("?")[0]
                logged = machine.execute(f"bench-console '{target['webSocketDebuggerUrl']}'")[1]
                print(f"== console of {page}".replace(workspace, "…"))
                print(logged.replace(workspace, "…"))
    for command in [
        "dmesg | grep -iE 'virgl|drm|gpu' | tail -10",
        "ls -la /tmp/*.log",
        # Whether Slack got as far as writing its profile.
        "ls -la /home/alice/.config/Slack",
        # A link left here is one Slack's first instance never read.
        "ls -la /home/alice/.config/Slack/DomicileSingletonInbox",
        "for log in /tmp/*.log; do echo \"== $log\"; tail -20 \"$log\" | sed 's,magic-login/[^ ]*,magic-login/…,' | cut -c1-200; done",
        PROCESSES,
    ]:
        print(f"$ {command}")
        print(machine.execute(f"{command} 2>&1")[1])
    screenshot(f"{DESKTOP['name']}-{WORKLOAD}-{RUN}-failed")
    raise
finally:
    # Not shutdown(): some desktops take half an hour to power off, and
    # nothing on the disk is kept.
    machine.crash()
