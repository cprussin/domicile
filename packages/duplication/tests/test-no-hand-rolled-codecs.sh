#!/usr/bin/env bash
# Fails on codecs written out by hand in Rust or C++: a base64 alphabet, a
# `%XX` percent escape, or a CRC-32 or Adler-32. Each has a crate (`base64`,
# `percent-encoding`, `png`) and, in the engine, a `base::` function.
#
# Reads tracked files only, so untracked files cannot fail the run.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

PATTERNS=(
  # base64's 62 letters and digits, in its order.
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  # A percent escape written, as Rust's `"%{byte:02X}"` or C's `"%%%02X"`,
  # or read, as a match on Rust's `b'%'`.
  '%\{[a-z_]*:02[Xx]\}|%%%02[Xx]|'"b'%'"
  # CRC-32's reversed polynomial, or a hand-written checksum.
  '0x[Ee][Dd][Bb]88320|fn (crc32|adler32)\b'
)

FILES="$(git ls-files -- '*.rs' '*.cc' '*.h' | grep -v '^packages/domicile-engine/src/third_party/')"
[ -n "$FILES" ] || {
  echo "SKIP: no tracked Rust or C++ files — not a checkout?"
  exit 77
}

HITS="$(for pattern in "${PATTERNS[@]}"; do
  printf '%s\n' "$FILES" | xargs grep -HnE -- "$pattern" || true
done)"

if [ -z "$HITS" ]; then
  echo "PASS: no hand-rolled codecs in $(printf '%s\n' "$FILES" | wc -l) Rust and C++ files"
  exit 0
fi

echo "Hand-rolled codecs found. Use the base64, percent-encoding or png crate"
echo "(base:: in the engine) instead:"
echo
printf '%s\n' "$HITS"
exit 1
