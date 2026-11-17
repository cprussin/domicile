#!/usr/bin/env bash
# Whether a resize or move to a closed Widget ends its renderer.
#
# See patch 0234 for why such a page hangs. The series must:
# - record blink_widget_'s close, with its reason, and clear the record on
#   rebind and when the renderer exits;
# - check it in SendScreenRects and SynchronizeVisualProperties before their
#   throttles, so a stuck ack cannot hide the close;
# - skip an inactive RenderViewHost's widget, which keeps a closed Widget on
#   purpose;
# - end the renderer only after the grace period and while it is alive.
#
# Reads the series rather than a build, so it runs on every push.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# The lines the series adds to render_widget_host_impl.cc.
added="$(
  awk '
    FNR == 1 { in_file = 0 }
    /^diff --git a\// { in_file = ($0 ~ /renderer_host\/render_widget_host_impl[.]cc$/); next }
    !in_file { next }
    /^(\+\+\+|---) / { next }
    /^\+/ { print substr($0, 2) }
  ' "$PATCHES"/*.patch
)"

fails=0
want() {
  if grep -qF -- "$1" <<<"$added"; then return; fi
  echo "    missing: $1"
  fails=$((fails + 1))
}

want 'blink_widget_.set_disconnect_with_reason_handler('
want '&RenderWidgetHostImpl::DomicileOnWidgetClosed'
want 'domicile_widget_close_reason_ = reason;'
want 'base::TimeTicks::Now() - domicile_widget_closed_at_ <'
want 'kDomicileDeadWidgetGrace ||'
want '!GetProcess()->IsInitializedAndNotDead()) {'
want 'GetProcess()->Shutdown(RESULT_CODE_HUNG);'
want '(!owner_delegate_ || owner_delegate_->IsMainFrameActive()) &&'

# The record is cleared twice: on rebind and when the renderer exits.
clears="$(grep -cF 'domicile_widget_closed_at_ = base::TimeTicks();' <<<"$added")"
[ "$clears" -eq 2 ] || { echo "    want 2 clears of the close record, found $clears"; fails=$((fails + 1)); }

# Two checks, one per send path.
checks="$(grep -cF 'DomicileEndedDeadWidget()) {' <<<"$added")"
[ "$checks" -eq 2 ] || { echo "    want 2 checks, found $checks"; fails=$((fails + 1)); }

if [ "$fails" -eq 0 ]; then
  echo "  ok    a resize to a closed Widget ends its renderer"
else
  echo "  FAIL  a resize to a closed Widget ends its renderer"
  exit 1
fi
