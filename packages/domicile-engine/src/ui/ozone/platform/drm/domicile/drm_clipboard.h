// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CLIPBOARD_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CLIPBOARD_H_

#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/ozone/public/platform_clipboard.h"

namespace ui {

// The desktop's two clipboards, as this browser reaches them.
//
// WITHOUT THIS THE BROWSER HAS A CLIPBOARD OF ITS OWN AND NOTHING ELSE CAN
// REACH IT. `Clipboard::Create` asks the ozone platform for one of these and
// falls back to `ClipboardNonBacked` -- an in-process store with no connection
// to anything -- when there is none. On a tty there is no display server for
// the browser to share a clipboard through, so a copy made in a terminal and a
// copy made in a page landed in two different places and neither could paste
// the other.
//
// THE COMPOSITOR IS THE CLIPBOARD; this is the browser's end of it. A copy
// made in a page arrives at `OfferClipboardData` and is handed to the
// compositor, which puts it on the Wayland seat every other window pastes
// from. A copy made anywhere else arrives at `SetContents`, because the
// compositor reads every selection as it is made -- see
// `domicile_host::clipboard` in the Domicile repository -- so there is nothing
// left to fetch and a page pasting is answered out of this process's memory.
//
// TEXT AND NOTHING ELSE CROSSES. What a page copies that is not text -- an
// image, a file list -- is a clipboard this cannot describe to the compositor,
// and what is said about it is that the clipboard now holds no text, which is
// true of every window outside the browser.
class DrmClipboard : public PlatformClipboard {
 public:
  // Where a copy made in this process goes, which is the compositor.
  using Copied =
      base::RepeatingCallback<void(ClipboardBuffer, const std::string&)>;

  DrmClipboard();

  DrmClipboard(const DrmClipboard&) = delete;
  DrmClipboard& operator=(const DrmClipboard&) = delete;

  ~DrmClipboard() override;

  // What the compositor says is on `buffer` now. Empty is a clipboard with
  // nothing on it, which is what a desktop that has just started has.
  void SetContents(ClipboardBuffer buffer, std::string text);

  // Where to send a copy made in this process. Set once, by whoever holds the
  // compositor's connection; a clipboard nobody has claimed still works inside
  // this process and reaches nothing outside it.
  void SetCopiedCallback(Copied copied);

  // PlatformClipboard:
  void OfferClipboardData(ClipboardBuffer buffer,
                          const DataMap& data_map) override;
  void RequestClipboardData(ClipboardBuffer buffer,
                            const std::string& mime_type,
                            RequestDataClosure callback) override;
  void GetAvailableMimeTypes(ClipboardBuffer buffer,
                             GetMimeTypesClosure callback) override;
  void IsSelectionOwner(ClipboardBuffer buffer,
                        IsSelectionOwnerClosure callback) override;
  void SetClipboardDataChangedCallback(
      ClipboardDataChangedCallback callback) override;
  bool IsSelectionBufferAvailable() const override;

 private:
  // What `buffer` holds, or empty for a buffer nothing has been put on.
  const std::string& Held(ClipboardBuffer buffer) const;

  // Put `text` on `buffer` and say so, which is what makes a paste elsewhere
  // in this process see it.
  void Take(ClipboardBuffer buffer, std::string text);

  base::flat_map<ClipboardBuffer, std::string> held_;
  Copied copied_;
  ClipboardDataChangedCallback changed_;
};

// The text mime types a clipboard of text is offered under.
//
// All of them rather than one, because which one is asked for is the asking
// program's to decide: Blink reads `text/plain`, a GTK program asks for
// `text/plain;charset=utf-8` and an X11 bridge asks for `STRING`. They are
// Chromium's own spellings from ui/base/clipboard/clipboard_constants.h, and
// the same five `ClipboardOzone::WriteText` offers.
std::vector<std::string> DomicileTextMimeTypes();

// Whether `mime_type` is one of those, which is the whole of what this
// clipboard can answer.
bool IsDomicileTextMimeType(const std::string& mime_type);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CLIPBOARD_H_
