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

// The browser's end of the desktop clipboard and primary selection, which the
// compositor owns.
//
// Without this, `Clipboard::Create` falls back to an in-process store, and the
// browser and other windows on a tty cannot paste each other's copies.
//
// A page's copy goes through `OfferClipboardData` to the compositor, which puts
// it on the Wayland seat. The compositor sends every other copy to
// `SetContents` as it is made (see `domicile_host::clipboard`), so a paste is
// answered from memory. Only text crosses: copying anything else clears the
// text. See docs/architecture/A-DESKTOP-ON-A-TTY.md#the-clipboard.
class DrmClipboard : public PlatformClipboard {
 public:
  // Sends a copy made in this process to the compositor.
  using Copied =
      base::RepeatingCallback<void(ClipboardBuffer, const std::string&)>;

  DrmClipboard();

  DrmClipboard(const DrmClipboard&) = delete;
  DrmClipboard& operator=(const DrmClipboard&) = delete;

  ~DrmClipboard() override;

  // Sets `buffer` to what the compositor says it holds. Empty means nothing.
  void SetContents(ClipboardBuffer buffer, std::string text);

  // Sets where copies made in this process go. Set once by the owner of the
  // compositor connection; until then copies stay inside this process.
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
  // Returns what `buffer` holds, or empty.
  const std::string& Held(ClipboardBuffer buffer) const;

  // Stores `text` on `buffer` and notifies, so pastes in this process see it.
  void Take(ClipboardBuffer buffer, std::string text);

  base::flat_map<ClipboardBuffer, std::string> held_;
  Copied copied_;
  ClipboardDataChangedCallback changed_;
};

// The mime types text is offered under.
//
// Readers differ: Blink reads `text/plain`, GTK asks for
// `text/plain;charset=utf-8` and an X11 bridge asks for `STRING`. These are
// the five types `ClipboardOzone::WriteText` offers.
std::vector<std::string> DomicileTextMimeTypes();

// Whether `mime_type` is a text type this clipboard can answer.
bool IsDomicileTextMimeType(const std::string& mime_type);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CLIPBOARD_H_
