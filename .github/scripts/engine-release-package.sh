#!/usr/bin/env bash
# Package a runnable engine from a build directory.
#
#   .github/scripts/engine-release-package.sh /build/chromium/src out/Release /build/engine-release
#
# Writes <stage>/<name>.tar.zst and its .sha256, and sets `tarball` on
# $GITHUB_OUTPUT when there is one.
#
# A missing runtime file fails late on the user's machine, not at startup. So
# REQUIRED files stop the release if absent, and OPTIONAL files, which depend
# on build arguments, are copied when present. The workflow then runs the
# pixel guard against the unpacked tarball.
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

# The engine cannot start or draw text without these.
REQUIRED=(
  chrome
  icudtl.dat
  resources.pak
  chrome_100_percent.pak
  libdomicile_engine.so
)

# Depend on build arguments; the browser degrades without them.
#
#   chrome_200_percent.pak    HiDPI art
#   v8_context_snapshot.bin   one of these two, depending on the v8 arguments
#   snapshot_blob.bin
#   chrome_crashpad_handler   crash reports
#   libEGL/libGLESv2          ANGLE
#   libvulkan/libvk_swiftshader/vk_swiftshader_icd.json  software rendering
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

# Named after the series, like the release tag (see engine-release-publish.sh),
# using the same twelve characters. engine-series-stamp.sh computes it so the
# tag, filename and rebuild check always agree.
IDENTITY="$("$(dirname "$0")/engine-series-stamp.sh" identity)"
NAME="domicile-engine-s${IDENTITY:0:12}-linux-x64"

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

# Required: without locales the browser shows no text. A directory, so not in
# REQUIRED.
[ -d "$BUILD/locales" ] || {
  echo "::error::the build produced no locales/; the browser would start with no text" >&2
  exit 1
}
cp -a "$BUILD/locales" "$STAGE/$NAME/"

# Record provenance inside the tarball.
cat > "$STAGE/$NAME/PROVENANCE" <<PROV
domicile engine, built on crux
series identity: $IDENTITY
domicile commit: $(git rev-parse HEAD)
chromium pin:    $PIN
built:           $(date -u +%Y-%m-%dT%H:%M:%SZ)
gn args:         see .github/scripts/engine-release-build.sh at the commit above

libdomicile_engine.so is dlopened by domicile-compositor by name, so this
directory has to be on its LD_LIBRARY_PATH.
PROV

cd "$STAGE"
# zstd compresses this mostly binary payload better than gzip.
tar --zstd -cf "$NAME.tar.zst" "$NAME"
sha256sum "$NAME.tar.zst" > "$NAME.tar.zst.sha256"
rm -rf "$STAGE/$NAME"

echo "packaged $NAME.tar.zst ($(du -h "$NAME.tar.zst" | cut -f1))"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "tarball=$NAME.tar.zst" >> "$GITHUB_OUTPUT"
fi
