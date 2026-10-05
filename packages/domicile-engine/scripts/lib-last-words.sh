# The end of an engine's log, for a guard that failed.
#
# Sourced, not run. `. "$(dirname "$0")/lib-last-words.sh"`.
#
# A crashed engine prints a `FATAL` line naming the failed check, then a stack
# of forty-odd frames and its registers. A plain `tail -40` keeps the bottom of
# that stack and cuts the line and the frames that say which check it was.

# Where a crash starts: Chromium's fatal log line, or the signal handler's.
DOMICILE_CRASH_START=':FATAL:|Received signal'

# How far back a crash is looked for. A stack is about sixty lines.
DOMICILE_CRASH_REACH=200

# The last forty lines, reaching back to a crash that starts further up.
last_words() {
  tail -"$DOMICILE_CRASH_REACH" "$1" | awk -v start="$DOMICILE_CRASH_START" '
    { line[NR] = $0 }
    from == 0 && $0 ~ start { from = NR }
    END {
      first = NR - 39
      if (from > 0 && from < first) { first = from }
      if (first < 1) { first = 1 }
      for (i = first; i <= NR; i++) { print line[i] }
    }'
}

# The crash alone: its fatal line to the end of its stack.
crash_of() {
  tail -"$DOMICILE_CRASH_REACH" "$1" | awk -v start="$DOMICILE_CRASH_START" '
    !on && $0 ~ start { on = 1 }
    on { print }
    on && /\[end of stack trace\]/ { exit }'
}
