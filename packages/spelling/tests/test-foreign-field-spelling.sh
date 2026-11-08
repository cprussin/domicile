#!/usr/bin/env bash
# Foreign field names keep their API spelling, with an American local binding.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/packages/spelling/tests"
cp "$root/packages/spelling/tests/test-american-english.sh" "$work/packages/spelling/tests/"
git -C "$work" init -q
cd "$work"
foreign=can""celled
printf 'GesturePinchEndEvent { %s: canceled }\n' "$foreign" >field.rs
git add field.rs
bash packages/spelling/tests/test-american-english.sh
printf 'struct Owned { %s: bool }\n' "$foreign" >field.rs
if bash packages/spelling/tests/test-american-english.sh >verdict 2>&1; then
  echo 'FAIL: an authored field escaped the spelling check'
  exit 1
fi
grep -q '^field.rs:1:' verdict
echo 'ok: only the foreign field mapped to an American binding is exempt'
