#!/usr/bin/env bash
# What series the shared Chromium checkout is already carrying, written down
# beside it so the next run can skip putting it there again.
#
#   .github/scripts/engine-series-stamp.sh carries <chromium/src>
#   .github/scripts/engine-series-stamp.sh record  <chromium/src>
#
# `carries` writes `carries=true` or `carries=false` to $GITHUB_OUTPUT and
# exits 0 — it is a question, and a question that cannot be answered answers
# `false`, because every `false` costs exactly what every run costs today.
# That includes a checkout too broken to read: the steps it gates are the ones
# that own those diagnostics, and they are better than anything this could say.
# `record` is the other way round — it exits non-zero rather than write a stamp
# it cannot vouch for, because what that would break is the NEXT run.
#
# WHAT THIS SAVES. `engine.yml` resets the checkout to `CHROMIUM_PIN` and
# applies `patches/` over it before every build. `git reset --hard` puts every
# patched file back to upstream and `git am` then patches it again, so every
# file the series touches comes out with a new mtime whether or not a byte of
# it changed — and the build behind that is the most expensive thing in this
# repository. When the series has not moved, none of that had to happen.
#
# `engine-sync.sh` already works exactly this way for the DEPS, down to the
# file living beside the checkout rather than in it, and its header has the
# reason: a file inside `src/` is untracked in Chromium's repository, which is
# what makes `git status --porcelain` non-empty, which is what `apply.sh`
# refuses.
#
# WHAT IT MUST NEVER DO IS SAY `true` ABOUT A TREE THAT IS NOT THAT TREE. The
# cost of a false negative is one run paying what every run pays today. The
# cost of a false positive is a build of something other than the pull request,
# reported as the pull request — a green check on code nothing compiled, which
# `scripts/test-engine-series-stamp.sh` spends eleven of its thirteen cases on.
#
# So the stamp is not trusted on its own. It names a series and a commit, and
# this script checks the checkout against BOTH plus the files themselves:
#
#   - the series identity matches (the pin, every patch, every laid-down file,
#     by content rather than by name or timestamp);
#   - HEAD is the commit the stamp was written against — `engine-release.yml`
#     and `engine-drm-probe.yml` reset this same tree, and a person builds in
#     it by hand;
#   - the checkout is dirty in exactly the way a finished `apply.sh` leaves it:
#     the series' own files untracked, and nothing else of any kind;
#   - and every one of those files is byte-for-byte the repository's. They are
#     untracked, so `git status` cannot see one of them go missing or change —
#     only a comparison can.
#
# Any of those failing is `false`, which costs a reset and an apply: the
# ordinary price, not a failure.
set -euo pipefail

action="${1:-}"
CHROMIUM="${2:-}"
[ -n "$action" ] && [ -n "$CHROMIUM" ] || {
  echo "usage: $(basename "$0") <carries|record> <chromium/src>" >&2
  exit 2
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACKAGE="$ROOT/packages/domicile-engine"
SERIES="$PACKAGE/src"
PATCHES="$PACKAGE/patches"

# Beside the checkout, for engine-sync.sh's reason. Override for tests, which
# have no /build.
STAMP="${DOMICILE_SERIES_STAMP:-$(dirname "$CHROMIUM")/.domicile-series-stamp}"

# Every input that decides what the tree comes out as, hashed by CONTENT.
#
# Not mtimes and not a list of names: the whole point is to be right about a
# tree whose files were rewritten with identical content, which is what the
# reset-then-apply does to the ones it did not change. `sort` because `find`
# does not promise an order and a hash over a different order is a different
# hash for the same series.
#
# The pin goes in labeled. Without it, moving `CHROMIUM_PIN` and changing
# nothing else would leave the identity untouched, and a repin is the one
# change that rebuilds the most.
series_identity() {
  {
    printf 'pin %s\n' "$(pin)"
    # `find | sort | while read` rather than `-print0 | sort -z | xargs -0`.
    # The NUL form is the careful one and it spends `xargs`, which nothing
    # else that runs on this machine uses — and an assumption about what is
    # on that PATH is what `cmp` cost above. `find`, `sort` and `sha256sum`
    # are all already proven there: engine-reset.sh's own `series_files` is
    # this same expression, and what it enumerates is this same tree.
    for dir in "$PATCHES" "$SERIES"; do
      [ -d "$dir" ] || continue
      (cd "$dir" && find . -type f | LC_ALL=C sort |
        while IFS= read -r entry; do
          [ -n "$entry" ] || continue
          sha256sum "$entry"
        done)
    done
  } | sha256sum | cut -d' ' -f1
}

pin() { grep -v '^#' "$PACKAGE/CHROMIUM_PIN" | tr -d '[:space:]'; }

# The files `apply.sh` copies into the checkout, as paths relative to it. Same
# expression engine-reset.sh uses to decide what to remove, and they have to
# agree: this asks whether they are all there, that one puts them there.
series_files() { (cd "$SERIES" && find . -type f | sed 's|^\./||'); }

# Whether the checkout is dirty in exactly the way a finished `apply.sh` leaves
# it, and in no other way.
#
# `--untracked-files=all` rather than the default, which collapses an untracked
# directory to a single line ending in `/` — engine-reset.sh's diagnostic
# learned that the hard way, and a collapsed listing here would compare unequal
# against the file list every time and make this answer `false` forever.
tree_is_as_applied() {
  local want got
  want="$(series_files | LC_ALL=C sort)"
  got="$(git -C "$CHROMIUM" status --porcelain --untracked-files=all |
           sed -n 's/^?? //p' | LC_ALL=C sort)"
  [ "$want" = "$got" ] || {
    reason="the checkout is not dirty the way a finished apply leaves it"
    return 1
  }
  # And nothing tracked has been touched. Separate from the above because the
  # listing there drops every line that is not `??`, so a modified upstream
  # file would otherwise pass unnoticed.
  [ -z "$(git -C "$CHROMIUM" status --porcelain --untracked-files=no)" ] || {
    reason="the checkout has modifications to files the series does not own"
    return 1
  }
  return 0
}

# Whether two files hold the same bytes.
#
# NOT `cmp`, AND THAT IS THE WHOLE COMMENT. `cmp` is diffutils, and diffutils
# is not on the runner's PATH: the nixpkgs module supplies bash, coreutils,
# git, tar, gzip and nix, and cprussin/dotfiles adds curl, gawk, jq,
# lsb-release, python3, which, xz and zstd. Run 35475442242 is what said so,
# by failing with `cmp: command not found` after a 35-patch series had applied
# cleanly.
#
# What made that worth more than a one-word fix is the shape of it. A missing
# command exits 127 and a differing file exits 1, and the `|| return 1` below
# read both as "differs" — so a tool that was never installed was
# indistinguishable from a checkout somebody had written into, and the
# `carries` side of this script would have answered `false` for ever with
# nobody the wiser. `sha256sum` is coreutils, it is already what computes the
# identity above, and a failure of it is caught rather than read as an answer.
#
# Fed on stdin so the digest is of the bytes and not of the filename.
same_bytes() { # $1, $2
  local a b
  [ -f "$1" ] && [ -f "$2" ] || return 1
  a="$(sha256sum <"$1")" || {
    echo "::error::sha256sum failed on $1, so nothing here can be compared" >&2
    exit 1
  }
  b="$(sha256sum <"$2")" || {
    echo "::error::sha256sum failed on $2, so nothing here can be compared" >&2
    exit 1
  }
  [ "$a" = "$b" ]
}

# Every laid-down file present and identical. `git status` cannot answer this:
# these files are untracked, so it sees neither one going missing nor one being
# edited into something else.
series_files_are_laid_down() {
  local file
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    same_bytes "$SERIES/$file" "$CHROMIUM/$file" || {
      reason="$file in the checkout is not the one under packages/domicile-engine/src"
      return 1
    }
  done <<EOF
$(series_files)
EOF
  return 0
}

head_now() { git -C "$CHROMIUM" rev-parse HEAD; }

case "$action" in
  carries)
    reason=""
    verdict=false

    if [ ! -f "$PACKAGE/CHROMIUM_PIN" ]; then
      # WHOSE ERROR THIS IS. A checkout with no pin file is broken, and
      # `engine-reset.sh` is the step that says so properly: it names the
      # file, says where the value should have come from, and tells the
      # reader which of the two possible causes it is. This step runs before
      # that one, and failing here would replace that diagnostic with one
      # from a script whose only job is to answer a question. So it answers
      # `false`, the reset runs, and the reset explains.
      #
      # Said explicitly rather than left to `grep` failing inside the
      # identity below. That path does reach `false`, and it reaches it by
      # leaking grep's own "No such file or directory" onto stderr, which is
      # an accident that reads like a diagnostic.
      reason="this checkout has no packages/domicile-engine/CHROMIUM_PIN to read"
    elif [ ! -f "$STAMP" ]; then
      reason="nothing is written down beside this checkout"
    else
      # Two lines: the identity, then the commit it was written against. Read
      # positionally rather than parsed, because this file is written by the
      # `record` below and by nothing else.
      stamped_identity="$(sed -n '1p' "$STAMP")"
      stamped_head="$(sed -n '2p' "$STAMP")"

      if [ "$stamped_identity" != "$(series_identity)" ]; then
        reason="the series moved since this checkout last took it"
      elif [ "$stamped_head" != "$(head_now)" ]; then
        reason="the checkout is at $(head_now), and the series was applied over $stamped_head"
      elif ! tree_is_as_applied; then
        : # reason set
      elif ! series_files_are_laid_down; then
        : # reason set
      else
        verdict=true
      fi
    fi

    if [ "$verdict" = true ]; then
      echo "the checkout already carries this series over $(pin); the reset, the apply and the compile have nothing to do"
    else
      echo "the checkout does not carry this series: $reason"
      echo "Resetting and applying, which is what every run did before this stamp existed."
    fi

    # The workflow's `if:` reads this and nothing else, so it is written
    # whatever happened above.
    [ -z "${GITHUB_OUTPUT:-}" ] || printf 'carries=%s\n' "$verdict" >>"$GITHUB_OUTPUT"
    ;;

  record)
    # A stamp is worth exactly what the run that wrote it checked. This is
    # called straight after the apply step, so the tree should already be what
    # the apply left — and if it is not, writing the stamp would arm a false
    # positive for the NEXT run rather than failing this one, which is the
    # worse of the two places to find out.
    reason=""
    if ! tree_is_as_applied || ! series_files_are_laid_down; then
      # LOUD, AND NOT FATAL. Not writing the stamp is already the whole of the
      # protection: the next run resets and applies, which is what every run
      # did before this existed. Failing the step on top of that skips the
      # build and all twenty-odd guards behind it, which turns "the saving
      # does not apply this time" into a red pull request over a series that
      # applied perfectly.
      #
      # Run 35475442242 is why this is a warning. `cmp` was missing, this
      # refused — correctly, on the information it had — and a 35-patch series
      # that had just applied cleanly was never compiled.
      {
        echo "::warning::not writing down this series: the checkout is not carrying it the way a finished apply leaves it"
        echo "  $reason"
        echo
        echo "This runs after apply.sh, so the checkout should hold the series and"
        echo "nothing else. It does not, which means something wrote into"
        echo "$CHROMIUM between the apply and here."
        echo
        echo "Nothing is written, so the next run will reset and apply, as every"
        echo "run did before this stamp existed. The build continues."
      } >&2
      exit 0
    fi

    # Written in one go rather than appended to, so a run that dies in the
    # middle of this leaves no half-file for the reader above to take
    # positionally. A stamp is small enough that this is a single write.
    printf '%s\n%s\n' "$(series_identity)" "$(head_now)" >"$STAMP"
    echo "wrote down the series this checkout carries, over $(pin)"
    ;;

  *)
    echo "usage: $(basename "$0") <carries|record> <chromium/src>" >&2
    exit 2
    ;;
esac
