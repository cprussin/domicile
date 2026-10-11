// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_clipboard.h"

#include <algorithm>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/memory/ref_counted_memory.h"
#include "base/no_destructor.h"
#include "base/strings/string_util.h"
#include "ui/base/clipboard/clipboard_constants.h"

namespace ui {

namespace {

// Wraps `bytes` as PlatformClipboard data.
PlatformClipboard::Data BytesOf(const std::vector<uint8_t>& bytes) {
  return base::MakeRefCounted<base::RefCountedBytes>(bytes);
}

// Whether `mime_type` names an image, which crosses under its own type.
bool IsImageMimeType(std::string_view mime_type) {
  return base::StartsWith(mime_type, "image/");
}

// What the desktop carries of `offered`, by type and bytes: the text under
// any text type, moved to `kMimeTypeUtf8PlainText`, and every image. Empty
// text is no text.
template <typename Offered, typename BytesFn>
DrmClipboard::Contents Carried(const Offered& offered, BytesFn bytes_of) {
  DrmClipboard::Contents carried;
  for (const std::string& mime_type : DomicileTextMimeTypes()) {
    auto found = offered.find(mime_type);
    if (found != offered.end()) {
      std::vector<uint8_t> text = bytes_of(found->second);
      if (!text.empty()) {
        carried.emplace(kMimeTypeUtf8PlainText, std::move(text));
      }
      break;
    }
  }
  for (const auto& [mime_type, data] : offered) {
    if (IsImageMimeType(mime_type)) {
      carried.emplace(mime_type, bytes_of(data));
    }
  }
  return carried;
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

void DrmClipboard::SetContents(ClipboardBuffer buffer,
                               const Contents& contents) {
  Take(buffer, Carried(contents, [](const std::vector<uint8_t>& bytes) {
         return bytes;
       }));
}

void DrmClipboard::SetCopiedCallback(Copied copied) {
  copied_ = std::move(copied);
}

void DrmClipboard::OfferClipboardData(ClipboardBuffer buffer,
                                      const DataMap& data_map) {
  // A null entry carries no bytes.
  Contents contents = Carried(data_map, [](const Data& data) {
    return data ? data->as_vector() : std::vector<uint8_t>();
  });
  // Tell the compositor first: Wayland clients paste from the seat, which
  // holds the previous copy until the compositor updates it.
  if (copied_) {
    copied_.Run(buffer, contents);
  }
  Take(buffer, std::move(contents));
}

void DrmClipboard::RequestClipboardData(ClipboardBuffer buffer,
                                        const std::string& mime_type,
                                        RequestDataClosure callback) {
  // Answer synchronously: the data is already in memory. The caller supports
  // this, as `StubPlatformClipboard` in ui/base/clipboard/clipboard_ozone.cc
  // does the same.
  //
  // A type not held gets nothing, since a reader asking for `image/png`
  // cannot use a string.
  const Contents& held = Held(buffer);
  auto found = held.find(IsDomicileTextMimeType(mime_type)
                             ? std::string(kMimeTypeUtf8PlainText)
                             : mime_type);
  std::move(callback).Run(found == held.end() ? nullptr
                                              : BytesOf(found->second));
}

void DrmClipboard::GetAvailableMimeTypes(ClipboardBuffer buffer,
                                         GetMimeTypesClosure callback) {
  // Text is offered under every text type, each image under its own. An empty
  // clipboard offers none, so `IsFormatAvailable` grays out the paste menu
  // instead of enabling an empty paste.
  std::vector<std::string> mime_types;
  for (const auto& [mime_type, data] : Held(buffer)) {
    if (mime_type == kMimeTypeUtf8PlainText) {
      std::vector<std::string> text = DomicileTextMimeTypes();
      mime_types.insert(mime_types.begin(), text.begin(), text.end());
    } else {
      mime_types.push_back(mime_type);
    }
  }
  std::move(callback).Run(mime_types);
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

const DrmClipboard::Contents& DrmClipboard::Held(ClipboardBuffer buffer) const {
  static const base::NoDestructor<Contents> nothing;
  auto found = held_.find(buffer);
  return found == held_.end() ? *nothing : found->second;
}

void DrmClipboard::Take(ClipboardBuffer buffer, Contents contents) {
  held_[buffer] = std::move(contents);
  // Bumps the sequence number that clipboard caches key on. For the copy-paste
  // buffer it also tells pages the clipboard changed.
  if (changed_) {
    changed_.Run(buffer);
  }
}

}  // namespace ui
