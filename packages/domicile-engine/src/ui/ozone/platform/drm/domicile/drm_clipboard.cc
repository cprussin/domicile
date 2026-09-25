// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// The bytes of `text`, in the shape a PlatformClipboard answers with.
PlatformClipboard::Data BytesOf(const std::string& text) {
  return base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>(text.begin(), text.end()));
}

// The text in `data_map`, under whichever spelling it was offered.
//
// Empty for a clipboard with no text on it, which is what copying an image or
// a file list makes -- and which is what this desktop's other windows would
// see, because nothing but text crosses to them.
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
  // `base::Contains` is what this would have been; `base/containers/contains.h`
  // is gone from the tree at our pin, and `std::ranges::find` is what the tree
  // reaches for in its place -- the same substitution `shell_windows.cc` and
  // `shortcut_registry.h` record for the same reason.
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
  // The compositor is told before anything in this process is, because it is
  // the one that has to put this on the seat: a Wayland client pasting asks
  // the seat and nothing else, and until the compositor has set it what the
  // seat holds is whatever some other client copied.
  if (copied_) {
    copied_.Run(buffer, text);
  }
  Take(buffer, std::move(text));
}

void DrmClipboard::RequestClipboardData(ClipboardBuffer buffer,
                                        const std::string& mime_type,
                                        RequestDataClosure callback) {
  // Answered here and now, where every other PlatformClipboard answers on a
  // later task: what is being read is already in this process, because the
  // compositor reads every selection as it is made and says so. Running a
  // callback synchronously is what `StubPlatformClipboard` in
  // ui/base/clipboard/clipboard_ozone.cc does, and the caller is written for
  // it.
  //
  // A mime type this holds nothing under gets nothing rather than the text
  // under another: a program that asked for `image/png` is a program that
  // cannot use a string.
  if (!IsDomicileTextMimeType(mime_type)) {
    std::move(callback).Run(nullptr);
    return;
  }
  std::move(callback).Run(BytesOf(Held(buffer)));
}

void DrmClipboard::GetAvailableMimeTypes(ClipboardBuffer buffer,
                                         GetMimeTypesClosure callback) {
  // Nothing on a clipboard is offered under no type at all, rather than under
  // the text types with nothing behind them: `IsFormatAvailable` is what a
  // page's paste menu is grayed out by, and a clipboard that claimed to hold
  // text would enable it over an empty paste.
  if (Held(buffer).empty()) {
    std::move(callback).Run({});
    return;
  }
  std::move(callback).Run(DomicileTextMimeTypes());
}

void DrmClipboard::IsSelectionOwner(ClipboardBuffer buffer,
                                    IsSelectionOwnerClosure callback) {
  // NEVER, INCLUDING RIGHT AFTER THIS PROCESS COPIED. The answer is not about
  // who copied; it is `ClipboardOzone` asking whether it may serve a read out
  // of its own cache of what it last offered. It may not: the next copy on
  // this desktop can be made in any window, and a browser reading its own
  // cache would go on pasting what it copied an hour ago.
  std::move(callback).Run(false);
}

void DrmClipboard::SetClipboardDataChangedCallback(
    ClipboardDataChangedCallback callback) {
  changed_ = std::move(callback);
}

bool DrmClipboard::IsSelectionBufferAvailable() const {
  // This desktop has both clipboards -- see
  // `zwp_primary_selection_device_manager_v1` in the compositor -- so a
  // middle-click paste in a page is asking for something that exists.
  return true;
}

const std::string& DrmClipboard::Held(ClipboardBuffer buffer) const {
  static const base::NoDestructor<std::string> nothing;
  auto found = held_.find(buffer);
  return found == held_.end() ? *nothing : found->second;
}

void DrmClipboard::Take(ClipboardBuffer buffer, std::string text) {
  held_[buffer] = std::move(text);
  // What makes a paste in this process see it. The sequence number this bumps
  // is what every cache above keys on, and for the ordinary clipboard it is
  // also what tells a page that the clipboard changed.
  if (changed_) {
    changed_.Run(buffer);
  }
}

}  // namespace ui
