// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/ime/domicile/desk_input_method.h"

#include <algorithm>

#include "base/no_destructor.h"

namespace ui {

DeskTextField::DeskTextField() = default;
DeskTextField::DeskTextField(const DeskTextField&) = default;
DeskTextField& DeskTextField::operator=(const DeskTextField&) = default;
DeskTextField::~DeskTextField() = default;

DeskComposition::DeskComposition() = default;
DeskComposition::DeskComposition(const DeskComposition&) = default;
DeskComposition& DeskComposition::operator=(const DeskComposition&) = default;
DeskComposition::~DeskComposition() = default;

DeskInputMethod::Editor::Editor() = default;
DeskInputMethod::Editor::Editor(Editor&&) = default;
DeskInputMethod::Editor& DeskInputMethod::Editor::operator=(Editor&&) = default;
DeskInputMethod::Editor::~Editor() = default;

// static
DeskInputMethod& DeskInputMethod::Get() {
  static base::NoDestructor<DeskInputMethod> desk;
  return *desk;
}

DeskInputMethod::DeskInputMethod() = default;
DeskInputMethod::~DeskInputMethod() = default;

DeskInputMethod::ChannelId DeskInputMethod::AddChannel(FieldSent field,
                                                       KeySent key) {
  std::optional<DeskTextField> resend;
  ChannelId id;
  {
    base::AutoLock hold(lock_);
    id = next_id_++;
    if (channels_.empty()) {
      resend = field_;
    }
    channels_.push_back(Channel{id, field, std::move(key)});
  }
  if (resend) {
    field.Run(*resend);
  }
  return id;
}

void DeskInputMethod::RemoveChannel(ChannelId channel) {
  std::optional<DeskTextField> resend;
  FieldSent next;
  {
    base::AutoLock hold(lock_);
    const bool was_first =
        !channels_.empty() && channels_.front().id == channel;
    std::erase_if(channels_, [channel](const Channel& each) {
      return each.id == channel;
    });
    if (was_first && !channels_.empty()) {
      resend = field_;
      next = channels_.front().field;
    }
  }
  if (resend) {
    next.Run(*resend);
  }
}

void DeskInputMethod::SetComposing(bool composing) {
  base::RepeatingCallback<void(bool)> tell;
  {
    base::AutoLock hold(lock_);
    if (composing == composing_) {
      return;
    }
    composing_ = composing;
    tell = editor_.composing;
  }
  if (tell) {
    tell.Run(composing);
  }
}

void DeskInputMethod::Compose(uint64_t serial, DeskComposition composition) {
  base::RepeatingCallback<void(const DeskComposition&)> tell;
  {
    base::AutoLock hold(lock_);
    if (!Fresh(serial)) {
      return;
    }
    tell = editor_.composed;
  }
  if (tell) {
    tell.Run(composition);
  }
}

void DeskInputMethod::PassKey(uint64_t serial,
                              uint32_t evdev_code,
                              bool pressed) {
  base::RepeatingCallback<void(uint32_t, bool)> tell;
  {
    base::AutoLock hold(lock_);
    if (!Fresh(serial)) {
      return;
    }
    tell = editor_.passed;
  }
  if (tell) {
    tell.Run(evdev_code, pressed);
  }
}

void DeskInputMethod::SetEditor(Editor editor) {
  base::RepeatingCallback<void(bool)> tell;
  bool composing;
  {
    base::AutoLock hold(lock_);
    editor_ = std::move(editor);
    tell = editor_.composing;
    composing = composing_;
  }
  if (tell && composing) {
    tell.Run(true);
  }
}

void DeskInputMethod::SendField(DeskTextField field) {
  FieldSent send;
  {
    base::AutoLock hold(lock_);
    if (field_ == field) {
      return;
    }
    field_ = field;
    if (channels_.empty()) {
      return;
    }
    send = channels_.front().field;
  }
  send.Run(field);
}

bool DeskInputMethod::SendKey(uint32_t evdev_code, bool pressed) {
  KeySent send;
  {
    base::AutoLock hold(lock_);
    if (channels_.empty()) {
      return false;
    }
    send = channels_.front().key;
  }
  send.Run(evdev_code, pressed);
  return true;
}

void DeskInputMethod::ResetForTesting() {
  base::AutoLock hold(lock_);
  next_id_ = 1;
  channels_.clear();
  editor_ = Editor();
  composing_ = false;
  last_serial_.reset();
  field_.reset();
}

bool DeskInputMethod::Fresh(uint64_t serial) {
  if (last_serial_ && serial <= *last_serial_) {
    return false;
  }
  last_serial_ = serial;
  return true;
}

}  // namespace ui
