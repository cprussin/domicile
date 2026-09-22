#!/usr/bin/env bash
# The config schema, written down twice, compared.
#
# `nix/home-manager.nix` declares an option for every field of the config file
# so that a desk can be described in Nix with documentation and type checking.
# `packages/domicile-config/src/` is what actually parses that file. They are
# two spellings of one schema and nothing but this compares them.
#
# WHAT DRIFT COSTS, and it is not symmetrical.
#
#   A FIELD THE RUST HAS AND THE MODULE DOES NOT is the mild direction:
#   `settings` is freeform, so it still passes through -- undocumented,
#   untyped, and with the module's own default silently absent. Worth
#   catching, not worth panicking about.
#
#   A FIELD THE MODULE HAS AND THE RUST DOES NOT is the bad one. Every struct
#   in that crate is `deny_unknown_fields`, so a key this module writes and
#   domicile does not know REFUSES THE WHOLE FILE -- every profile, the
#   keyboard, all of it -- and the desk comes up on the defaults. One renamed
#   field on either side does that, and the person who renamed it is not the
#   person whose desk stops working.
#
# So this compares the sets both ways and says which direction it found.
#
# BUILDLESS ON PURPOSE, like its two siblings over the cursor shapes and the
# display transforms. There is no nix in a Claude web session and the module
# is not built by `cargo test` or `turbo test`; without this the first thing
# to notice a rename is somebody's `home-manager switch`.
#
# It compares NAMES AND NOT TYPES. A field that stayed and changed shape --
# `scale` going from an integer to a float, a pair becoming a struct -- passes
# here and is caught by `nix flake check`, which evaluates the module against
# a real configuration. This is the half that needs no nix, not the whole job.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE="$ROOT/nix/home-manager.nix"
LIB="$ROOT/packages/domicile-config/src/lib.rs"
PROFILE="$ROOT/packages/domicile-config/src/profile.rs"

for f in "$MODULE" "$LIB" "$PROFILE"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The `pub` fields of one `#[serde]` struct, which are the keys it accepts.
# Sorted, because neither side's order is meaningful here -- unlike the
# transform lists next door, where the mojom numbers by position.
rust_fields() { # file, struct name
  awk -v want="pub struct $2 {" '
    index($0, want) { inside = 1; next }
    inside && /^\}/ { exit }
    inside && match($0, /^    pub [a-z_]+:/) {
      field = substr($0, RSTART + 8, RLENGTH - 9)
      print field
    }' "$1" | sort
}

# The options declared directly inside one block of the module.
#
# The block opens at a line the caller names and ends at the first line that
# closes back to that line's own indent, which is what keeps `input.keyboard`
# from running on into `output` beside it. `indent` says how deep this block's
# own options sit -- one level in for a plain attrset, two for a submodule,
# whose options are inside an `options = {` of their own. Anything deeper
# belongs to a nested submodule and is that block's business.
nix_options() { # opening line pattern, indent of the options
  awk -v open="$1" -v ind="$2" '
    !inside && $0 ~ open {
      inside = 1
      match($0, /^ */)
      close_at = "^" substr($0, 1, RLENGTH) "\\};?$"
      next
    }
    inside && $0 ~ close_at { exit }
    inside && match($0, "^" ind "[a-z_]+ =") {
      print substr($0, RSTART + length(ind), RLENGTH - length(ind) - 2)
    }' "$MODULE" | sort -u
}

FAILED=0

compare() { # what, rust file, rust struct, nix open pattern, nix indent
  rust_fields "$2" "$3" >"$WORK/rust"
  nix_options "$4" "$5" >"$WORK/nix"

  # A pattern that stopped matching reads as an empty set, and two empty sets
  # compare equal -- this script failing open, which is the shape of bug it
  # exists to catch one level up. So both sides are counted first.
  for side in rust nix; do
    n="$(wc -l <"$WORK/$side" | tr -d ' ')"
    if [ "$n" -lt 1 ]; then
      printf '  FAIL  %s: read no fields from the %s side, so its pattern no longer matches\n' \
        "$1" "$side"
      FAILED=$((FAILED + 1))
      return
    fi
  done

  missing="$(comm -23 "$WORK/rust" "$WORK/nix" | tr '\n' ' ')"
  extra="$(comm -13 "$WORK/rust" "$WORK/nix" | tr '\n' ' ')"

  if [ -z "$missing" ] && [ -z "$extra" ]; then
    printf '  ok    %s (%s fields)\n' "$1" "$(wc -l <"$WORK/rust" | tr -d ' ')"
    return
  fi

  printf '  FAIL  %s\n' "$1"
  [ -z "$missing" ] || printf '    domicile parses these and the module does not declare them: %s\n' "$missing"
  [ -z "$extra" ] || {
    printf '    THE MODULE WOULD WRITE THESE AND DOMICILE REFUSES THE FILE OVER ANY OF THEM: %s\n' "$extra"
    printf '      (every config struct is `deny_unknown_fields`, so this is the whole desk,\n'
    printf '       not one setting -- see this file`s header)\n'
  }
  FAILED=$((FAILED + 1))
}

# `input.keyboard` and `output` are plain attrsets in the settings tree, so
# their options are one level in. The three submodules bound in the `let` hold
# theirs inside an `options = {`, which is one level deeper again.
compare "idle" "$LIB" IdleConfig '^          idle = \{$' '            '
compare "input.keyboard" "$LIB" KeyboardConfig '^          input\.keyboard = \{$' '            '
compare "output" "$LIB" OutputConfig '^          output = \{$' '            '
compare "output.displays[]" "$LIB" DisplayConfig '^  display = lib\.types\.submodule \{$' '      '
compare "output.profiles[]" "$PROFILE" Profile '^  profile = lib\.types\.submodule \{$' '      '
compare "output.profiles[].displays[]" "$PROFILE" DisplayPlacement '^  placement = lib\.types\.submodule \{$' '      '

# `compositor` is gone from the schema -- its one field was a startup
# placeholder rather than a setting -- so the agreement to check is the
# absence. A module that declares one again writes a section `Config` denies,
# and every desk built from it would fail to parse at startup rather than here.
if grep -q '^          compositor\.' "$MODULE"; then
  printf '  FAIL  compositor: the module declares a section the schema dropped\n'
  FAILED=$((FAILED + 1))
else
  printf '  ok    compositor (dropped from both)\n'
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
