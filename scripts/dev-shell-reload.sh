#!/usr/bin/env bash
# The shell you just built, handed to the desktop that is running it.
#
#   ./scripts/dev-shell-reload.sh <domicile> <module> <socket-file> [settle] [burst]
#
# `dev-shell.sh` starts one of these beside the watcher and kills it with the
# rest of the run. It decides nothing about what a shell is: it watches one
# file, waits for it to stop moving, and runs `domicile load-shell` — which is
# where every rule about paths, sockets and what an engine will take already
# lives. See docs/architecture/THE-DOMICILE-BINARY.md.
#
# EVERY PIECE IT NEEDS IS AN ARGUMENT, and that is what makes it testable
# without a desktop: `scripts/test-dev-shell.sh` runs this loop against a
# `domicile` of its own, a bundle it writes and a socket nothing is bound to.
# The alternative — the whole loop inline in `dev-shell.sh`, reachable only by
# extracting the block and eval-ing a copy of it — is the arrangement that doc
# is about not going back to.
#
# THE SOCKET COMES OUT OF A FILE because the desktop is what knows it. The
# supervisor prints `DOMICILE_SOCK=<path>` on its way up and sets it on what it
# spawns, and this script is not one of those — it is started beside the
# desktop rather than inside it. So `dev-shell.sh` reads that line as it goes
# past and writes the path here, once the desktop has also said it is up: until
# then there is an engine still starting and nothing to load a shell onto.
set -u

usage() {
  echo "usage: dev-shell-reload.sh <domicile> <module> <socket-file> [settle] [burst]" >&2
  exit 2
}

DOMICILE="${1:-}"
MODULE="${2:-}"
SOCKET_FILE="${3:-}"
[ -n "$DOMICILE" ] && [ -n "$MODULE" ] && [ -n "$SOCKET_FILE" ] || usage
[ -f "$MODULE" ] || {
  echo "no shell module at $MODULE — nothing would ever be reloaded." >&2
  exit 1
}

# How often the bundle is looked at, and in the same slice everything else in
# this system waits in: `supervise::ASK_EVERY` is a tenth of a second for the
# reason it is one here, which is that nobody reads it as a delay.
TICK=0.1
# ONE BUILD IS MANY WRITES, so a change is not a reason to reload — a change
# that then stopped is. Both windows are counted in ticks, and both bounds are
# `coalesce.rs`'s: the quiet run that says the build finished, and the cap that
# says a bundle which never goes quiet still gets handed over rather than being
# waited on forever.
SETTLE="${4:-3}"
BURST="${5:-20}"

# The file's mtime to the nanosecond and its size. Not its contents: a bundle
# is megabytes and this looks at it ten times a second, and a rebuild that
# emits the same bytes at a new time is still a rebuild.
stamp() {
  stat -c '%.Y %s' -- "$MODULE"
}

# The last of the burst that `first` opened: whatever the file is once it has
# been the same for `SETTLE` ticks, or once `BURST` ticks have passed since it
# started moving, whichever comes first.
settled() { # $1 the stamp that opened the burst
  local latest="$1" quiet=0 waited=0 next
  while [ "$quiet" -lt "$SETTLE" ] && [ "$waited" -lt "$BURST" ]; do
    sleep "$TICK"
    waited=$((waited + 1))
    next="$(stamp)"
    if [ "$next" = "$latest" ]; then
      quiet=$((quiet + 1))
    else
      latest="$next"
      quiet=0
    fi
  done
  printf '%s' "$latest"
}

# A refusal is the ordinary case rather than the exceptional one: it is what a
# shell saved halfway through an edit earns. The engine's own sentence is
# already on the terminal — `domicile` prints what `Response::Refused` carried
# out of it — so what is added here is what happens next, which is nothing
# dramatic: the desktop is still serving the shell it had, and the next build
# gets another go. A dev loop that exited here would be worse than one that
# never reloaded. THIS build is not tried again: the file has not changed, and
# an engine that would not take it once will not take it ten times a second.
#
# `domicile`'s own stdout is the module it loaded, which is the path named on
# the line below either way; its stderr is the part nobody else can say.
hand_over() {
  local socket
  read -r socket <"$SOCKET_FILE"
  if DOMICILE_SOCK="$socket" "$DOMICILE" load-shell "$MODULE" >/dev/null; then
    echo "reloaded $MODULE"
  else
    echo "that shell was not taken; the desktop is still serving the one it had." >&2
  fi
}

# Nothing to hand a shell to until the desktop says where it answers.
while [ ! -s "$SOCKET_FILE" ]; do
  sleep "$TICK"
done

# THE STAMP FIRST AND THE LINE SECOND, so the line means what a reader takes
# it to mean: everything built after it is a build this loop has not already
# counted as the shell the desktop came up on. The other order left a window
# between the two in which a build was swallowed by the baseline, and
# `scripts/test-dev-shell.sh` used to bet `sleep 0.5` that bash got here
# first.
SERVED="$(stamp)"
echo "reloading $MODULE on every build"
while true; do
  sleep "$TICK"
  LATEST="$(stamp)"
  if [ "$LATEST" != "$SERVED" ]; then
    SERVED="$(settled "$LATEST")"
    hand_over
  fi
done
