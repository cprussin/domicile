#!/usr/bin/env bash
# Checks authored patch text while preserving upstream hunk preimages.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/packages/spelling/tests"
cp "$ROOT/packages/spelling/tests/test-american-english.sh" "$WORK/packages/spelling/tests/"
git -C "$WORK" init -q
cd "$WORK"

foreign="col""our"
cat >upstream.patch <<PATCH
diff --git a/upstream.cc b/upstream.cc
--- a/upstream.cc
+++ b/upstream.cc
@@ -1,2 +1,2 @@
 // $foreign is upstream context.
-// An upstream $foreign comment.
+// An American color comment.
PATCH
git add upstream.patch
if bash packages/spelling/tests/test-american-english.sh >verdict 2>&1; then
  echo 'PASS: upstream context and removed text retain their required bytes'
else
  cat verdict
  echo 'FAIL: required upstream patch text was treated as authored text'
  exit 1
fi

sed -i "s/+\/\/ An American color comment./+\/\/ An authored $foreign comment./" upstream.patch
if bash packages/spelling/tests/test-american-english.sh >verdict 2>&1; then
  echo 'FAIL: an added line escaped the spelling check'
  exit 1
else
  grep -q '^upstream.patch:7:+' verdict
  echo 'PASS: added patch text uses American spelling'
fi

sed -i "s/+\/\/ An authored $foreign comment./+\/\/ An American color comment./" upstream.patch
printf '%s\n' "Subject: An authored $foreign description" >subject
cat upstream.patch >>subject
mv subject upstream.patch
if bash packages/spelling/tests/test-american-english.sh >verdict 2>&1; then
  echo 'FAIL: patch metadata escaped the spelling check'
  exit 1
else
  grep -q '^upstream.patch:1:Subject:' verdict
  echo 'PASS: patch metadata uses American spelling'
fi

git rm -q -f upstream.patch
printf '%s\n' "- An authored $foreign line" >notes.md
git add notes.md
if bash packages/spelling/tests/test-american-english.sh >verdict 2>&1; then
  echo 'FAIL: an ordinary file escaped the spelling check'
  exit 1
else
  grep -q '^notes.md:1:-' verdict
  echo 'PASS: ordinary file text uses American spelling'
fi

git rm -q -f notes.md
printf '%s\n' 'An American color comment.' >"$foreign.md"
git add "$foreign.md"
if bash packages/spelling/tests/test-american-english.sh >verdict 2>&1; then
  echo 'FAIL: a filename escaped the spelling check'
  exit 1
else
  grep -q 'in filenames:' verdict
  echo 'PASS: tracked filenames use American spelling'
fi
