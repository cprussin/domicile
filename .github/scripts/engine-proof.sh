#!/usr/bin/env bash
# Whether this exact tree has already passed engine.yml.
#
#   engine-proof.sh key            the tree's key
#   engine-proof.sh has <key>      0 proved, 1 not, anything else an error
#   engine-proof.sh record <key>   tag HEAD as proved
#   engine-proof.sh gate           key= and proved= to $GITHUB_OUTPUT
#
# The key is the whole tree, not just the engine: the checks also build the
# compositor and the shells. `engine-release.nix` is left out because the run
# itself writes it back, and markdown because nothing reads it.
set -u

usage() { echo "usage: $(basename "$0") <key|has|record|gate> [key]" >&2; exit 2; }
tag() { printf 'engine-proof-%s\n' "$1"; }

case "${1:-}" in
  key)
    git ls-tree -r --full-tree HEAD |
      awk -F'\t' '$2 != "packages/domicile-engine/engine-release.nix" && $2 !~ /\.md$/' |
      sha256sum | cut -c1-16
    ;;
  has)
    [ -n "${2:-}" ] || usage
    git ls-remote --exit-code --tags origin "refs/tags/$(tag "$2")" >/dev/null
    case $? in
      0) exit 0 ;;
      2) exit 1 ;;
      *) echo "could not ask origin whether $(tag "$2") exists" >&2; exit 3 ;;
    esac
    ;;
  record)
    [ -n "${2:-}" ] || usage
    # Already proved (a dispatch, or the same tree from another commit) is done.
    if out="$(git push -q origin "HEAD:refs/tags/$(tag "$2")" 2>&1)"; then
      exit 0
    fi
    printf '%s\n' "$out" >&2
    # GitHub refuses the job's token any ref whose commit edits a workflow, so
    # a pull request that changes one cannot tag its proof. The engine passed
    # all the same; the tree is proved again once it is on main.
    case "$out" in
      *'without `workflows` permission'*)
        echo "::warning::$(tag "$2") not recorded: this commit edits a workflow, which GitHub will not let the job's token tag"
        exit 0
        ;;
    esac
    "$0" has "$2"
    ;;
  gate)
    : "${GITHUB_OUTPUT:?}"
    key="$("$0" key)"
    echo "key=$key" >>"$GITHUB_OUTPUT"
    # Proved AND engine-release.nix names the series: the key leaves that file
    # out, so a proof alone would skip a branch whose write-back never landed.
    proved=false
    if [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]; then
      "$0" has "$key"
      case $? in
        0) "${DOMICILE_PINNED_ENGINE_CHECK:-scripts/test-the-pinned-engine-is-this-series.sh}" \
             >/dev/null 2>&1 && proved=true ;;
        1) ;;
        *) exit 3 ;;
      esac
    fi
    echo "proved=$proved" >>"$GITHUB_OUTPUT"
    echo "tree $key proved: $proved"
    ;;
  *) usage ;;
esac
