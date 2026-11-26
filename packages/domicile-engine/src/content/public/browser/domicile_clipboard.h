// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_PUBLIC_BROWSER_DOMICILE_CLIPBOARD_H_
#define CONTENT_PUBLIC_BROWSER_DOMICILE_CLIPBOARD_H_

#include "base/functional/callback.h"
#include "content/common/content_export.h"

namespace ui {
class Clipboard;
}

namespace content {

class RenderFrameHost;

// Chooses the clipboard a frame copies to and pastes from: an agent's own,
// for a page an agent's input last drove, or null for the desktop's. //chrome
// chooses (chrome/browser/domicile/domicile_agent_input.h), so an agent's copy
// never replaces the user's clipboard. See docs/architecture/AGENT-SEATS.md
// in the Domicile repository.
using DomicileClipboardChooser =
    base::RepeatingCallback<ui::Clipboard*(RenderFrameHost&)>;

// Process-wide, set once by //chrome, UI thread.
CONTENT_EXPORT void SetDomicileClipboardChooser(
    DomicileClipboardChooser chooser);

}  // namespace content

#endif  // CONTENT_PUBLIC_BROWSER_DOMICILE_CLIPBOARD_H_
