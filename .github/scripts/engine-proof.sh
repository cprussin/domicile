#!/usr/bin/env bash
# Record and check whether this exact tree has passed engine.yml.
#
#   engine-proof.sh key            the tree's key
#   engine-proof.sh has <key>      0 proved, 1 not, anything else an error
#   engine-proof.sh record <key>   tag HEAD as proved
#   engine-proof.sh gate           key= and proved= to $GITHUB_OUTPUT
#
# The key hashes the whole tree, since the checks also build the compositor
# and shells. It skips `engine-release.nix`, which the run writes back, and
# markdown.
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
    # A tag that already exists also counts as success.
    if out="$(git push -q origin "HEAD:refs/tags/$(tag "$2")" 2>&1)"; then
      exit 0
    fi
    printf '%s\n' "$out" >&2
    # The job's token cannot push a ref to a commit that edits a workflow.
    # The tree is proved again on main.
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
    # Also require engine-release.nix to name this series, since the key
    # ignores that file and its write-back may not have landed.
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
