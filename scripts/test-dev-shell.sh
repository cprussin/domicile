#!/usr/bin/env bash
# What dev mode hands the desktop, and what it refuses.
#
# `dev-shell.sh` is a handful of decisions and three processes, and the
# decisions are the part worth testing: which module the desktop is told to
# serve, that the compositor is the one out of this checkout rather than
# whatever sits beside the binary, where the desktop's control socket is taken
# from, and what a build that just finished does. Every one of those is
# invisible until a desktop starts, and each fails as something else — a blank
# page, a shell that never joins, a dev loop that builds and reloads nothing.
#
# The launch is run out of the real script rather than copied, with `nix`,
# `cargo`, `bunx` and `domicile` itself shadowed so nothing is fetched, nothing
# is built and no browser starts. `dev-shell-reload.sh` needs none of that: it
# is a script of its own, taking the binary, the module and the socket file as
# arguments, so the loop that runs below is the one a desk runs.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT/scripts/dev-shell.sh"
[ -x "$SCRIPT_UNDER_TEST" ] || { echo "no $SCRIPT_UNDER_TEST" >&2; exit 1; }

# From the engine resolution to the last line: the two blocks that decide
# anything, and nothing in between them but comments.
LAUNCH="$(awk '/^ENGINE="\$\{DOMICILE_ENGINE:-\}"$/,0' "$SCRIPT_UNDER_TEST")"
[ -n "$LAUNCH" ] || {
  echo "no launch in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}
case "$LAUNCH" in
  (*DOMICILE_PAGE*target/debug/domicile*) ;;
  (*) echo "the launch block no longer starts a desktop." >&2; exit 1 ;;
esac

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CHECKOUT="$WORK/checkout"

# What the desktop was told, in the order a reader cares about it. `env` rather
# than a fixed list, so a variable that stops being passed shows up as a
# missing line instead of as nothing at all.
launch() { # $1 DOMICILE_ENGINE
  (
    ROOT="$CHECKOUT"
    SHELL_NAME=simple
    PAGE_DIR="$WORK/page"
    DOMICILE_ENGINE="$1"
    # `nix` must not be reached for at all when an engine was handed in: a dev
    # loop that fetches something when it was told what to use is a dev loop
    # that needs a network.
    nix() { echo "nix $*" >>"$WORK/nix.log"; echo "$WORK/store-engine"; }
    command() { [ "${2:-}" = "nix" ] && return 0; builtin command "$@"; }
    # `cargo` shadowed: the launch builds the two components out of the
    # checkout now, and this test is about what it hands over rather than
    # about cargo working.
    cargo() { echo "cargo $*" >>"$WORK/cargo.log"; }
    mkdir -p "$ROOT/target/debug"
    cat >"$ROOT/target/debug/domicile" <<'STUB'
#!/usr/bin/env bash
echo "shell=$1"
echo "engine=${DOMICILE_ENGINE:-unset}"
echo "page=${DOMICILE_PAGE:-}"
echo "reload=${DOMICILE_DEV_RELOAD:-unset}"
echo "compositor=${DOMICILE_COMPOSITOR:-unset}"
echo "bridge=${DOMICILE_BRIDGE:-unset}"
# The two lines a supervisor prints that this script reads: where it answers,
# and that it is up. The expectations below read them back out of
# `bin/domicile.rs`, so this stub cannot go on saying something the real one
# stopped saying.
echo "DOMICILE_SOCK=/run/user/1000/domicile-ipc.4242.sock"
echo "domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above."
STUB
    chmod +x "$ROOT/target/debug/domicile"
    eval "$LAUNCH"
  ) 2>&1
}

: >"$WORK/nix.log"
handed="$(launch "$WORK/my-engine")"

expect "the engine handed in is the one that is run" \
  "engine=$WORK/my-engine" \
  "$(printf '%s\n' "$handed" | sed -n 's/^engine=/engine=/p')"

# AND NO DEV RELOAD. It was the bridge that read this, served the token and
# wrote the poller into the page; both went with the bridge and the C++ that
# writes the document has nothing in their place. Handing it over now would
# switch nothing on while reading like a dev loop that reloads — which is the
# expensive way to find out that it does not.
expect "no reload token is handed over any more" "reload=unset" \
  "$(printf '%s\n' "$handed" | sed -n 's/^reload=/reload=/p')"

# THE MODULE, NOT THE DIRECTORY HOLDING IT. `domicile` takes the file now, and
# it refuses a directory rather than looking inside one for a name it no longer
# knows — so a dev loop that handed over `$PAGE_DIR` would not start at all,
# and would say so about a path the script never printed. `shell.js` is the
# name the shell's own vite config pins, which is why this can join it on.
expect "the desktop is handed the module the watcher writes" \
  "page=$WORK/page/shell.js" \
  "$(printf '%s\n' "$handed" | sed -n 's/^page=/page=/p')"

# `domicile` builds nothing, so this script does — and hands over what it
# built. Unset here would be the desktop looking for components beside a
# binary in `target/debug`, where nobody installs anything.
expect "the compositor comes out of this checkout" \
  "compositor=$CHECKOUT/target/debug/domicile-compositor" \
  "$(printf '%s\n' "$handed" | sed -n 's/^compositor=/compositor=/p')"

# AND NO BRIDGE. The engine serves the shell itself over `domicile://` now, so
# there is no third process and nothing sets this. A dev loop that still handed
# one over would be starting a page server nothing reads.
expect "no bridge is handed over any more" "bridge=unset" \
  "$(printf '%s\n' "$handed" | sed -n 's/^bridge=/bridge=/p')"

expect "an engine that was handed in is not fetched again" "" \
  "$(cat "$WORK/nix.log")"

# WHERE THE DESKTOP ANSWERS, TAKEN FROM THE DESKTOP. `domicile` sets
# `DOMICILE_SOCK` on what it spawns and this script is not one of those — it
# starts the supervisor rather than being started by it — so the path is read
# off the line the supervisor prints on its way up, as it goes past. Working it
# out instead would mean a second copy of `control_socket::address` in bash,
# agreeing with the binary until the day it did not.
#
# AND ONLY ONCE IT IS UP. The socket is bound before the engine starts, so a
# path written the moment it is printed is a path a reload can reach while
# there is still nothing serving a page: the load would be refused, by a
# desktop that is fine, about a build nobody had touched.
expect "the socket is taken from what the desktop printed" \
  "/run/user/1000/domicile-ipc.4242.sock" "$(cat "$WORK/sock")"

# And that those two lines are the supervisor's own. They are strings in two
# programs, which is a thing to keep true rather than a thing to hope about:
# the failure this catches is a reword in Rust that leaves a dev loop silently
# never reloading.
SUPERVISOR="$ROOT/packages/domicile-launch/src/bin/domicile.rs"
expect "the supervisor still names its socket in a line of its own" "yes" \
  "$(grep -qF 'println!("{VARIABLE}={}", places.control.display())' "$SUPERVISOR" &&
     echo yes || echo no)"
expect "and that variable is still the one the script matches on" "yes" \
  "$(grep -qF 'VARIABLE: &str = "DOMICILE_SOCK"' \
       "$ROOT/packages/domicile-launch/src/control_socket.rs" && echo yes || echo no)"
expect "and it still says when a desktop is up" "yes" \
  "$(grep -qF '"domicile is up.' "$SUPERVISOR" && echo yes || echo no)"

# And when nothing was handed in, the flake's pinned engine is what runs.
: >"$WORK/nix.log"
fetched="$(launch "")"
expect "the pinned engine is fetched when none was given" \
  "engine=$WORK/store-engine" \
  "$(printf '%s\n' "$fetched" | sed -n 's/^engine=/engine=/p')"
expect "and it is the flake's own engine that is built" "yes" \
  "$(grep -q '#engine' "$WORK/nix.log" && echo yes || echo no)"

# The refusals, out of the real script, because a message naming a shell that
# does not exist is the whole of what a typo gets you.
refuse() { "$SCRIPT_UNDER_TEST" "$@" 2>&1 | head -1; }
expect "a shell nobody named is refused with the usage" \
  "usage: dev-shell.sh <shell>   e.g. dev-shell.sh manganese" \
  "$(refuse)"
expect "a shell that does not exist is named in the refusal" \
  "no shell 'nonesuch' — there is no packages/shell-nonesuch." \
  "$(refuse nonesuch)"

# WHAT A FINISHED BUILD DOES, which is the half of the dev loop that can be
# driven without a desktop. `dev-shell-reload.sh` is a script of its own for
# exactly that reason: the binary it calls, the module it watches, the file the
# socket arrives in and the two windows it coalesces over are all arguments, so
# what runs below is the loop itself rather than a copy of it.
RELOAD="$ROOT/scripts/dev-shell-reload.sh"
[ -x "$RELOAD" ] || { echo "no $RELOAD" >&2; exit 1; }

# A `domicile` that records what it was told and answers what the case asked
# for: `loaded`, or a refusal in the engine's own words — which is what the
# real one prints, because `Response::Refused` carries the engine's `why` out
# to the terminal the command was typed in.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/domicile" <<'STUB'
#!/usr/bin/env bash
echo "$* sock=${DOMICILE_SOCK:-unset}" >>"$DOMICILE_LOG"
read -r answer <"$DOMICILE_ANSWER"
if [ "$answer" = loaded ]; then
  exit 0
else
  echo "domicile: $answer" >&2
  exit 1
fi
STUB
chmod +x "$WORK/bin/domicile"

# The path a desktop would have printed. Nothing binds it here: what is under
# test is that the loop takes the socket from the file the launch writes it to
# and hands it to the binary, which is where `DOMICILE_SOCK` has to be.
SOCKET=/run/user/1000/domicile-ipc.4242.sock

# One case's own bundle, socket file and logs, and a loop watching them. The
# two windows are in tenths of a second — the loop's own tick — so that a case
# can hold a burst open for longer than any stall this runner has in it.
watching() { # $1 case  $2 settle ticks  $3 burst ticks
  local dir="$WORK/$1"
  mkdir -p "$dir"
  : >"$dir/shell.js"
  : >"$dir/domicile.log"
  echo loaded >"$dir/answer"
  printf '%s\n' "$SOCKET" >"$dir/sock"
  DOMICILE_LOG="$dir/domicile.log" DOMICILE_ANSWER="$dir/answer" \
    "$RELOAD" "$WORK/bin/domicile" "$dir/shell.js" "$dir/sock" "$2" "$3" \
    >"$dir/loop.log" 2>&1 &
  RELOADER=$!
}
built() { touch "$WORK/$1/shell.js"; }
handed_over() { grep -c 'load-shell' "$WORK/$1/domicile.log"; }
stop_watching() { kill "$RELOADER" 2>/dev/null; wait "$RELOADER" 2>/dev/null; }

# NOTHING BELOW SLEEPS A FIXED TIME FOR THE RELOAD LOOP. Each of those sleeps
# was a stopwatch against another process: a tenth-of-a-second tick, a `stat`
# and a subshell per turn, and a budget of a second and a half for all of it.
# Measured, that handover takes a third of a second on an idle runner and one
# and a half on a loaded one — so the budget was spent and the count was read
# early, which is the whole of "wanted: 3 / got: 2". A loop that is slow to
# hand a build over is not a loop that fails to; the stopwatch was the only
# thing failing.
#
# So the waits are for the thing itself, and they are a *bound* rather than a
# verdict: running out says nothing and lets the expectation below report what
# it found, because that message is the one worth reading and two failures for
# one fault are worse than none.
waited() { # $1 a shell test, re-run every tick until it holds
  local ticks=0
  until eval "$1"; do
    ticks=$((ticks + 1))
    [ "$ticks" -ge 200 ] && return 1
    sleep 0.1
  done
}
# And the one thing every case starts by waiting for. `dev-shell-reload.sh`
# takes the stamp it compares against and *then* says this, so a build made
# after this line is one it will see rather than one it has already counted as
# the shell the desktop came up on.
now_watching() { # $1 case
  waited "grep -q 'reloading' \"\$WORK/$1/loop.log\""
}

# THE BUILD THE DESKTOP CAME UP ON IS NOT HANDED BACK TO IT. The launch starts
# the desktop on the module that is already there, and a loop that reloaded
# whatever it found would put the same shell on it a moment after it opened —
# and would do it while the engine was still starting, which is a refusal
# nobody caused.
watching baseline 2 50
now_watching baseline
# ASSERTED RATHER THAN ASSUMED, and this is the one case that has to say so.
# Everywhere else a `waited` that ran out is reported by the expectation after
# it, which finds nothing and says what it wanted. Here the expectation is
# that nothing happened, so a loop that never started would satisfy it — the
# check would pass by having asked the question of nobody, which is worse than
# failing.
expect "the loop is watching before it is asked what it did" "yes" \
  "$(grep -q 'reloading' "$WORK/baseline/loop.log" && echo yes || echo no)"
# And then the only bounded wait left in this file, because what follows it
# cannot be waited for: an absence has no arrival to wait on.
sleep 1
stop_watching
expect "the shell the desktop started on is not handed to it again" "0" \
  "$(handed_over baseline)"

watching rebuilt 2 50
now_watching rebuilt
built rebuilt
waited '[ "$(handed_over rebuilt)" -ge 1 ]'
expect "a rebuilt shell is handed to the desktop at the socket it printed" \
  "load-shell $WORK/rebuilt/shell.js sock=$SOCKET" \
  "$(head -1 "$WORK/rebuilt/domicile.log")"

# A SHELL THE ENGINE WILL NOT TAKE IS THE ORDINARY CASE, not the exceptional
# one: it is what a syntax error saved halfway through an edit looks like. The
# engine's own sentence is what says which, and a dev loop that died on the
# first one would be worse than one that never reloaded.
REFUSAL="Unexpected token '}'"
echo "the shell would not load: $REFUSAL" >"$WORK/rebuilt/answer"
built rebuilt
waited 'grep -qF "$REFUSAL" "$WORK/rebuilt/loop.log"'
expect "a refused reload says why, in the engine's own words" "yes" \
  "$(grep -qF "$REFUSAL" "$WORK/rebuilt/loop.log" && echo yes || echo no)"

echo loaded >"$WORK/rebuilt/answer"
built rebuilt
waited '[ "$(handed_over rebuilt)" -ge 3 ]'
stop_watching
expect "and the next build is still handed over" "3" "$(handed_over rebuilt)"

# ONE BUILD IS MANY WRITES. `vite build --watch` rewrites the bundle as it
# emits, and a reload fired at a file that is halfway written is a desktop
# showing a shell nobody wrote. The config watcher's answer to the same problem
# is `packages/domicile-compositor/src/coalesce.rs`; this is that answer in
# bash, and the quiet window here is long enough that the burst below cannot
# settle inside it.
watching burst 15 300
now_watching burst
for _ in 1 2 3 4 5 6 7 8 9 10; do
  built burst
  sleep 0.1
done
# The reload is waited for; the *second* one is what this is asserting does
# not come, so that half is a settle window and a margin rather than a wait.
# The old `sleep 3` was both at once, and the arrival is the half that broke —
# on a loaded runner it read naught reloads and reported the coalescing as
# having eaten the build.
waited '[ "$(handed_over burst)" -ge 1 ]'
sleep 2
stop_watching
expect "a burst of writes is one reload rather than ten" "1" "$(handed_over burst)"

# AND THE OTHER BOUND, for the same reason `last_of_burst` takes two: a
# bundle whose writes never leave a gap would otherwise never be handed over at
# all — not handed over late, not handed over.
watching relentless 50 6
now_watching relentless
for _ in $(seq 1 30); do
  built relentless
  sleep 0.05
done
waited '[ "$(handed_over relentless)" -ge 1 ]'
stop_watching
expect "a bundle that never goes quiet is handed over anyway" "yes" \
  "$([ "$(handed_over relentless)" -gt 0 ] && echo yes || echo no)"

# THE TWO HALVES, JOINED, which is the one thing neither set of assertions
# above can reach: the loop is started with paths the launch writes to twenty
# lines later, and a disagreement between those two spellings is a dev loop
# that builds, says nothing, and reloads nothing. So this runs the real script
# from the working directory down — the watcher, the loop and the desktop —
# with a `bunx`, a `cargo` and a `domicile` that do the parts this container
# cannot.
#
# NOTHING HERE WAITS A FIXED TIME FOR ANOTHER PROCESS. The watcher builds only
# once the desktop has said it is up, and builds again until one reaches it;
# the desktop stays up until one has. A run on a loaded machine is slower and
# not flakier.
RUN="$(awk '/^WORK="\$\(mktemp -d\)"$/,0' "$SCRIPT_UNDER_TEST")"
[ -n "$RUN" ] || {
  echo "no run in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}

FIXTURE="$WORK/join"
mkdir -p "$FIXTURE/bin" "$FIXTURE/checkout/scripts" "$FIXTURE/checkout/target/debug" \
         "$FIXTURE/page" "$FIXTURE/shell"
ln -s "$RELOAD" "$FIXTURE/checkout/scripts/dev-shell-reload.sh"
: >"$FIXTURE/page/shell.js"

# The watcher: a build whenever there is a desktop to hand one to, and again
# until one lands. The first of them can be swallowed by the loop's own
# starting stamp, which is not a failure — it is the desktop's own build.
cat >"$FIXTURE/bin/bunx" <<'STUB'
#!/usr/bin/env bash
while [ ! -e "$FIXTURE/up" ]; do sleep 0.1; done
while true; do
  touch "$FIXTURE/page/shell.js"
  sleep 0.5
done
STUB
cat >"$FIXTURE/bin/cargo" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
# Both ends of the binary in one file, which is what it is: the desktop this
# run starts, and the client a reload is typed into.
cat >"$FIXTURE/checkout/target/debug/domicile" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = load-shell ]; then
  echo "load-shell $2 sock=${DOMICILE_SOCK:-unset}" >>"$FIXTURE/handed"
  exit 0
fi
echo "DOMICILE_SOCK=/run/user/1000/domicile-ipc.4242.sock"
echo "domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above."
: >"$FIXTURE/up"
waited=0
while [ ! -s "$FIXTURE/handed" ] && [ "$waited" -lt 150 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
STUB
chmod +x "$FIXTURE/bin/bunx" "$FIXTURE/bin/cargo" \
         "$FIXTURE/checkout/target/debug/domicile"

(
  export FIXTURE PATH="$FIXTURE/bin:$PATH"
  ROOT="$FIXTURE/checkout"
  SHELL_NAME=simple
  SHELL_DIR="$FIXTURE/shell"
  PAGE_DIR="$FIXTURE/page"
  # Handed in, so the engine resolution above it is not reached for and no
  # `nix` is shadowed to say so.
  DOMICILE_ENGINE="$FIXTURE/engine"
  eval "$RUN"
) >"$FIXTURE/run.log" 2>&1

expect "a shell rebuilt while the desktop runs is handed to that desktop" \
  "load-shell $FIXTURE/page/shell.js sock=/run/user/1000/domicile-ipc.4242.sock" \
  "$(head -1 "$FIXTURE/handed" 2>/dev/null)"

# The refusals, again out of the real script: a loop pointed at a module that
# is not there would poll a name nobody typed, forever, saying nothing.
refuse_reload() { "$RELOAD" "$@" 2>&1 | head -1; }
expect "a reload loop with nothing to watch is refused with the usage" \
  "usage: dev-shell-reload.sh <domicile> <module> <socket-file> [settle] [burst]" \
  "$(refuse_reload)"
expect "a module that is not there is named in the refusal" \
  "no shell module at $WORK/nonesuch.js — nothing would ever be reloaded." \
  "$(refuse_reload "$WORK/bin/domicile" "$WORK/nonesuch.js" "$WORK/sock")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
