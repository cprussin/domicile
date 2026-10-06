# Reports a guard's failure reason as a GitHub annotation.
#
# Sourced, not run. `. "$(dirname "$0")/lib-annotate.sh"`.
#
# The job log is mostly Chromium startup noise and is truncated, so a reason
# printed there is hard to find. `::error::` becomes an annotation on the
# check, which the check-runs annotations API returns in one call.

# Escapes text for a workflow command. `%` goes first so later escapes are not
# escaped again. Newlines become `%0A`, which GitHub decodes, so an annotation
# can carry log lines. No trailing `%0A`: it would add a blank line.
domicile_escape() {
  printf '%s' "$1" | sed -e 's/%/%25/g' -e "s/$(printf '\r')/%0D/g" |
    awk 'NR > 1 { printf "%%0A" } { printf "%s", $0 }'
}

# An error annotation with no body.
#
# Joins all arguments with spaces, since callers often split long messages
# across several words.
annotate() {
  echo "::error::$(domicile_escape "$*")"
}

# An error annotation with the last 40 lines of a log, newest first.
#
# GitHub truncates long annotations from the end, and the failure is near the
# end of the log. 40 lines reaches past build summaries (turbo, vite) to the
# actual error.
annotate_from() {
  local title="$1" file="$2" body
  # awk, not `tac`: with no final newline, `tac` joins the last two lines.
  body=$(tail -40 "$file" 2>/dev/null |
           awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }')
  # An empty, missing or whitespace-only log gets no body.
  if [ -z "${body//[[:space:]]/}" ]; then
    annotate "$title"
    return
  fi
  echo "::error::$(domicile_escape "$title")%0A%0A$(domicile_escape "$body")"
}

# Reports a guard that could not run. `scripts/check.sh` parses the `SKIP:`
# line for the reason.
#
# A notice, not an error: exit 77 already fails the step where needed, and
# `DOMICILE_CHECK_ALLOW_SKIP` runs expect skips. The notice keeps skips
# visible.
skip() {
  echo "SKIP: $1"
  echo "::notice::$(domicile_escape "$*")"
}
