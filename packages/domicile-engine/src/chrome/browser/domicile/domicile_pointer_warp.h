// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_POINTER_WARP_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_POINTER_WARP_H_

#include "content/public/browser/global_routing_id.h"

namespace domicile {

// Put the cursor at `x`,`y` of the page in `frame`, in the page's own
// coordinates.
//
// WHY A PAGE ASKS AND WHAT IT MAY ASK FOR are in
// components/domicile/browser/pointer_warp.h, which is the half with the
// tests. This is the half that needs a window: which root the page is in, and
// where in that root the page begins, neither of which is anything
// //components can be asked.
//
// WHY THIS LIVES IN //chrome, like the shell's windows next door: a cursor is
// moved through the aura WindowTreeHost the page's view belongs to, and
// nothing below //chrome/browser has one. The platform under it is what
// actually moves the pointer -- on the console that is the DRM cursor plane,
// and in a nested run it is somebody else's compositor, which cannot be asked
// to move a pointer at all. A shell is written the same way either way.
//
// By id rather than by pointer, because the call arrives from the IO thread:
// a RenderFrameHost may not be carried across threads, and a page that closed
// in the meantime is a lookup that answers nothing rather than a pointer to a
// frame that is gone.
//
// Must be called on the UI thread.
void WarpPointerIn(content::GlobalRenderFrameHostId frame, double x, double y);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_POINTER_WARP_H_
