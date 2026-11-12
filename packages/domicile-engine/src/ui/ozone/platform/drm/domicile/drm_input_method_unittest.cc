// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_input_method.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/test/task_environment.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/ime/composition_text.h"
#include "ui/base/ime/domicile/desk_input_method.h"
#include "ui/base/ime/linux/linux_input_method_context.h"
#include "ui/base/ime/text_input_client.h"
#include "ui/events/event.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/range/range.h"
#include "url/gurl.h"

namespace ui {
namespace {

// `a`, as evdev numbers it.
constexpr uint32_t kEvdevA = 30;

constexpr gfx::AcceleratedWidget kWindow = 7;

// A window's input method, as Chromium's `InputMethodAuraLinux` is to the
// context: it hears what the context does to the field.
class FakeDelegate : public LinuxInputMethodContextDelegate {
 public:
  gfx::AcceleratedWidget GetClientWindowKey() const override { return kWindow; }
  void OnCommit(const std::u16string& text) override {
    heard.push_back("commit " + base::UTF16ToUTF8(text));
  }
  void OnConfirmCompositionText(bool keep_selection) override {}
  void OnDeleteSurroundingText(size_t before, size_t after) override {
    heard.push_back("delete " + base::NumberToString(before) + " " +
                    base::NumberToString(after));
  }
  void OnPreeditChanged(const CompositionText& composition) override {
    heard.push_back("preedit " + base::UTF16ToUTF8(composition.text) + " " +
                    composition.selection.ToString());
  }
  void OnPreeditEnd() override { heard.push_back("preedit end"); }
  void OnPreeditStart() override { heard.push_back("preedit start"); }
  void OnSetPreeditRegion(const gfx::Range& range,
                          const std::vector<ImeTextSpan>& spans) override {}
  void OnSetVirtualKeyboardOccludedBounds(
      const gfx::Rect& screen_bounds) override {}
  void OnInsertImage(const GURL& src) override {}

  std::vector<std::string> heard;
};

// The platform's input method with what it sends recorded, and one window's
// context.
class DrmInputMethodTest : public testing::Test {
 protected:
  DrmInputMethodTest()
      : method_(base::BindRepeating(&DrmInputMethodTest::FieldSent,
                                    base::Unretained(this)),
                base::BindRepeating(&DrmInputMethodTest::KeySent,
                                    base::Unretained(this)),
                base::BindRepeating(&DrmInputMethodTest::Redispatched,
                                    base::Unretained(this))),
        context_(method_.CreateContext(&delegate_)) {}

  void FieldSent(const DeskTextField& field) { fields_.push_back(field); }
  bool KeySent(uint32_t evdev_code, bool pressed) {
    keys_.emplace_back(evdev_code, pressed);
    return true;
  }
  void Redispatched(gfx::AcceleratedWidget widget, KeyEvent* event) {
    EXPECT_EQ(widget, kWindow);
    redispatched_.push_back(std::make_unique<KeyEvent>(*event));
  }

  // Focuses a field of `type` in the window.
  void Focus(TextInputType type = TEXT_INPUT_TYPE_TEXT) {
    LinuxInputMethodContext::TextInputClientAttributes attributes;
    attributes.input_type = type;
    context_->UpdateFocus(true, TEXT_INPUT_TYPE_NONE, attributes,
                          TextInputClient::FOCUS_REASON_MOUSE);
  }

  static KeyEvent A(EventType type) {
    return KeyEvent(type, VKEY_A, DomCode::US_A, EF_NONE);
  }

  FakeDelegate delegate_;
  std::vector<DeskTextField> fields_;
  std::vector<std::pair<uint32_t, bool>> keys_;
  std::vector<std::unique_ptr<KeyEvent>> redispatched_;
  DrmInputMethod method_;
  std::unique_ptr<LinuxInputMethodContext> context_;
};

TEST_F(DrmInputMethodTest, AFocusedFieldIsSentWithItsTextAndCaret) {
  Focus();
  context_->SetSurroundingText(u"h\u00e9llo", gfx::Range(0, 5), gfx::Range(),
                               gfx::Range(5));
  context_->SetCursorLocation(gfx::Rect(200, 100, 2, 18));

  ASSERT_FALSE(fields_.empty());
  const DeskTextField& field = fields_.back();
  EXPECT_TRUE(field.enabled);
  EXPECT_EQ(field.surrounding, "h\xc3\xa9llo");
  EXPECT_EQ(field.cursor, 6u) << "byte offsets: the accent is two bytes";
  EXPECT_EQ(field.anchor, 6u);
  EXPECT_EQ(field.caret, gfx::Rect(200, 100, 2, 18));
}

TEST_F(DrmInputMethodTest, ASelectionSendsItsAnchor) {
  Focus();
  context_->SetSurroundingText(u"xxhello", gfx::Range(10, 17), gfx::Range(),
                               gfx::Range(12, 15));
  EXPECT_EQ(fields_.back().surrounding, "xxhello");
  EXPECT_EQ(fields_.back().anchor, 2u);
  EXPECT_EQ(fields_.back().cursor, 5u);
}

TEST_F(DrmInputMethodTest, APasswordFieldSaysSo) {
  Focus(TEXT_INPUT_TYPE_PASSWORD);
  EXPECT_EQ(fields_.back().purpose, 8u);
  EXPECT_EQ(fields_.back().hint, 0x40u | 0x80u);
}

TEST_F(DrmInputMethodTest, LosingFocusSendsNoField) {
  Focus();
  context_->UpdateFocus(false, TEXT_INPUT_TYPE_TEXT, {},
                        TextInputClient::FOCUS_REASON_NONE);
  EXPECT_FALSE(fields_.back().enabled);
}

TEST_F(DrmInputMethodTest, KeysPassStraightThroughUntilTheInputMethodComposes) {
  Focus();
  KeyEvent press = A(EventType::kKeyPressed);
  EXPECT_FALSE(context_->DispatchKeyEvent(press));
  EXPECT_TRUE(keys_.empty());

  method_.SetComposing(true);
  EXPECT_TRUE(context_->DispatchKeyEvent(press)) << "held for the input method";
  EXPECT_EQ(keys_, (std::vector<std::pair<uint32_t, bool>>{{kEvdevA, true}}));
}

TEST_F(DrmInputMethodTest, AKeyInNoFieldIsNotTheInputMethods) {
  method_.SetComposing(true);
  Focus(TEXT_INPUT_TYPE_NONE);
  KeyEvent press = A(EventType::kKeyPressed);
  EXPECT_FALSE(context_->DispatchKeyEvent(press));
  EXPECT_TRUE(keys_.empty());
}

TEST_F(DrmInputMethodTest, APassedKeyIsDispatchedAgainPastTheInputMethod) {
  Focus();
  method_.SetComposing(true);
  KeyEvent press = A(EventType::kKeyPressed);
  ASSERT_TRUE(context_->DispatchKeyEvent(press));

  method_.Passed(kEvdevA, true);
  ASSERT_EQ(redispatched_.size(), 1u);
  EXPECT_EQ(redispatched_[0]->code(), DomCode::US_A);
  EXPECT_EQ(redispatched_[0]->type(), EventType::kKeyPressed);
  EXPECT_TRUE(DrmInputMethod::IsPassed(*redispatched_[0]));
  EXPECT_FALSE(context_->DispatchKeyEvent(*redispatched_[0]))
      << "a passed key does not go back to the input method";
  EXPECT_EQ(keys_.size(), 1u);
}

TEST_F(DrmInputMethodTest, AKeyAnotherProgramTypedReachesTheFocusedField) {
  Focus();
  method_.Passed(kEvdevA, true);
  ASSERT_EQ(redispatched_.size(), 1u);
  EXPECT_EQ(redispatched_[0]->code(), DomCode::US_A);
  EXPECT_TRUE(DrmInputMethod::IsPassed(*redispatched_[0]));
}

TEST_F(DrmInputMethodTest, APreeditShowsAndACommitReplacesIt) {
  Focus();
  DeskComposition preedit;
  preedit.preedit = DeskPreedit{"ni", 0, 2};
  method_.Compose(preedit);
  DeskComposition commit;
  commit.commit = "\xe4\xbd\xa0";
  method_.Compose(commit);

  EXPECT_EQ(delegate_.heard,
            (std::vector<std::string>{"preedit start", "preedit ni {0,2}",
                                      "commit \xe4\xbd\xa0"}));
}

TEST_F(DrmInputMethodTest, AnEmptiedPreeditEnds) {
  Focus();
  DeskComposition preedit;
  preedit.preedit = DeskPreedit{"ni", 2, 2};
  method_.Compose(preedit);
  method_.Compose(DeskComposition());
  EXPECT_EQ(delegate_.heard,
            (std::vector<std::string>{"preedit start", "preedit ni {2,2}",
                                      "preedit end"}));
}

TEST_F(DrmInputMethodTest, APreeditCursorCountsUtf16) {
  Focus();
  DeskComposition preedit;
  preedit.preedit = DeskPreedit{"\xe4\xbd\xa0x", 3, 3};  // after U+4F60
  method_.Compose(preedit);
  EXPECT_EQ(delegate_.heard.back(), "preedit \xe4\xbd\xa0x {1,1}");
}

TEST_F(DrmInputMethodTest, DeletingAroundTheCursorCountsUtf16) {
  Focus();
  context_->SetSurroundingText(u"a\u00e9b", gfx::Range(0, 3), gfx::Range(),
                               gfx::Range(2));
  DeskComposition deleted;
  deleted.deleted = std::make_pair(2u, 1u);  // the accented e, then b
  method_.Compose(deleted);
  EXPECT_EQ(delegate_.heard, (std::vector<std::string>{"delete 1 1"}));
}

TEST_F(DrmInputMethodTest, ACompositionReachesOnlyTheFocusedWindow) {
  DeskComposition commit;
  commit.commit = "x";
  method_.Compose(commit);
  EXPECT_TRUE(delegate_.heard.empty()) << "no field has focus";
}

// The process's go-between, as the control channels and the platform use it.
class DeskInputMethodTest : public testing::Test {
 protected:
  base::test::SingleThreadTaskEnvironment task_environment_;
  DeskInputMethod desk_;
};

TEST_F(DeskInputMethodTest, TheFirstChannelSendsAndALaterOneTakesOver) {
  std::vector<std::string> sent;
  const DeskInputMethod::ChannelId first = desk_.AddChannel(
      base::BindRepeating(
          [](std::vector<std::string>* sent, const DeskTextField&) {
            sent->push_back("first field");
          },
          &sent),
      base::BindRepeating([](std::vector<std::string>* sent, uint32_t,
                             bool) { sent->push_back("first key"); },
                          &sent));
  desk_.AddChannel(
      base::BindRepeating(
          [](std::vector<std::string>* sent, const DeskTextField&) {
            sent->push_back("second field");
          },
          &sent),
      base::BindRepeating([](std::vector<std::string>* sent, uint32_t,
                             bool) { sent->push_back("second key"); },
                          &sent));
  DeskTextField field;
  field.enabled = true;
  desk_.SendField(field);
  desk_.SendField(field);
  EXPECT_TRUE(desk_.SendKey(kEvdevA, true));
  desk_.RemoveChannel(first);
  EXPECT_TRUE(desk_.SendKey(kEvdevA, false));

  EXPECT_EQ(sent, (std::vector<std::string>{"first field", "first key",
                                            "second field", "second key"}))
      << "an unchanged field is not sent again; the next channel hears the "
         "field as it stands";
}

TEST_F(DeskInputMethodTest, NoChannelTakesNoKey) {
  EXPECT_FALSE(desk_.SendKey(kEvdevA, true));
}

TEST_F(DeskInputMethodTest, ACompositionHeardOnTwoChannelsIsAppliedOnce) {
  int composed = 0;
  int passed = 0;
  DeskInputMethod::Editor editor;
  editor.composed = base::BindRepeating(
      [](int* composed, const DeskComposition&) { ++*composed; }, &composed);
  editor.passed = base::BindRepeating(
      [](int* passed, uint32_t, bool) { ++*passed; }, &passed);
  desk_.SetEditor(std::move(editor));

  desk_.Compose(5, DeskComposition());
  desk_.Compose(5, DeskComposition());
  desk_.PassKey(6, kEvdevA, true);
  desk_.PassKey(6, kEvdevA, true);
  desk_.Compose(4, DeskComposition());

  EXPECT_EQ(composed, 1);
  EXPECT_EQ(passed, 1);
}

TEST_F(DeskInputMethodTest, TheEditorHearsComposingOnChange) {
  std::vector<bool> heard;
  DeskInputMethod::Editor editor;
  editor.composing =
      base::BindRepeating([](std::vector<bool>* heard,
                             bool composing) { heard->push_back(composing); },
                          &heard);
  desk_.SetEditor(std::move(editor));
  desk_.SetComposing(true);
  desk_.SetComposing(true);
  desk_.SetComposing(false);
  EXPECT_EQ(heard, (std::vector<bool>{true, false}));
}

}  // namespace
}  // namespace ui
