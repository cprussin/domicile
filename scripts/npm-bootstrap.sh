#!/usr/bin/env bash
# Puts new `@domicile-desktop/*` packages on npm so publish-packages.yml can
# publish them. Run by hand, logged in to npm as an owner of the scope.
#
#   scripts/npm-bootstrap.sh claim    # create each missing package
#   scripts/npm-bootstrap.sh trust    # give each its trusted publisher
#   scripts/npm-bootstrap.sh retire   # after the workflow has published them
#
# - npm attaches a trusted publisher only to an existing package, so `claim`
#   publishes a placeholder, `0.0.0-0` under the dist-tag `placeholder`, for
#   each package in .github/scripts/published-packages that npm does not
#   have. npm also points `latest` at it until a real version replaces it.
# - `trust` names publish-packages.yml in cprussin/domicile as the trusted
#   publisher of each package that has none. It needs npm 11.10 or later.
# - `retire`, once the workflow has published every package, drops the
#   `placeholder` tag and unpublishes `0.0.0-0`. It deprecates a placeholder
#   npm will not unpublish. It refuses while any placeholder is still `latest`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLACEHOLDER="0.0.0-0"
TAG="placeholder"
REPOSITORY="cprussin/domicile"
WORKFLOW="publish-packages.yml"

[ "$#" -eq 1 ] || {
  echo "usage: npm-bootstrap.sh claim|trust|retire" >&2
  exit 2
}

mapfile -t DIRS < <(grep -v '^\(#\|$\)' "$ROOT/.github/scripts/published-packages")
NAMES=()
for dir in "${DIRS[@]}"; do
  NAMES+=("$(jq -r .name "$ROOT/packages/$dir/package.json")")
done

npm whoami >/dev/null || {
  echo "npm-bootstrap: not logged in to npm; run \`npm login\`" >&2
  exit 1
}

# Whether npm has package $1.
on_npm() { npm view "$1" versions --json >/dev/null 2>&1; }

claim() {
  local name dir
  for name in "${NAMES[@]}"; do
    if on_npm "$name"; then
      echo "$name is on npm"
    else
      dir="$(mktemp -d)"
      jq -n --arg name "$name" --arg version "$PLACEHOLDER" --arg repo "$REPOSITORY" '{
        name: $name,
        version: $version,
        description: "A placeholder. Domicile publishes this package from \($repo).",
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/\($repo).git" }
      }' >"$dir/package.json"
      npm publish "$dir" --tag "$TAG" --access public
      rm -rf "$dir"
      echo "$name: claimed with $PLACEHOLDER"
    fi
  done
}

trust() {
  local name
  for name in "${NAMES[@]}"; do
    if npm trust list "$name" --json | grep -qF "$WORKFLOW"; then
      echo "$name trusts $WORKFLOW already"
    else
      npm trust github "$name" --file "$WORKFLOW" --repo "$REPOSITORY" --allow-publish --yes
      echo "$name: trusts $WORKFLOW"
    fi
  done
}

retire() {
  local name placeholders=() latest
  for name in "${NAMES[@]}"; do
    if npm view "$name" versions --json | jq -e --arg v "$PLACEHOLDER" 'index($v) != null' >/dev/null; then
      placeholders+=("$name")
    fi
  done
  for name in "${placeholders[@]}"; do
    latest="$(npm view "$name" dist-tags.latest)"
    if [ "$latest" = "$PLACEHOLDER" ]; then
      echo "npm-bootstrap: $name's latest is still the placeholder; let publish-packages.yml publish it first" >&2
      exit 1
    fi
  done
  for name in "${placeholders[@]}"; do
    npm dist-tag rm "$name" "$TAG" || echo "$name has no $TAG tag"
    if npm unpublish "$name@$PLACEHOLDER"; then
      echo "$name: unpublished $PLACEHOLDER"
    else
      # npm refuses some unpublishes (after 72 hours, with dependents).
      npm deprecate "$name@$PLACEHOLDER" "A placeholder; use any later version."
      echo "$name: npm would not unpublish $PLACEHOLDER, so it is deprecated"
    fi
  done
}

case "$1" in
  claim) claim ;;
  trust) trust ;;
  retire) retire ;;
  *)
    echo "npm-bootstrap: no step $1" >&2
    exit 2
    ;;
esac
