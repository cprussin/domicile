// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/input_method_lines.h"

#include <cmath>
#include <limits>
#include <string>
#include <string_view>
#include <utility>

namespace domicile {

namespace {

// JSON carries a number as a double, which holds every integer up to 2^53
// exactly. The compositor's serials are microseconds since the epoch and its
// offsets are into a few hundred bytes, so a value past that is not one of
// them.
template <typename T>
std::optional<T> Whole(const base::DictValue& message, std::string_view key) {
  const std::optional<double> number = message.FindDouble(key);
  if (!number || *number < 0 || std::floor(*number) != *number ||
      *number > 9007199254740992.0 ||
      *number > static_cast<double>(std::numeric_limits<T>::max())) {
    return std::nullopt;
  }
  return static_cast<T>(*number);
}

std::optional<int32_t> Signed(const base::DictValue& message,
                              std::string_view key) {
  return message.FindInt(key);
}

}  // namespace

base::DictValue TextInputMessage(const ui::DeskTextField& field) {
  base::DictValue described;
  described.Set("enabled", field.enabled);
  if (field.surrounding) {
    described.Set("surrounding",
                  base::DictValue()
                      .Set("text", *field.surrounding)
                      .Set("cursor", static_cast<int>(field.cursor))
                      .Set("anchor", static_cast<int>(field.anchor)));
  }
  described.Set("hint", static_cast<int>(field.hint));
  described.Set("purpose", static_cast<int>(field.purpose));
  if (field.caret) {
    base::ListValue caret;
    caret.Append(field.caret->x());
    caret.Append(field.caret->y());
    caret.Append(field.caret->width());
    caret.Append(field.caret->height());
    described.Set("cursor", std::move(caret));
  }
  base::DictValue message;
  message.Set("type", "text_input");
  message.Set("field", std::move(described));
  return message;
}

base::DictValue KeyForInputMethodMessage(uint32_t evdev_code, bool pressed) {
  base::DictValue message;
  message.Set("type", "key_for_input_method");
  message.Set("keycode", static_cast<int>(evdev_code));
  message.Set("pressed", pressed);
  return message;
}

std::optional<HeardComposition> ReadComposition(
    const base::DictValue& message) {
  const std::optional<uint64_t> serial = Whole<uint64_t>(message, "serial");
  if (!serial) {
    return std::nullopt;
  }
  HeardComposition heard;
  heard.serial = *serial;
  if (const base::DictValue* preedit = message.FindDict("preedit")) {
    const std::string* text = preedit->FindString("text");
    const std::optional<int32_t> begin = Signed(*preedit, "cursor_begin");
    const std::optional<int32_t> end = Signed(*preedit, "cursor_end");
    if (!text || !begin || !end) {
      return std::nullopt;
    }
    heard.composition.preedit = ui::DeskPreedit{
        .text = *text, .cursor_begin = *begin, .cursor_end = *end};
  }
  if (const base::Value* commit = message.Find("commit")) {
    if (!commit->is_string()) {
      return std::nullopt;
    }
    heard.composition.commit = commit->GetString();
  }
  if (const base::Value* deleted = message.Find("delete")) {
    const base::ListValue* pair = deleted->GetIfList();
    if (!pair || pair->size() != 2 || !(*pair)[0].is_int() ||
        !(*pair)[1].is_int() || (*pair)[0].GetInt() < 0 ||
        (*pair)[1].GetInt() < 0) {
      return std::nullopt;
    }
    heard.composition.deleted =
        std::make_pair(static_cast<uint32_t>((*pair)[0].GetInt()),
                       static_cast<uint32_t>((*pair)[1].GetInt()));
  }
  return heard;
}

std::optional<PassedKey> ReadPassedKey(const base::DictValue& message) {
  const std::optional<uint64_t> serial = Whole<uint64_t>(message, "serial");
  const std::optional<uint32_t> keycode = Whole<uint32_t>(message, "keycode");
  const std::optional<bool> pressed = message.FindBool("pressed");
  if (!serial || !keycode || !pressed) {
    return std::nullopt;
  }
  return PassedKey{
      .serial = *serial, .evdev_code = *keycode, .pressed = *pressed};
}

}  // namespace domicile
