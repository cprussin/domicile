// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_INPUT_METHOD_LINES_H_
#define COMPONENTS_DOMICILE_BROWSER_INPUT_METHOD_LINES_H_

#include <stdint.h>

#include <optional>

#include "base/values.h"
#include "ui/base/ime/domicile/desk_input_method.h"

namespace domicile {

// The control channel's input method messages, which are the browser's and
// never the page's: the focused field goes to the compositor, which is its
// editor on the desk's input method, and what that composed comes back. See
// ui/base/ime/domicile/desk_input_method.h and docs/architecture/TEXT-INPUT.md
// in the Domicile repository.
//
// Their own file beside the channel so a test can read and write them with no
// socket.

// `text_input`: the focused field.
base::DictValue TextInputMessage(const ui::DeskTextField& field);
// `key_for_input_method`: a key the input method hears first.
base::DictValue KeyForInputMethodMessage(uint32_t evdev_code, bool pressed);

// `composition`, which every page's channel hears. The serial is what lets
// the desk's input method keep only the first.
struct HeardComposition {
  uint64_t serial = 0;
  ui::DeskComposition composition;
};
std::optional<HeardComposition> ReadComposition(const base::DictValue& message);

// `key_passed`: a key the input method did not take.
struct PassedKey {
  uint64_t serial = 0;
  uint32_t evdev_code = 0;
  bool pressed = false;
};
std::optional<PassedKey> ReadPassedKey(const base::DictValue& message);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_INPUT_METHOD_LINES_H_
