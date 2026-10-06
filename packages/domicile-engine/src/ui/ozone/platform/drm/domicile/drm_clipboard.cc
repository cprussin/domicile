// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_clipboard.h"

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

#include "base/memory/ref_counted_memory.h"
#include "base/no_destructor.h"
#include "ui/base/clipboard/clipboard_constants.h"

namespace ui {

namespace {

// Wraps `text` as PlatformClipboard data.
PlatformClipboard::Data BytesOf(const std::string& text) {
  return base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>(text.begin(), text.end()));
}

// Returns the text in `data_map` under any text mime type, or empty if there
// is none (for example, a copied image).
std::string TextIn(const PlatformClipboard::DataMap& data_map) {
  for (const std::string& mime_type : DomicileTextMimeTypes()) {
    auto found = data_map.find(mime_type);
    if (found != data_map.end() && found->second) {
      const std::vector<uint8_t>& bytes = found->second->as_vector();
      return std::string(bytes.begin(), bytes.end());
    }
  }
  return std::string();
}

}  // namespace

std::vector<std::string> DomicileTextMimeTypes() {
  return {kMimeTypePlainText, kMimeTypeUtf8PlainText, kMimeTypeLinuxUtf8String,
          kMimeTypeLinuxString, kMimeTypeLinuxText};
}

bool IsDomicileTextMimeType(const std::string& mime_type) {
  // Not `base::Contains`: `base/containers/contains.h` is gone at our pin.
  const std::vector<std::string> mime_types = DomicileTextMimeTypes();
  return std::ranges::find(mime_types, mime_type) != mime_types.end();
}

DrmClipboard::DrmClipboard() = default;

DrmClipboard::~DrmClipboard() = default;

void DrmClipboard::SetContents(ClipboardBuffer buffer, std::string text) {
  Take(buffer, std::move(text));
}

void DrmClipboard::SetCopiedCallback(Copied copied) {
  copied_ = std::move(copied);
}

void DrmClipboard::OfferClipboardData(ClipboardBuffer buffer,
                                      const DataMap& data_map) {
  std::string text = TextIn(data_map);
  // Tell the compositor first: Wayland clients paste from the seat, which
  // holds the previous copy until the compositor updates it.
  if (copied_) {
    copied_.Run(buffer, text);
  }
  Take(buffer, std::move(text));
}

void DrmClipboard::RequestClipboardData(ClipboardBuffer buffer,
                                        const std::string& mime_type,
                                        RequestDataClosure callback) {
  // Answer synchronously: the data is already in memory. The caller supports
  // this, as `StubPlatformClipboard` in ui/base/clipboard/clipboard_ozone.cc
  // does the same.
  //
  // A non-text type gets nothing, since a reader asking for `image/png` cannot
  // use a string.
  if (!IsDomicileTextMimeType(mime_type)) {
    std::move(callback).Run(nullptr);
    return;
  }
  std::move(callback).Run(BytesOf(Held(buffer)));
}

void DrmClipboard::GetAvailableMimeTypes(ClipboardBuffer buffer,
                                         GetMimeTypesClosure callback) {
  // Offer no types when empty, so `IsFormatAvailable` grays out the paste
  // menu instead of enabling an empty paste.
  if (Held(buffer).empty()) {
    std::move(callback).Run({});
    return;
  }
  std::move(callback).Run(DomicileTextMimeTypes());
}

void DrmClipboard::IsSelectionOwner(ClipboardBuffer buffer,
                                    IsSelectionOwnerClosure callback) {
  // Always false, even right after a local copy. `ClipboardOzone` uses this to
  // decide whether to read from its own cache, which goes stale as soon as
  // another window copies.
  std::move(callback).Run(false);
}

void DrmClipboard::SetClipboardDataChangedCallback(
    ClipboardDataChangedCallback callback) {
  changed_ = std::move(callback);
}

bool DrmClipboard::IsSelectionBufferAvailable() const {
  // The compositor supports the primary selection
  // (`zwp_primary_selection_device_manager_v1`).
  return true;
}

const std::string& DrmClipboard::Held(ClipboardBuffer buffer) const {
  static const base::NoDestructor<std::string> nothing;
  auto found = held_.find(buffer);
  return found == held_.end() ? *nothing : found->second;
}

void DrmClipboard::Take(ClipboardBuffer buffer, std::string text) {
  held_[buffer] = std::move(text);
  // Bumps the sequence number that clipboard caches key on. For the copy-paste
  // buffer it also tells pages the clipboard changed.
  if (changed_) {
    changed_.Run(buffer);
  }
}

}  // namespace ui
