// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

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
  // A vector rather than a C array, because `-Wunsafe-buffer-usage` rejects
  // indexing an array by a loop variable.
  std::vector<uint8_t> edid = {0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00};
  edid.resize(128, 0);
  return edid;
}

// An 18-byte display descriptor, terminated by a line feed then spaces.
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

// Makers may put the serial in any of the four slots.
TEST(DrmEdidSerialTest, ReadsTheSerialFromTheLastDescriptor) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFourthDescriptor, kSerialTag, "H8KF413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "H8KF413");
}

// Only the 0xFF descriptor is the serial, not the first display descriptor.
TEST(DrmEdidSerialTest, PicksTheSerialOutFromAmongTheOtherDescriptors) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kProductNameTag, "DELL U3219Q");
  PutDescriptor(edid, kSecondDescriptor, kRangeLimitsTag, "");
  PutDescriptor(edid, kFourthDescriptor, kSerialTag, "G3MS413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "G3MS413");
}

// A 13-character serial has no terminator; the read must stop at the block.
TEST(DrmEdidSerialTest, ASerialThatFillsTheBlockHasNoTerminator) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "ABCDEFGHIJKLM");

  EXPECT_EQ(SerialNumberFromEdid(edid), "ABCDEFGHIJKLM");
}

// Space padding without a terminator is trimmed.
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

// In a timing descriptor byte 3 is pixel data, not a tag.
TEST(DrmEdidSerialTest, ADetailedTimingDescriptorIsNotASerial) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "NOTASERIAL");
  edid[kFirstDescriptor + 0] = 0x2C;
  edid[kFirstDescriptor + 1] = 0x23;

  EXPECT_EQ(SerialNumberFromEdid(edid), "");
}

// A non-printable byte rejects the whole serial, not just the rest of it.
TEST(DrmEdidSerialTest, ASerialWithAControlCharacterIsRefused) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");
  edid[kFirstDescriptor + 7] = 0x01;

  EXPECT_EQ(SerialNumberFromEdid(edid), "");
}

// Many monitors carry no serial.
TEST(DrmEdidSerialTest, AMonitorThatStatesNoSerial) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kProductNameTag, "DELL U3219Q");

  EXPECT_EQ(SerialNumberFromEdid(edid), "");
}

// Falls back to the base block's 32-bit serial, formatted as libdisplay-info
// does.
TEST(DrmEdidSerialTest, FallsBackToTheNumericSerialInTheBaseBlock) {
  std::vector<uint8_t> edid = BareEdid();
  edid[0x0C] = 0x68;
  edid[0x0D] = 0xE3;
  edid[0x0E] = 0x01;
  edid[0x0F] = 0x00;

  EXPECT_EQ(SerialNumberFromEdid(edid), "0x0001E368");
}

// The descriptor wins over the numeric serial, since it matches the sticker.
TEST(DrmEdidSerialTest, ADescriptorSerialWinsOverTheNumericOne) {
  std::vector<uint8_t> edid = BareEdid();
  edid[0x0C] = 0x68;
  edid[0x0D] = 0xE3;
  edid[0x0E] = 0x01;
  edid[0x0F] = 0x00;
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");

  EXPECT_EQ(SerialNumberFromEdid(edid), "2ZLS413");
}

// Zero means unset; otherwise many monitors would share `0x00000000`.
TEST(DrmEdidSerialTest, AZeroNumericSerialIsNoSerial) {
  EXPECT_EQ(SerialNumberFromEdid(BareEdid()), "");
}

// An all-padding serial descriptor falls back to the numeric serial.
TEST(DrmEdidSerialTest, AnAllPaddingSerialDescriptorFallsThroughToTheNumber) {
  std::vector<uint8_t> edid = BareEdid();
  edid[0x0C] = 0x01;
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "");
  for (size_t i = 0; i < 13; ++i) {
    edid[kFirstDescriptor + 5 + i] = 0x20;
  }

  EXPECT_EQ(SerialNumberFromEdid(edid), "0x00000001");
}

// An unreadable monitor reports an empty EDID.
TEST(DrmEdidSerialTest, AnEdidTooShortToHoldADescriptor) {
  EXPECT_EQ(SerialNumberFromEdid({}), "");
  EXPECT_EQ(SerialNumberFromEdid(std::vector<uint8_t>(64, 0)), "");
}

// Extension blocks are ignored.
TEST(DrmEdidSerialTest, AnEdidWithAnExtensionBlock) {
  std::vector<uint8_t> edid = BareEdid();
  PutDescriptor(edid, kFirstDescriptor, kSerialTag, "2ZLS413");
  edid.resize(256, 0);

  EXPECT_EQ(SerialNumberFromEdid(edid), "2ZLS413");
}

// `ManufacturerIdToString` does not validate: an unset code decodes to "@@@"
// and kInvalidProductCode to backticks.
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

// Missing parts are skipped, leaving no double spaces.
TEST(DrmEdidSerialTest, AMissingPartIsLeftOutRatherThanLeftEmpty) {
  EXPECT_EQ(DisplayNameFrom("DEL", "DELL U3219Q", ""), "DEL DELL U3219Q");
  EXPECT_EQ(DisplayNameFrom("", "DELL U3219Q", "2ZLS413"),
            "DELL U3219Q 2ZLS413");
  EXPECT_EQ(DisplayNameFrom("", "DELL U3219Q", ""), "DELL U3219Q");
  EXPECT_EQ(DisplayNameFrom("", "", ""), "");
}

// Parts from EDID descriptors are often space-padded.
TEST(DrmEdidSerialTest, PaddedPartsAreTrimmedAndEmptyOnesDropped) {
  EXPECT_EQ(DisplayNameFrom("  DEL ", " DELL U3219Q  ", "  2ZLS413"),
            "DEL DELL U3219Q 2ZLS413");
  EXPECT_EQ(DisplayNameFrom("DEL", "   ", "2ZLS413"), "DEL 2ZLS413");
}

}  // namespace
}  // namespace ui
