// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_clipboard.h"

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/ref_counted_memory.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/base/clipboard/clipboard_constants.h"

namespace ui {
namespace {

// A copy of `text` as `ClipboardOzone::WriteText` offers it: the same bytes
// under every text type.
PlatformClipboard::DataMap Copy(const std::string& text) {
  PlatformClipboard::DataMap data_map;
  auto bytes = base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>(text.begin(), text.end()));
  for (const std::string& mime_type : DomicileTextMimeTypes()) {
    data_map[mime_type] = bytes;
  }
  return data_map;
}

// Reads `buffer`. Needs no run loop because `RequestClipboardData` answers
// synchronously; this fails if it ever stops doing so.
std::string Read(DrmClipboard& clipboard,
                 ClipboardBuffer buffer,
                 const std::string& mime_type = kMimeTypePlainText) {
  std::string read;
  bool answered = false;
  clipboard.RequestClipboardData(
      buffer, mime_type,
      base::BindOnce(
          [](std::string* read, bool* answered,
             const PlatformClipboard::Data& data) {
            *answered = true;
            if (data) {
              const std::vector<uint8_t>& bytes = data->as_vector();
              *read = std::string(bytes.begin(), bytes.end());
            }
          },
          &read, &answered));
  EXPECT_TRUE(answered) << "a read was not answered before it returned";
  return read;
}

// Returns the types `buffer` offers.
std::vector<std::string> Types(DrmClipboard& clipboard, ClipboardBuffer buffer) {
  std::vector<std::string> types;
  clipboard.GetAvailableMimeTypes(
      buffer, base::BindOnce(
                  [](std::vector<std::string>* types,
                     const std::vector<std::string>& offered) {
                    *types = offered;
                  },
                  &types));
  return types;
}

// A page pastes what the compositor says is on the clipboard.
TEST(DrmClipboardTest, WhatTheCompositorSaysIsWhatAPasteProduces) {
  DrmClipboard clipboard;

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "copied in a terminal");

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste),
            "copied in a terminal");
}

// The clipboard and primary selection stay separate.
TEST(DrmClipboardTest, TheTwoClipboardsHoldDifferentThings) {
  DrmClipboard clipboard;

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "an explicit copy");
  clipboard.SetContents(ClipboardBuffer::kSelection, "brushed past");

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "an explicit copy");
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kSelection), "brushed past");
}

// A page's copy goes to the compositor, which puts it on the seat.
TEST(DrmClipboardTest, ACopyMadeHereReachesTheCompositor) {
  DrmClipboard clipboard;
  std::vector<std::pair<ClipboardBuffer, std::string>> sent;
  clipboard.SetCopiedCallback(base::BindRepeating(
      [](std::vector<std::pair<ClipboardBuffer, std::string>>* sent,
         ClipboardBuffer buffer,
         const std::string& text) { sent->emplace_back(buffer, text); },
      &sent));

  clipboard.OfferClipboardData(ClipboardBuffer::kCopyPaste,
                               Copy("copied in a page"));

  ASSERT_EQ(sent.size(), 1u);
  EXPECT_EQ(sent[0].first, ClipboardBuffer::kCopyPaste);
  EXPECT_EQ(sent[0].second, "copied in a page");
  // It is readable here at once; the compositor does not echo it back.
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "copied in a page");
}

// Copying non-text clears the text for other windows instead of leaving the
// previous copy.
TEST(DrmClipboardTest, ACopyWithNoTextInItEmptiesTheClipboard) {
  DrmClipboard clipboard;
  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "copied earlier");

  PlatformClipboard::DataMap image;
  image["image/png"] = base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>{1, 2, 3});
  clipboard.OfferClipboardData(ClipboardBuffer::kCopyPaste, image);

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "");
  EXPECT_TRUE(Types(clipboard, ClipboardBuffer::kCopyPaste).empty());
}

// Every text type is answered, since readers differ: Blink reads
// `text/plain` and GTK asks for `text/plain;charset=utf-8`.
TEST(DrmClipboardTest, EverySpellingOfTextIsAnswered) {
  DrmClipboard clipboard;
  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "one string");

  for (const std::string& mime_type : DomicileTextMimeTypes()) {
    EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, mime_type),
              "one string")
        << "asked for " << mime_type;
  }
  EXPECT_EQ(Types(clipboard, ClipboardBuffer::kCopyPaste),
            DomicileTextMimeTypes());
}

// Non-text types get nothing rather than a string.
TEST(DrmClipboardTest, AnythingThatIsNotTextIsNotAnswered) {
  DrmClipboard clipboard;
  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "one string");

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, "image/png"), "");
}

// An empty clipboard offers no types, so the paste menu is grayed out.
TEST(DrmClipboardTest, AClipboardWithNothingOnItOffersNothing) {
  DrmClipboard clipboard;

  EXPECT_TRUE(Types(clipboard, ClipboardBuffer::kCopyPaste).empty());
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "");
}

// Every change notifies, from either side. Clipboard caches key on the
// sequence number this bumps, so a silent change would paste stale data.
TEST(DrmClipboardTest, EveryChangeIsAnnounced) {
  DrmClipboard clipboard;
  std::vector<ClipboardBuffer> changed;
  clipboard.SetClipboardDataChangedCallback(base::BindRepeating(
      [](std::vector<ClipboardBuffer>* changed, ClipboardBuffer buffer) {
        changed->push_back(buffer);
      },
      &changed));

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "from elsewhere");
  clipboard.OfferClipboardData(ClipboardBuffer::kSelection, Copy("from here"));

  EXPECT_EQ(changed, (std::vector<ClipboardBuffer>{
                         ClipboardBuffer::kCopyPaste,
                         ClipboardBuffer::kSelection}));
}

// Never the selection owner, even after a local copy, so `ClipboardOzone`
// never serves reads from its own cache.
TEST(DrmClipboardTest, ThisProcessIsNeverTheSelectionOwner) {
  DrmClipboard clipboard;
  clipboard.OfferClipboardData(ClipboardBuffer::kCopyPaste, Copy("just now"));

  bool owner = true;
  clipboard.IsSelectionOwner(
      ClipboardBuffer::kCopyPaste,
      base::BindOnce([](bool* owner, bool is_owner) { *owner = is_owner; },
                     &owner));

  EXPECT_FALSE(owner);
}

// The primary selection is available.
TEST(DrmClipboardTest, TheMiddleClickClipboardIsAvailable) {
  EXPECT_TRUE(DrmClipboard().IsSelectionBufferAvailable());
}

}  // namespace
}  // namespace ui
