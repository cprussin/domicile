// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_input_method.h"

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/strings/utf_offset_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/bind_post_task.h"
#include "ui/base/ime/composition_text.h"
#include "ui/base/ime/ime_text_span.h"
#include "ui/base/ime/linux/linux_input_method_context.h"
#include "ui/base/ime/text_input_type.h"
#include "ui/events/base_event_utils.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/events/ozone/layout/keyboard_layout_engine.h"
#include "ui/events/ozone/layout/keyboard_layout_engine_manager.h"
#include "ui/events/types/event_type.h"
#include "ui/gfx/range/range.h"

namespace ui {

namespace {

// Marks a key this dispatched again, so its context lets it past.
constexpr char kPassedProperty[] = "domicile_input_method_passed";

// Keys held for the input method at most. One it never answers would
// otherwise stay forever; a later key's answer drops it anyway.
constexpr size_t kMostHeld = 64;

// The most text around the cursor the input method is told, in UTF-16 units
// each side. `text-input-v3` caps the whole at 4000 bytes.
constexpr size_t kAroundTheCursor = 600;

// `text-input-v3`'s `content_purpose` and `content_hint` values.
constexpr uint32_t kPurposeNumber = 3;
constexpr uint32_t kPurposePhone = 4;
constexpr uint32_t kPurposeUrl = 5;
constexpr uint32_t kPurposeEmail = 6;
constexpr uint32_t kPurposePassword = 8;
constexpr uint32_t kPurposeDate = 10;
constexpr uint32_t kPurposeTime = 11;
constexpr uint32_t kPurposeDatetime = 12;
constexpr uint32_t kHintHiddenText = 0x40;
constexpr uint32_t kHintSensitiveData = 0x80;
constexpr uint32_t kHintMultiline = 0x200;

uint32_t PurposeOf(TextInputType type) {
  switch (type) {
    case TEXT_INPUT_TYPE_PASSWORD:
      return kPurposePassword;
    case TEXT_INPUT_TYPE_EMAIL:
      return kPurposeEmail;
    case TEXT_INPUT_TYPE_NUMBER:
      return kPurposeNumber;
    case TEXT_INPUT_TYPE_TELEPHONE:
      return kPurposePhone;
    case TEXT_INPUT_TYPE_URL:
      return kPurposeUrl;
    case TEXT_INPUT_TYPE_DATE:
      return kPurposeDate;
    case TEXT_INPUT_TYPE_TIME:
      return kPurposeTime;
    case TEXT_INPUT_TYPE_DATE_TIME:
    case TEXT_INPUT_TYPE_DATE_TIME_LOCAL:
      return kPurposeDatetime;
    default:
      return 0;
  }
}

uint32_t HintOf(TextInputType type) {
  switch (type) {
    case TEXT_INPUT_TYPE_PASSWORD:
      return kHintHiddenText | kHintSensitiveData;
    case TEXT_INPUT_TYPE_TEXT_AREA:
    case TEXT_INPUT_TYPE_CONTENT_EDITABLE:
      return kHintMultiline;
    default:
      return 0;
  }
}

void MarkPassed(KeyEvent& event) {
  Event::Properties properties;
  if (event.properties()) {
    properties = *event.properties();
  }
  properties[kPassedProperty] = {};
  event.SetProperties(properties);
}

// UTF-16 units in the `length` bytes of `text` from `from`, clamped to it.
size_t Utf16Length(const std::string& text, size_t from, size_t length) {
  from = std::min(from, text.size());
  length = std::min(length, text.size() - from);
  return base::UTF8ToUTF16(std::string_view(text).substr(from, length)).size();
}

}  // namespace

// One window's input method context. Lives as long as the window's
// `InputMethodAuraLinux`.
class DrmInputMethod::Context : public LinuxInputMethodContext {
 public:
  Context(base::WeakPtr<DrmInputMethod> owner,
          LinuxInputMethodContextDelegate* delegate)
      : owner_(std::move(owner)),
        delegate_(delegate),
        widget_(delegate->GetClientWindowKey()) {}

  Context(const Context&) = delete;
  Context& operator=(const Context&) = delete;

  ~Context() override {
    if (owner_) {
      owner_->Gone(this);
    }
  }

  bool focused() const { return focused_; }
  const DeskTextField& field() const { return field_; }
  gfx::AcceleratedWidget widget() const { return widget_; }

  // Delete, then commit, then show the preedit, as `text-input-v3`'s `done`
  // asks.
  void Apply(const DeskComposition& composition) {
    if (composition.deleted && field_.surrounding) {
      const std::string& text = *field_.surrounding;
      const size_t cursor = std::min<size_t>(field_.cursor, text.size());
      const size_t before =
          std::min<size_t>(composition.deleted->first, cursor);
      const size_t after = composition.deleted->second;
      delegate_->OnDeleteSurroundingText(
          Utf16Length(text, cursor - before, before),
          Utf16Length(text, cursor, after));
    }
    if (composition.commit) {
      delegate_->OnCommit(base::UTF8ToUTF16(*composition.commit));
      preediting_ = false;
    }
    if (composition.preedit && !composition.preedit->text.empty()) {
      if (!preediting_) {
        delegate_->OnPreeditStart();
        preediting_ = true;
      }
      delegate_->OnPreeditChanged(CompositionOf(*composition.preedit));
    } else if (preediting_) {
      delegate_->OnPreeditEnd();
      preediting_ = false;
    }
  }

  // LinuxInputMethodContext:
  bool DispatchKeyEvent(const KeyEvent& key_event) override {
    if (IsPassed(key_event) || !owner_) {
      return false;
    }
    return owner_->TakesKey(this, key_event);
  }

  bool IsPeekKeyEvent(const KeyEvent& key_event) override { return false; }

  void SetCursorLocation(const gfx::Rect& rect) override {
    field_.caret = rect;
    Changed();
  }

  void SetSurroundingText(const std::u16string& text,
                          const gfx::Range& text_range,
                          const gfx::Range& composition_range,
                          const gfx::Range& selection_range) override {
    if (!field_.enabled || !text_range.IsValid() ||
        !selection_range.IsValid() ||
        selection_range.GetMin() < text_range.start() ||
        selection_range.GetMax() > text_range.start() + text.size()) {
      return;
    }
    size_t cursor = selection_range.end() - text_range.start();
    size_t anchor = selection_range.start() - text_range.start();
    // Only so much around the cursor.
    const size_t from =
        cursor > kAroundTheCursor ? cursor - kAroundTheCursor : 0;
    const size_t to = std::min(text.size(), cursor + kAroundTheCursor);
    anchor = std::clamp(anchor, from, to);
    std::vector<size_t> offsets = {cursor - from, anchor - from};
    field_.surrounding = base::UTF16ToUTF8AndAdjustOffsets(
        text.substr(from, to - from), &offsets);
    field_.cursor =
        static_cast<uint32_t>(std::min(offsets[0], field_.surrounding->size()));
    field_.anchor =
        static_cast<uint32_t>(std::min(offsets[1], field_.surrounding->size()));
    Changed();
  }

  void Reset() override { preediting_ = false; }

  void UpdateFocus(bool has_client,
                   TextInputType old_type,
                   const TextInputClientAttributes& new_client_attributes,
                   TextInputClient::FocusReason reason) override {
    focused_ = has_client;
    preediting_ = false;
    field_ = DeskTextField();
    field_.enabled =
        has_client && new_client_attributes.input_type != TEXT_INPUT_TYPE_NONE;
    if (field_.enabled) {
      field_.purpose = PurposeOf(new_client_attributes.input_type);
      field_.hint = HintOf(new_client_attributes.input_type);
    }
    Changed();
  }

  VirtualKeyboardController* GetVirtualKeyboardController() override {
    return nullptr;
  }

 private:
  void Changed() {
    if (owner_) {
      owner_->Changed(this);
    }
  }

  static CompositionText CompositionOf(const DeskPreedit& preedit) {
    CompositionText composition;
    std::vector<size_t> offsets;
    if (preedit.cursor_begin >= 0 && preedit.cursor_end >= 0) {
      offsets = {static_cast<size_t>(preedit.cursor_begin),
                 static_cast<size_t>(preedit.cursor_end)};
    }
    composition.text =
        base::UTF8ToUTF16AndAdjustOffsets(preedit.text, &offsets);
    const size_t length = composition.text.size();
    if (offsets.size() == 2) {
      composition.selection = gfx::Range(std::min(offsets[0], length),
                                         std::min(offsets[1], length));
    } else {
      composition.selection = gfx::Range(length);
    }
    composition.ime_text_spans.emplace_back(ImeTextSpan::Type::kComposition, 0,
                                            length,
                                            ImeTextSpan::Thickness::kThin);
    return composition;
  }

  const base::WeakPtr<DrmInputMethod> owner_;
  const raw_ptr<LinuxInputMethodContextDelegate> delegate_;
  // The delegate's window, kept because the delegate is going when this is.
  const gfx::AcceleratedWidget widget_;
  DeskTextField field_;
  bool focused_ = false;
  // Whether the field shows a preedit this put there.
  bool preediting_ = false;
};

DrmInputMethod::Held::Held(gfx::AcceleratedWidget widget,
                           std::unique_ptr<KeyEvent> event)
    : widget(widget), event(std::move(event)) {}
DrmInputMethod::Held::Held(Held&&) = default;
DrmInputMethod::Held& DrmInputMethod::Held::operator=(Held&&) = default;
DrmInputMethod::Held::~Held() = default;

DrmInputMethod::DrmInputMethod(FieldSent field_sent,
                               KeySent key_sent,
                               Redispatch redispatch)
    : field_sent_(std::move(field_sent)),
      key_sent_(std::move(key_sent)),
      redispatch_(std::move(redispatch)) {}

DrmInputMethod::~DrmInputMethod() = default;

// static
std::unique_ptr<DrmInputMethod> DrmInputMethod::ForTheDesk(
    Redispatch redispatch) {
  auto method = std::make_unique<DrmInputMethod>(
      base::BindRepeating([](const DeskTextField& field) {
        DeskInputMethod::Get().SendField(field);
      }),
      base::BindRepeating([](uint32_t evdev_code, bool pressed) {
        return DeskInputMethod::Get().SendKey(evdev_code, pressed);
      }),
      std::move(redispatch));
  base::WeakPtr<DrmInputMethod> weak = method->weak_factory_.GetWeakPtr();
  DeskInputMethod::Editor editor;
  editor.composing = base::BindPostTaskToCurrentDefault(
      base::BindRepeating(&DrmInputMethod::SetComposing, weak));
  editor.composed = base::BindPostTaskToCurrentDefault(
      base::BindRepeating(&DrmInputMethod::Compose, weak));
  editor.passed = base::BindPostTaskToCurrentDefault(
      base::BindRepeating(&DrmInputMethod::Passed, weak));
  DeskInputMethod::Get().SetEditor(std::move(editor));
  return method;
}

std::unique_ptr<LinuxInputMethodContext> DrmInputMethod::CreateContext(
    LinuxInputMethodContextDelegate* delegate) {
  return std::make_unique<Context>(weak_factory_.GetWeakPtr(), delegate);
}

void DrmInputMethod::SetComposing(bool composing) {
  composing_ = composing;
}

void DrmInputMethod::Compose(const DeskComposition& composition) {
  if (focused_) {
    focused_->Apply(composition);
  }
}

void DrmInputMethod::Passed(uint32_t evdev_code, bool pressed) {
  const EventType type =
      pressed ? EventType::kKeyPressed : EventType::kKeyReleased;
  const DomCode code =
      KeycodeConverter::EvdevCodeToDomCode(static_cast<int>(evdev_code));
  auto held = std::find_if(held_.begin(), held_.end(), [&](const Held& each) {
    return each.event->type() == type && each.event->code() == code;
  });
  if (held != held_.end()) {
    // The keys before it were composed: the input method took them.
    Held passed = std::move(*held);
    held_.erase(held_.begin(), held + 1);
    MarkPassed(*passed.event);
    redispatch_.Run(passed.widget, passed.event.get());
    return;
  }
  // A key typed by another program, through a virtual keyboard: into the
  // field with focus.
  if (!focused_ || code == DomCode::NONE) {
    return;
  }
  DomKey key;
  KeyboardCode key_code = VKEY_UNKNOWN;
  if (KeyboardLayoutEngine* layout =
          KeyboardLayoutEngineManager::GetKeyboardLayoutEngine()) {
    layout->Lookup(code, EF_NONE, &key, &key_code);
  }
  KeyEvent typed(type, key_code, code, EF_NONE, key, EventTimeForNow());
  MarkPassed(typed);
  redispatch_.Run(focused_->widget(), &typed);
}

// static
bool DrmInputMethod::IsPassed(const KeyEvent& event) {
  return event.properties() && event.properties()->contains(kPassedProperty);
}

void DrmInputMethod::Changed(Context* context) {
  if (context->focused()) {
    focused_ = context;
    field_sent_.Run(context->field());
  } else if (focused_ == context) {
    focused_ = nullptr;
    field_sent_.Run(DeskTextField());
  }
}

void DrmInputMethod::Gone(Context* context) {
  std::erase_if(held_, [&](const Held& each) {
    return each.widget == context->widget();
  });
  if (focused_ == context) {
    focused_ = nullptr;
    field_sent_.Run(DeskTextField());
  }
}

bool DrmInputMethod::TakesKey(Context* context, const KeyEvent& event) {
  if (!composing_ || focused_ != context || !context->field().enabled) {
    return false;
  }
  const bool pressed = event.type() == EventType::kKeyPressed;
  if (!pressed && event.type() != EventType::kKeyReleased) {
    return false;
  }
  const int evdev_code = KeycodeConverter::DomCodeToEvdevCode(event.code());
  if (evdev_code <= 0 ||
      !key_sent_.Run(static_cast<uint32_t>(evdev_code), pressed)) {
    return false;
  }
  held_.emplace_back(context->widget(), std::make_unique<KeyEvent>(event));
  if (held_.size() > kMostHeld) {
    held_.pop_front();
  }
  return true;
}

}  // namespace ui
