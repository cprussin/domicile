// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/edid_name.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

constexpr size_t kFirstDescriptor = 0x36;
constexpr size_t kSecondDescriptor = 0x48;
constexpr size_t kFourthDescriptor = 0x6C;
constexpr uint8_t kSerialTag = 0xFF;
constexpr uint8_t kProductNameTag = 0xFC;
constexpr uint8_t kRangeLimitsTag = 0xFD;

// A 128-byte base EDID block, header and nothing else.
std::vector<uint8_t> BareEdid() {
  // The eight-byte header, then zeros. Built as a vector and resized rather
  // than copied out of a C array: `-Wunsafe-buffer-usage` is an error in this
  // tree, and subscripting an array by a loop variable is what it is for.
  std::vector<uint8_t> edid = {0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00};
  edid.resize(128, 0);
  return edid;
}

// An 18-byte display descriptor, padded the way a monitor pads one: terminated
// by a line feed where the text is shorter than the block, then spaces.
void PutDescriptor(std::vector<uint8_t>& edid,
                   size_t offset,
                   uint8_t tag,
                   const std::string& text) {
  edid[offset + 0] = 0x00;
  edid[offset + 1] = 0x00;
  edid[offset + 2] = 0x00;
  edid[offset + 3] = tag;
  edid[offset + 4] = 0x00;
  for (size_t i = 0; i < 13; ++i) {
    if (i < text.size()) {
      edid[offset + 5 + i] = static_cast<uint8_t>(text[i]);
    } else if (i == text.size()) {
      edid[offset + 5 + i] = 0x0A;
    } else {
      edid[offset + 5 + i] = 0x20;
    }
  }
}

TEST(DrmEdidSerialTest, ReadsTheSerialFromTheFirstDescriptor) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "2ZLS413");
}

// All four slots are searched, and nothing fixes which one a maker uses.
TEST(DrmEdidSerialTest, ReadsTheSerialFromTheLastDescriptor) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFourthDescriptor, kSerialTag, "H8KF413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "H8KF413");
}

// The ordinary monitor: a product name, a range-limits block, and the serial
// among them. Only 0xFF is the serial, and picking the first display
// descriptor instead would return the model for every panel on the desk --
// which is exactly the collision this exists to break.
TEST(DrmEdidSerialTest, PicksTheSerialOutFromAmongTheOtherDescriptors) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kProductNameTag, "DELL U3219Q");
  PutDescriptor(edid, kSecondDescriptor, kRangeLimitsTag, "");
  PutDescriptor(edid, kFourthDescriptor, kSerialTag, "G3MS413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "G3MS413");
}

// Thirteen characters fill the block, so there is no terminator to find. A
// parser that searched for one rather than bounding the length would run into
// the next descriptor.
TEST(DrmEdidSerialTest, ASerialThatFillsTheBlockHasNoTerminator) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "ABCDEFGHIJKLM");

  EXPECT_EQ(SerialNumberFromEdid(edid), "ABCDEFGHIJKLM");
}

// Padding rather than a terminator, which plenty of monitors do. A name with a
// space on the end is one nobody can type into a config file.
TEST(DrmEdidSerialTest, TrailingPaddingIsNotPartOfTheSerial) {
  std::vector<uint8_t> edid = BareEdid();
  const std::string serial = "2ZLS413";
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "");
  for (size_t i = 0; i < 13; ++i) {
    edid[kFirstDescriptor + 5 + i] =
        i < serial.size() ? static_cast<uint8_t>(serial[i]) : 0x20;
  }

  EXPECT_EQ(SerialNumberFromEdid(edid), "2ZLS413");
}

// A descriptor opening with something other than zeros is a detailed TIMING
// descriptor: those bytes are a pixel clock, and byte 3 is part of the
// horizontal active count. Reading a tag out of one is how a resolution turns
// into a serial number.
TEST(DrmEdidSerialTest, ADetailedTimingDescriptorIsNotASerial) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "NOTASERIAL");
  edid[kFirstDescriptor + 0] = 0x2C;
  edid[kFirstDescriptor + 1] = 0x23;

  EXPECT_EQ(SerialNumberFromEdid(edid), "");
}

// A serial is printable ASCII by the spec, so a control character in one is a
// misread block or a broken EDID. The whole block is refused rather than the
// part before it: half a serial is a name that looks plausible and matches
// nothing.
TEST(DrmEdidSerialTest, ASerialWithAControlCharacterIsRefused) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");
  edid[kFirstDescriptor + 7] = 0x01;

  EXPECT_EQ(SerialNumberFromEdid(edid), "");
}

// Ordinary rather than broken: a projector, a virtual output, or a panel whose
// maker left the block out. The caller names it by make and model alone.
TEST(DrmEdidSerialTest, AMonitorThatStatesNoSerial) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kProductNameTag, "DELL U3219Q");

  EXPECT_EQ(SerialNumberFromEdid(edid), "");
}

// The base block's own 32-bit serial, which plenty of monitors fill in instead
// of the descriptor. Without it those panels are named by make and model
// alone, so two of the same model are one name -- which is the collision this
// file exists to break. Formatted the way libdisplay-info prints one, because
// that is the form already written down in a sway or kanshi config.
TEST(DrmEdidSerialTest, FallsBackToTheNumericSerialInTheBaseBlock) {
  std::vector<uint8_t> edid = BareEdid();
  edid[0x0C] = 0x68;
  edid[0x0D] = 0xE3;
  edid[0x0E] = 0x01;
  edid[0x0F] = 0x00;

  EXPECT_EQ(SerialNumberFromEdid(edid), "0x0001E368");
}

// The printed one wins. A monitor carrying both is carrying the descriptor for
// a reason: it is what is on the sticker.
TEST(DrmEdidSerialTest, ADescriptorSerialWinsOverTheNumericOne) {
  std::vector<uint8_t> edid = BareEdid();
  edid[0x0C] = 0x68;
  edid[0x0D] = 0xE3;
  edid[0x0E] = 0x01;
  edid[0x0F] = 0x00;
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "2ZLS413");
}

// Zero is not a serial: it is the field nobody filled in, which is most
// monitors that carry a descriptor instead. Naming every one of them
// `0x00000000` would make them all the same monitor.
TEST(DrmEdidSerialTest, AZeroNumericSerialIsNoSerial) {
  EXPECT_EQ(SerialNumberFromEdid(BareEdid()), "");
}

// A descriptor tagged as a serial and filled with padding states nothing, so
// the number behind it still gets its turn rather than being shadowed by an
// answer that is not one.
TEST(DrmEdidSerialTest, AnAllPaddingSerialDescriptorFallsThroughToTheNumber) {
  std::vector<uint8_t> edid = BareEdid();
  edid[0x0C] = 0x01;
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "");
  for (size_t i = 0; i < 13; ++i) {
    edid[kFirstDescriptor + 5 + i] = 0x20;
  }

  EXPECT_EQ(SerialNumberFromEdid(edid), "0x00000001");
}

// Every offset this reads is past the end, and a connector with no EDID at all
// is what an unreadable monitor reports.
TEST(DrmEdidSerialTest, AnEdidTooShortToHoldADescriptor) {
  EXPECT_EQ(SerialNumberFromEdid({}), "");
  EXPECT_EQ(SerialNumberFromEdid(std::vector<uint8_t>(64, 0)), "");
}

// The descriptors read are the base block's; an extension block after it is
// somebody else's business and changes nothing.
TEST(DrmEdidSerialTest, AnEdidWithAnExtensionBlock) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");
  edid.resize(256, 0);

  EXPECT_EQ(SerialNumberFromEdid(edid), "2ZLS413");
}

// `ManufacturerIdToString` is five bits per letter with 1 meaning 'A' and no
// validation at all, so the codes nobody set decode to characters: zero to
// "@@@" and kInvalidProductCode to backticks. Both are one character off 'A'
// and both look like a name, which is how every unnamed monitor on a desk ends
// up sharing one.
TEST(DrmEdidSerialTest, IsPnpIdTakesThreeLettersAndNothingElse) {
  EXPECT_TRUE(IsPnpId("DEL"));
  EXPECT_TRUE(IsPnpId("BOE"));

  EXPECT_FALSE(IsPnpId("@@@"));
  EXPECT_FALSE(IsPnpId("```"));
  EXPECT_FALSE(IsPnpId("De1"));
  EXPECT_FALSE(IsPnpId("D L"));
  EXPECT_FALSE(IsPnpId("DE"));
  EXPECT_FALSE(IsPnpId("DELL"));
  EXPECT_FALSE(IsPnpId(""));
}

TEST(DrmEdidSerialTest, ANameIsItsThreeParts) {
  EXPECT_EQ(DisplayNameFrom("DEL", "DELL U3219Q", "2ZLS413"),
            "DEL DELL U3219Q 2ZLS413");
}

// Every part is optional, and a name with a hole where one should be is worse
// than a shorter name: it is a string nobody can match and nobody can read.
TEST(DrmEdidSerialTest, AMissingPartIsLeftOutRatherThanLeftEmpty) {
  EXPECT_EQ(DisplayNameFrom("DEL", "DELL U3219Q", ""), "DEL DELL U3219Q");
  EXPECT_EQ(DisplayNameFrom("", "DELL U3219Q", "2ZLS413"),
            "DELL U3219Q 2ZLS413");
  EXPECT_EQ(DisplayNameFrom("", "DELL U3219Q", ""), "DELL U3219Q");
  EXPECT_EQ(DisplayNameFrom("", "", ""), "");
}

// Two of the three come straight out of an EDID descriptor, which monitors pad
// with spaces.
TEST(DrmEdidSerialTest, PaddedPartsAreTrimmedAndEmptyOnesDropped) {
  EXPECT_EQ(DisplayNameFrom("  DEL ", " DELL U3219Q  ", "  2ZLS413"),
            "DEL DELL U3219Q 2ZLS413");
  EXPECT_EQ(DisplayNameFrom("DEL", "   ", "2ZLS413"), "DEL 2ZLS413");
}

}  // namespace
}  // namespace ui
