// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_BROWSER_DOMICILE_DOMICILE_CLIPBOARD_H_
#define CONTENT_BROWSER_DOMICILE_DOMICILE_CLIPBOARD_H_

namespace ui {
class Clipboard;
}

namespace content {

class RenderFrameHost;

// The agent's clipboard `frame` copies to and pastes from, or null for the
// desktop's. ClipboardHostImpl asks. See
// content/public/browser/domicile_clipboard.h.
ui::Clipboard* DomicileClipboardFor(RenderFrameHost& frame);

}  // namespace content

#endif  // CONTENT_BROWSER_DOMICILE_DOMICILE_CLIPBOARD_H_
