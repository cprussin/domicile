// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/browser/domicile/domicile_clipboard.h"

#include <utility>

#include "base/check.h"
#include "base/no_destructor.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/domicile_clipboard.h"

namespace content {

namespace {

DomicileClipboardChooser& Chooser() {
  static base::NoDestructor<DomicileClipboardChooser> chooser;
  return *chooser;
}

}  // namespace

void SetDomicileClipboardChooser(DomicileClipboardChooser chooser) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  CHECK(Chooser().is_null() || chooser.is_null());
  Chooser() = std::move(chooser);
}

ui::Clipboard* DomicileClipboardFor(RenderFrameHost& frame) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  return Chooser().is_null() ? nullptr : Chooser().Run(frame);
}

}  // namespace content
