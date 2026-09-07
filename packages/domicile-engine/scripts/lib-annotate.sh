# Saying where a guard stopped, where it can be read.
#
# Sourced, not run. `. "$(dirname "$0")/lib-annotate.sh"`.
#
# WHY THIS EXISTS. A guard that fails in CI writes its reason to the job log,
# and the job log is a thousand lines of Chromium's startup noise with a byte
# budget on top — the reason is in there and unreachable. The shell guard
# failed three times running and the only thing any of those runs could say was
# that it had. GitHub's `::error::` becomes an annotation on the check, and the
# check-runs annotations endpoint returns it in one small call.

# `%` first, so the escapes this introduces are not escaped again. GitHub
# decodes `%0A` inside a workflow command as a newline, which is what lets an
# annotation carry a log rather than point at one.
# Newline-separated lines become `%0A`-separated ones, with no trailing
# separator: the caller joins these, and a stray one is a blank line in every
# annotation that has a body.
domicile_escape() {
  printf '%s' "$1" | sed -e 's/%/%25/g' -e "s/$(printf '\r')/%0D/g" |
    awk 'NR > 1 { printf "%%0A" } { printf "%s", $0 }'
}

# One line, no body.
#
# Every argument, joined with spaces, because a guard's longer messages are
# written as several quoted words across continued lines and the shell would
# have joined them. Reading only `$1` truncated ten of them into half-sentences
# that read as whole ones.
annotate() {
  echo "::error::$(domicile_escape "$*")"
}

# A failure that carries the end of the log it read.
#
# The LAST lines, and reversed so the newest is first: GitHub truncates a long
# annotation from the end, and the end of a build log is where the error is.
annotate_from() {
  local title="$1" file="$2" body
  # Reversed in awk rather than by `tac`, which preserves a missing final
  # newline and so joins the last log line to the one before it.
  body=$(tail -12 "$file" 2>/dev/null |
           awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }')
  # No body, no blank line: a log that is empty or absent is a failure with
  # nothing to show rather than one with something to show and nothing in it.
  if [ -z "$body" ]; then
    annotate "$title"
    return
  fi
  echo "::error::$(domicile_escape "$title")%0A%0A$(domicile_escape "$body")"
}

# A guard that could not run at all. `SKIP:` is the repo's convention and
# `scripts/check.sh` parses it; the annotation is because CI runs these under
# `set -e`, where 77 is a step failure and a silent one.
skip() {
  echo "SKIP: $1"
  annotate "$1"
}
