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

// Contents holding `text` alone, as the compositor sends text.
DrmClipboard::Contents Text(const std::string& text) {
  return {
      {kMimeTypeUtf8PlainText, std::vector<uint8_t>(text.begin(), text.end())}};
}

// The bytes of a tiny stand-in for a PNG.
std::vector<uint8_t> Png() {
  return {0x89, 'P', 'N', 'G'};
}

// `Png()` as a string, as `Read` returns it.
std::string PngRead() {
  const std::vector<uint8_t> png = Png();
  return std::string(png.begin(), png.end());
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

  clipboard.SetContents(ClipboardBuffer::kCopyPaste,
                        Text("copied in a terminal"));

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste),
            "copied in a terminal");
}

// The clipboard and primary selection stay separate.
TEST(DrmClipboardTest, TheTwoClipboardsHoldDifferentThings) {
  DrmClipboard clipboard;

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, Text("an explicit copy"));
  clipboard.SetContents(ClipboardBuffer::kSelection, Text("brushed past"));

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "an explicit copy");
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kSelection), "brushed past");
}

// A page's copy goes to the compositor, which puts it on the seat.
TEST(DrmClipboardTest, ACopyMadeHereReachesTheCompositor) {
  DrmClipboard clipboard;
  std::vector<std::pair<ClipboardBuffer, DrmClipboard::Contents>> sent;
  clipboard.SetCopiedCallback(base::BindRepeating(
      [](std::vector<std::pair<ClipboardBuffer, DrmClipboard::Contents>>* sent,
         ClipboardBuffer buffer, const DrmClipboard::Contents& contents) {
        sent->emplace_back(buffer, contents);
      },
      &sent));

  clipboard.OfferClipboardData(ClipboardBuffer::kCopyPaste,
                               Copy("copied in a page"));

  ASSERT_EQ(sent.size(), 1u);
  EXPECT_EQ(sent[0].first, ClipboardBuffer::kCopyPaste);
  // The text crosses once; the compositor offers it under every text type.
  EXPECT_EQ(sent[0].second, Text("copied in a page"));
  // It is readable here at once; the compositor does not echo it back.
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "copied in a page");
}

// A page's copied image goes to the compositor under its type. Types the
// desktop does not carry, such as the HTML a copied image comes with, stay
// behind.
TEST(DrmClipboardTest, ACopiedImageReachesTheCompositor) {
  DrmClipboard clipboard;
  std::vector<DrmClipboard::Contents> sent;
  clipboard.SetCopiedCallback(base::BindRepeating(
      [](std::vector<DrmClipboard::Contents>* sent, ClipboardBuffer buffer,
         const DrmClipboard::Contents& contents) { sent->push_back(contents); },
      &sent));

  PlatformClipboard::DataMap image;
  image[kMimeTypePng] = base::MakeRefCounted<base::RefCountedBytes>(Png());
  image[kMimeTypeHtml] = base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>{'<', 'i', 'm', 'g', '>'});
  clipboard.OfferClipboardData(ClipboardBuffer::kCopyPaste, image);

  ASSERT_EQ(sent.size(), 1u);
  EXPECT_EQ(sent[0], (DrmClipboard::Contents{{kMimeTypePng, Png()}}));
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, kMimeTypePng),
            PngRead());
}

// An image the compositor says is on the clipboard pastes, and is offered
// beside the text it came with.
TEST(DrmClipboardTest, AnImageFromTheCompositorPastes) {
  DrmClipboard clipboard;
  DrmClipboard::Contents contents = Text("a caption");
  contents.emplace(kMimeTypePng, Png());

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, contents);

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, kMimeTypePng),
            PngRead());
  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "a caption");
  std::vector<std::string> offered = DomicileTextMimeTypes();
  offered.push_back(kMimeTypePng);
  EXPECT_EQ(Types(clipboard, ClipboardBuffer::kCopyPaste), offered);
}

// Copying neither text nor an image clears the clipboard for other windows
// instead of leaving the previous copy.
TEST(DrmClipboardTest, ACopyWithNothingTheDesktopCarriesEmptiesTheClipboard) {
  DrmClipboard clipboard;
  clipboard.SetContents(ClipboardBuffer::kCopyPaste, Text("copied earlier"));

  PlatformClipboard::DataMap html;
  html[kMimeTypeHtml] = base::MakeRefCounted<base::RefCountedBytes>(
      std::vector<uint8_t>{'<', 'b', '>'});
  clipboard.OfferClipboardData(ClipboardBuffer::kCopyPaste, html);

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste), "");
  EXPECT_TRUE(Types(clipboard, ClipboardBuffer::kCopyPaste).empty());
}

// Every text type is answered, since readers differ: Blink reads
// `text/plain` and GTK asks for `text/plain;charset=utf-8`. The compositor
// may send the text under any of them.
TEST(DrmClipboardTest, EverySpellingOfTextIsAnswered) {
  DrmClipboard clipboard;
  clipboard.SetContents(
      ClipboardBuffer::kCopyPaste,
      {{kMimeTypeLinuxString, std::vector<uint8_t>{'o', 'n', 'e'}}});

  for (const std::string& mime_type : DomicileTextMimeTypes()) {
    EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, mime_type), "one")
        << "asked for " << mime_type;
  }
  EXPECT_EQ(Types(clipboard, ClipboardBuffer::kCopyPaste),
            DomicileTextMimeTypes());
}

// A type the clipboard does not hold gets nothing rather than a string.
TEST(DrmClipboardTest, ATypeNotHeldIsNotAnswered) {
  DrmClipboard clipboard;
  clipboard.SetContents(ClipboardBuffer::kCopyPaste, Text("one string"));

  EXPECT_EQ(Read(clipboard, ClipboardBuffer::kCopyPaste, kMimeTypePng), "");
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

  clipboard.SetContents(ClipboardBuffer::kCopyPaste, Text("from elsewhere"));
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
