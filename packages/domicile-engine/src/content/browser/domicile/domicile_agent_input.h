// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_AGENT_INPUT_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_AGENT_INPUT_H_

#include "third_party/blink/public/common/page/drag_operation.h"

namespace content {

class RenderWidgetHostImpl;
struct DropData;

// Whether //chrome's agent seats take the drag `source` starts, instead of
// the platform. RenderWidgetHostImpl::StartDragging asks. See
// content/public/browser/domicile_agent_input.h.
bool DomicileTakesDrag(RenderWidgetHostImpl* source,
                       const DropData& data,
                       blink::DragOperationsMask allowed);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_AGENT_INPUT_H_
