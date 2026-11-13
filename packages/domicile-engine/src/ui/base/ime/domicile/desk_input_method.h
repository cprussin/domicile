// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_BASE_IME_DOMICILE_DESK_INPUT_METHOD_H_
#define UI_BASE_IME_DOMICILE_DESK_INPUT_METHOD_H_

#include <stdint.h>

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/component_export.h"
#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"
#include "ui/gfx/geometry/rect.h"

namespace ui {

// The browser's focused text field, as the desk's input method reads it: the
// compositor's `text_input` message, which is `text-input-v3`'s state.
struct COMPONENT_EXPORT(DESK_INPUT_METHOD) DeskTextField {
  DeskTextField();
  DeskTextField(const DeskTextField&);
  DeskTextField& operator=(const DeskTextField&);
  ~DeskTextField();

  bool operator==(const DeskTextField&) const = default;

  // Whether a field that takes text has focus. The rest is unset when not.
  bool enabled = false;
  // The text around the cursor, UTF-8, with the cursor and the selection's
  // other end as byte offsets into it. Unset when unknown.
  std::optional<std::string> surrounding;
  uint32_t cursor = 0;
  uint32_t anchor = 0;
  // `text-input-v3`'s `content_hint` bits and `content_purpose`.
  uint32_t hint = 0;
  uint32_t purpose = 0;
  // The text cursor, in desk logical pixels. Unset when unknown.
  std::optional<gfx::Rect> caret;
};

// Text being composed: shown in place, with the cursor from `cursor_begin` to
// `cursor_end`, byte offsets into `text`. Both -1 hides the cursor.
struct COMPONENT_EXPORT(DESK_INPUT_METHOD) DeskPreedit {
  bool operator==(const DeskPreedit&) const = default;

  std::string text;
  int32_t cursor_begin = 0;
  int32_t cursor_end = 0;
};

// What the input method did to the focused field, applied together: delete
// around the cursor, then commit, then show the preedit. No preedit ends any
// shown.
struct COMPONENT_EXPORT(DESK_INPUT_METHOD) DeskComposition {
  DeskComposition();
  DeskComposition(const DeskComposition&);
  DeskComposition& operator=(const DeskComposition&);
  ~DeskComposition();

  bool operator==(const DeskComposition&) const = default;

  std::optional<DeskPreedit> preedit;
  std::optional<std::string> commit;
  // Bytes before and after the cursor, in the field's UTF-8 text.
  std::optional<std::pair<uint32_t, uint32_t>> deleted;
};

// The desk's input method (fcitx5, IBus), between the compositor and the
// browser's text fields. See docs/architecture/TEXT-INPUT.md in the Domicile
// repository.
//
// The compositor relays `text-input-v3` and `input-method-v2`, and the browser
// joins as one editor over its control channels:
//
// - The DRM platform's input method (the editor, on the UI thread) sends the
//   focused field and, while the input method composes, every key, to the
//   first control channel (on the IO thread).
// - The control channels hand back whether the input method composes, what
//   it composed and the keys it passed on. Each compositor message carries a
//   serial; one already heard on another channel is dropped, so a browser
//   with a page per monitor applies each once.
//
// Callers wrap callbacks with `base::BindPostTask`: they run on the caller's
// thread, never under the lock.
class COMPONENT_EXPORT(DESK_INPUT_METHOD) DeskInputMethod {
 public:
  // Handle for removing a channel. Never zero.
  using ChannelId = uint64_t;
  using FieldSent = base::RepeatingCallback<void(const DeskTextField&)>;
  // An evdev code, pressed or released.
  using KeySent = base::RepeatingCallback<void(uint32_t, bool)>;

  // The editor's ends.
  struct COMPONENT_EXPORT(DESK_INPUT_METHOD) Editor {
    Editor();
    Editor(Editor&&);
    Editor& operator=(Editor&&);
    ~Editor();

    // Whether keys go to the input method first. Called on each change.
    base::RepeatingCallback<void(bool)> composing;
    base::RepeatingCallback<void(const DeskComposition&)> composed;
    // A key the input method passed on uncomposed: an evdev code, pressed or
    // released.
    base::RepeatingCallback<void(uint32_t, bool)> passed;
  };

  // The process's. Tests build their own instead.
  static DeskInputMethod& Get();

  DeskInputMethod();
  DeskInputMethod(const DeskInputMethod&) = delete;
  DeskInputMethod& operator=(const DeskInputMethod&) = delete;
  ~DeskInputMethod();

  // A control channel's ends. The first channel added sends; the field as it
  // stands goes to a channel that becomes the first.
  ChannelId AddChannel(FieldSent field, KeySent key);
  void RemoveChannel(ChannelId channel);

  // From a compositor. A channel that loses its compositor says
  // `SetComposing(false)`, so keys are not sent to an input method that is
  // gone.
  void SetComposing(bool composing);
  void Compose(uint64_t serial, DeskComposition composition);
  void PassKey(uint64_t serial, uint32_t evdev_code, bool pressed);

  // The editor's. Set once; a second replaces the first.
  void SetEditor(Editor editor);
  // The focused field. One that is unchanged is not sent again.
  void SendField(DeskTextField field);
  // Whether a channel took it.
  bool SendKey(uint32_t evdev_code, bool pressed);

  // Back to new, for tests of the process's.
  void ResetForTesting();

 private:
  struct Channel {
    ChannelId id;
    FieldSent field;
    KeySent key;
  };

  // Whether `serial` is new, remembering it if so.
  bool Fresh(uint64_t serial) EXCLUSIVE_LOCKS_REQUIRED(lock_);

  base::Lock lock_;
  ChannelId next_id_ GUARDED_BY(lock_) = 1;
  std::vector<Channel> channels_ GUARDED_BY(lock_);
  Editor editor_ GUARDED_BY(lock_);
  bool composing_ GUARDED_BY(lock_) = false;
  std::optional<uint64_t> last_serial_ GUARDED_BY(lock_);
  std::optional<DeskTextField> field_ GUARDED_BY(lock_);
};

}  // namespace ui

#endif  // UI_BASE_IME_DOMICILE_DESK_INPUT_METHOD_H_
