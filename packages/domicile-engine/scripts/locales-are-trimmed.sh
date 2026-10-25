#!/usr/bin/env bash
# Checks that the build packed every locale but en-US with only the strings
# foreign_allowlist.py keeps, and en-US with every string.
#
# Patch 0147 does this in GN. Should the wiring stop applying, the build still
# succeeds and only the install grows, so this reads the packed files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
. "$ROOT/packages/domicile-engine/scripts/lib-engine-guard.sh"
require_engine_out

LOCALES="$ENGINE_OUT/locales"
ALLOWLIST="$(mktemp)"
trap 'rm -f "$ALLOWLIST"' EXIT

python3 -I "$ROOT/packages/domicile-engine/src/components/domicile/locales/foreign_allowlist.py" \
  "$ALLOWLIST" "$LOCALES/en-US.pak.info"

python3 -I - "$LOCALES" "$ALLOWLIST" <<'PY' || {
import pathlib
import struct
import sys

locales = pathlib.Path(sys.argv[1])
kept = {int(line) for line in open(sys.argv[2])}


def ids(pak):
  """The resource ids in a version 5 data pack, aliases included."""
  data = pak.read_bytes()
  version, = struct.unpack_from("<I", data, 0)
  if version != 5:
    sys.exit(f"{pak} is pack version {version}, not 5")
  count, aliases = struct.unpack_from("<HH", data, 8)
  entries = {struct.unpack_from("<H", data, 12 + 6 * i)[0] for i in range(count)}
  alias_table = 12 + 6 * (count + 1)
  return entries | {
      struct.unpack_from("<H", data, alias_table + 4 * i)[0]
      for i in range(aliases)
  }


every = {int(line.split(",")[1]) for line in open(locales / "en-US.pak.info")}
dropped = every - kept
missing = every - ids(locales / "en-US.pak")
if missing:
  sys.exit(f"en-US.pak lacks {len(missing)} of its strings, e.g. {min(missing)}")
foreign = 0
for pak in sorted(locales.glob("*.pak")):
  if pak.name.startswith("en-US"):
    continue
  extra = ids(pak) & dropped
  if extra:
    sys.exit(f"{pak.name} still has {len(extra)} dropped strings, e.g. {min(extra)}")
  foreign += 1
if foreign == 0:
  sys.exit(f"no locale but en-US in {locales}")
print(f"{foreign} locales carry none of the {len(dropped)} dropped strings; "
      "en-US has all of them")
PY
  annotate "a locale pak is not trimmed as foreign_allowlist.py says"
  exit 1
}
