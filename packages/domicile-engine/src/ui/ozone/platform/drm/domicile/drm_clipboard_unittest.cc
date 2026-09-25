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

// What a copy of `text` looks like coming out of `ClipboardOzone::WriteText`,
// which offers one set of bytes under every text spelling there is.
PlatformClipboard::DataMap Copy(const std::string& text) {
  PlatformClipboard::DataMap data_map;
  auto bytes = base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>(text.begin(), text.end()));
  for (const std::string& mime_type : DomicileTextMimeTypes()) {
    data_map[mime_type] = bytes;
  }
  return data_map;
}

// What a read of `buffer` produces. The callback is run before
// `RequestClipboardData` returns -- see the comment there -- so this needs no
// run loop, and a clipboard that started answering later would fail here
// rather than somewhere a nested loop hides it.
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

// The types `buffer` says it can be read as.
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

// What the compositor says is on a clipboard is what a page pastes. This is
// the whole of the direction that was missing: before it, a copy made in a
// terminal reached the browser not at all.
TEST(DrmClipboardTest, WhatTheCompositorSaysIsWhatAPasteProduces) {
  DrmClipboard clipboard;

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "copied in a terminal");

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste),
            "copied in a terminal");
}

// And the two clipboards are two. A desktop that confused them would paste
// what the pointer brushed past wherever a person pressed Ctrl-V.
TEST(DrmClipboardTest, TheTwoClipboardsHoldDifferentThings) {
  DrmClipboard clipboard;

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "an explicit copy");
  clipboard.SetContents(ClipboardBuffer::kSelection, "brushed past");

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "an explicit copy");
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kSelection), "brushed past");
}

// A copy made in a page goes to the compositor, which is the other direction
// and the one that puts it on the seat every other window pastes from.
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
  // And is readable here without waiting for the compositor to say it back,
  // which it does not: a browser that pasted nothing until a round trip
  // completed would be a browser that cannot paste what it just copied.
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "copied in a page");
}

// A copy of something that is not text leaves the other windows on this
// desktop with no text to paste, and says so rather than leaving the last
// copy where it was.
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

// Every spelling of text is answered, because which one is asked for is the
// asking program's to decide -- Blink reads `text/plain` and a GTK program
// asks for `text/plain;charset=utf-8`.
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

// And nothing else is. A program that asked for an image gets nothing rather
// than a string it cannot use.
TEST(DrmClipboardTest, AnythingThatIsNotTextIsNotAnswered) {
  DrmClipboard clipboard;
  clipboard.SetContents(ClipboardBuffer::kCopyPaste, "one string");

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, "image/png"), "");
}

// A clipboard nothing has been put on offers no types at all, which is what a
// grayed-out paste menu is read from.
TEST(DrmClipboardTest, AClipboardWithNothingOnItOffersNothing) {
  DrmClipboard clipboard;

  EXPECT_TRUE(Types(clipboard, ClipboardBuffer::kCopyPaste).empty());
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "");
}

// Every change says so, whichever side made it. The sequence number this
// bumps is what every cache above keys on, so a change that said nothing
// would be a paste that goes on producing the copy before it.
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

// This process never owns a selection, whatever it just copied. The answer is
// `ClipboardOzone` asking whether it may serve a read out of its own cache,
// and it may not: the next copy can be made in any window on the desktop.
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

// The middle-click clipboard exists on this desktop, so a middle-click paste
// in a page is asking for something that is there.
TEST(DrmClipboardTest, TheMiddleClickClipboardIsAvailable) {
  EXPECT_TRUE(DrmClipboard().IsSelectionBufferAvailable());
}

}  // namespace
}  // namespace ui
