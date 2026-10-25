#!/usr/bin/env bash
# Gives each engine a guard starts a broker socket no earlier launch used.
#
#   . "$SCRIPTS/lib-broker.sh"
#   BROKER="${BROKER:-/tmp/domicile-<guard>-broker}"
#   fresh_broker   # before each engine starts
#
# A browser listens again when its producer goes, and binds the socket on a
# worker thread. A guard kills the browser just after its probe exits, so the
# dying browser can recreate a shared path after the next leg removed it. The
# next leg's producer then joins the dying browser and waits forever.
#
# Checked by `packages/domicile-engine/tests/test-each-engine-launch-has-its-own-broker-socket.sh`.

# Points `BROKER` at a new, unused path beside the first one it held, and
# removes the path it held, which no producer will join again.
fresh_broker() {
  DOMICILE_BROKER_BASE="${DOMICILE_BROKER_BASE:-$BROKER}"
  rm -f "$BROKER"
  BROKER="$(mktemp -u "$DOMICILE_BROKER_BASE-XXXXXX")"
}
