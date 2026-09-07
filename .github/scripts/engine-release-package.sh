#!/usr/bin/env bash
# Collect a runnable engine out of a build directory.
#
#   .github/scripts/engine-release-package.sh /build/chromium/src out/Release /build/engine-release
#
# Writes <stage>/<name>.tar.zst and its .sha256, and sets `tarball` on
# $GITHUB_OUTPUT when there is one.
#
# TWO LISTS, AND THE SPLIT IS THE POINT. A missing file in a Chromium runtime
# tree does not fail at startup; it fails later and specifically — no text, no
# GPU, a blank window — and it fails on the user's machine rather than here.
# So everything this cannot run without is REQUIRED and its absence stops the
# release, and everything whose presence depends on the build arguments is
# OPTIONAL and is copied when it is there.
#
# Being wrong about which list something belongs in is caught downstream: the
# workflow unpacks this tarball and runs the pixel guard against it. That is
# the check that a packaged tree actually works, and it is why the lists below
# are allowed to be a judgement rather than a proof.
set -euo pipefail

CHROMIUM="${1:-}"
OUT="${2:-out/Release}"
STAGE="${3:-/build/engine-release}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: engine-release-package.sh <chromium/src> [out dir] [stage dir]" >&2
  exit 1
fi

BUILD="$CHROMIUM/$OUT"
[ -d "$BUILD" ] || { echo "no build directory at $BUILD" >&2; exit 1; }

# Without any one of these the engine does not start, or starts and cannot draw
# a character.
REQUIRED=(
  chrome
  icudtl.dat
  resources.pak
  chrome_100_percent.pak
  libdomicile_engine.so
)

# Present or absent depending on the build arguments and the platform, and
# every one of them is something the browser degrades without rather than dies
# without.
#
#   chrome_200_percent.pak    only built when it is; HiDPI art
#   v8_context_snapshot.bin   whichever of these two the v8 arguments produced
#   snapshot_blob.bin
#   chrome_crashpad_handler   no crash reports without it, which is survivable
#   libEGL/libGLESv2          ANGLE. Absent when the GL implementation is not it
#   libvulkan/libvk_swiftshader/vk_swiftshader_icd.json  the software fallback
OPTIONAL=(
  chrome_200_percent.pak
  v8_context_snapshot.bin
  snapshot_blob.bin
  chrome_crashpad_handler
  libEGL.so
  libGLESv2.so
  libvulkan.so.1
  libvk_swiftshader.so
  vk_swiftshader_icd.json
)

REV="$(git rev-parse --short HEAD)"
PIN="$(grep -v '^#' "$(dirname "$0")/../../packages/domicile-engine/CHROMIUM_PIN" | tr -d '[:space:]')"
NAME="domicile-engine-${REV}-linux-x64"

rm -rf "$STAGE/$NAME"
mkdir -p "$STAGE/$NAME"

missing=()
for file in "${REQUIRED[@]}"; do
  if [ -e "$BUILD/$file" ]; then
    cp -a "$BUILD/$file" "$STAGE/$NAME/"
  else
    missing+=("$file")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::the build produced no ${missing[*]}; this is not a runnable engine" >&2
  exit 1
fi

for file in "${OPTIONAL[@]}"; do
  [ -e "$BUILD/$file" ] && cp -a "$BUILD/$file" "$STAGE/$NAME/"
done

# The translated strings. A tree without them starts and shows no text at all,
# so it is required — as a directory, which the loop above cannot express.
[ -d "$BUILD/locales" ] || {
  echo "::error::the build produced no locales/; the browser would start with no text" >&2
  exit 1
}
cp -a "$BUILD/locales" "$STAGE/$NAME/"

# What this is, next to the thing itself, because a tarball that has been
# downloaded twice is a tarball whose provenance is a guess.
cat > "$STAGE/$NAME/PROVENANCE" <<PROV
domicile engine, built on crux
domicile commit: $(git rev-parse HEAD)
chromium pin:    $PIN
built:           $(date -u +%Y-%m-%dT%H:%M:%SZ)
gn args:         see .github/scripts/engine-release-build.sh at the commit above

libdomicile_engine.so is dlopened by domicile-compositor by name, so this
directory has to be on its LD_LIBRARY_PATH.
PROV

cd "$STAGE"
# zstd over gzip because this is a few hundred megabytes of mostly-binary and
# the runner has zstd in its PATH for exactly this.
tar --zstd -cf "$NAME.tar.zst" "$NAME"
sha256sum "$NAME.tar.zst" > "$NAME.tar.zst.sha256"
rm -rf "$STAGE/$NAME"

echo "packaged $NAME.tar.zst ($(du -h "$NAME.tar.zst" | cut -f1))"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "tarball=$NAME.tar.zst" >> "$GITHUB_OUTPUT"
fi
