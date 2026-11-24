// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/input_method_lines.h"

#include <optional>
#include <string>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

std::string ImeLineWritten(const base::DictValue& message) {
  std::string line;
  EXPECT_TRUE(base::JSONWriter::Write(message, &line));
  return line;
}

base::DictValue ImeLineRead(const std::string& line) {
  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  EXPECT_TRUE(parsed) << line;
  return parsed ? std::move(*parsed) : base::DictValue();
}

// What the compositor's serde reads: an enabled field with its text, kind and
// caret.
TEST(InputMethodLinesTest, AFieldIsWrittenAsTheCompositorReadsIt) {
  ui::DeskTextField field;
  field.enabled = true;
  field.surrounding = "ni hao";
  field.cursor = 2;
  field.anchor = 0;
  field.hint = 0x40 | 0x80;
  field.purpose = 8;
  field.caret = gfx::Rect(10, 20, 1, 16);

  EXPECT_EQ(ImeLineWritten(TextInputMessage(field)),
            "{\"field\":{\"cursor\":[10,20,1,16],\"enabled\":true,"
            "\"hint\":192,\"purpose\":8,\"surrounding\":{\"anchor\":0,"
            "\"cursor\":2,\"text\":\"ni hao\"}},\"type\":\"text_input\"}");
}

// A field that takes no text says only that.
TEST(InputMethodLinesTest, NoFieldIsWrittenBare) {
  EXPECT_EQ(ImeLineWritten(TextInputMessage(ui::DeskTextField())),
            "{\"field\":{\"enabled\":false,\"hint\":0,\"purpose\":0},"
            "\"type\":\"text_input\"}");
}

TEST(InputMethodLinesTest, AKeyIsWrittenWithItsEvdevCode) {
  EXPECT_EQ(ImeLineWritten(KeyForInputMethodMessage(31, true)),
            "{\"keycode\":31,\"pressed\":true,"
            "\"type\":\"key_for_input_method\"}");
}

// A serial past int32, as the compositor's are: microseconds since the epoch.
TEST(InputMethodLinesTest, ACompositionIsReadWithEveryPart) {
  const std::optional<HeardComposition> heard = ReadComposition(
      ImeLineRead("{\"type\":\"composition\",\"serial\":1794500000000001,"
                  "\"preedit\":{\"text\":\"ni\",\"cursor_begin\":2,"
                  "\"cursor_end\":2},\"commit\":\"x\",\"delete\":[1,0]}"));
  ASSERT_TRUE(heard);
  EXPECT_EQ(heard->serial, 1794500000000001u);
  ASSERT_TRUE(heard->composition.preedit);
  EXPECT_EQ(heard->composition.preedit->text, "ni");
  EXPECT_EQ(heard->composition.preedit->cursor_begin, 2);
  EXPECT_EQ(heard->composition.preedit->cursor_end, 2);
  EXPECT_EQ(heard->composition.commit, "x");
  ASSERT_TRUE(heard->composition.deleted);
  EXPECT_EQ(heard->composition.deleted->first, 1u);
  EXPECT_EQ(heard->composition.deleted->second, 0u);
}

// No preedit is the one that ends what is shown, so it reads as none.
TEST(InputMethodLinesTest, ACompositionWithOnlyACommitHasNoPreedit) {
  const std::optional<HeardComposition> heard = ReadComposition(
      ImeLineRead("{\"type\":\"composition\",\"serial\":7,\"commit\":\"ok\"}"));
  ASSERT_TRUE(heard);
  EXPECT_FALSE(heard->composition.preedit);
  EXPECT_FALSE(heard->composition.deleted);
  EXPECT_EQ(heard->composition.commit, "ok");
}

TEST(InputMethodLinesTest, AMalformedCompositionIsDropped) {
  EXPECT_FALSE(ReadComposition(ImeLineRead("{\"type\":\"composition\"}")));
  EXPECT_FALSE(ReadComposition(ImeLineRead(
      "{\"type\":\"composition\",\"serial\":-1,\"commit\":\"x\"}")));
  EXPECT_FALSE(ReadComposition(
      ImeLineRead("{\"type\":\"composition\",\"serial\":1,\"commit\":3}")));
  EXPECT_FALSE(ReadComposition(
      ImeLineRead("{\"type\":\"composition\",\"serial\":1,\"delete\":[1]}")));
  EXPECT_FALSE(ReadComposition(ImeLineRead(
      "{\"type\":\"composition\",\"serial\":1,\"preedit\":{\"text\":\"a\"}}")));
}

TEST(InputMethodLinesTest, APassedKeyIsRead) {
  const std::optional<PassedKey> passed = ReadPassedKey(
      ImeLineRead("{\"type\":\"key_passed\",\"serial\":1794500000000002,"
                  "\"keycode\":31,\"pressed\":false}"));
  ASSERT_TRUE(passed);
  EXPECT_EQ(passed->serial, 1794500000000002u);
  EXPECT_EQ(passed->evdev_code, 31u);
  EXPECT_FALSE(passed->pressed);

  EXPECT_FALSE(ReadPassedKey(
      ImeLineRead("{\"type\":\"key_passed\",\"serial\":1,\"keycode\":31}")));
}

}  // namespace
}  // namespace domicile
