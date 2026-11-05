// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_LIBINPUT_KEYBOARD_EVENT_CONVERTER_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_LIBINPUT_KEYBOARD_EVENT_CONVERTER_H_

#include <memory>

#include "base/memory/raw_ptr.h"
#include "base/memory/raw_ref.h"
#include "ui/events/ozone/evdev/event_converter_evdev_impl.h"

struct input_event;
struct libinput_device;
struct libinput_event;

namespace ui {

class LibInputSeat;

// A shared libinput device keeps Chromium's key state, filters and LED path.
class COMPONENT_EXPORT(EVDEV) LibInputKeyboardEventConverter
    : public EventConverterEvdevImpl {
 public:
  static std::unique_ptr<LibInputKeyboardEventConverter> Create(
      LibInputSeat& seat,
      base::ScopedFD fd,
      const base::FilePath& path,
      int id,
      const EventDeviceInfo& info,
      CursorDelegateEvdev* cursor,
      DeviceEventDispatcherEvdev* dispatcher);

  LibInputKeyboardEventConverter(LibInputSeat& seat,
                                 base::ScopedFD fd,
                                 libinput_device* device,
                                 const base::FilePath& path,
                                 int id,
                                 const EventDeviceInfo& info,
                                 CursorDelegateEvdev* cursor,
                                 DeviceEventDispatcherEvdev* dispatcher);
  ~LibInputKeyboardEventConverter() override;

  void Start() override;
  void Stop() override;
  void SetTypingGuard(TypingGuard* guard) override;

 protected:
  libinput_device* device() const { return device_.get(); }
  virtual void HandleEvent(libinput_event* event);

 private:
  const raw_ref<LibInputSeat> seat_;
  raw_ptr<libinput_device> device_;
};

// Libinput key times use the same monotonic origin as evdev input events.
COMPONENT_EXPORT(EVDEV)
input_event LibInputKeyboardKey(unsigned key,
                                bool down,
                                base::TimeTicks timestamp);

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_LIBINPUT_KEYBOARD_EVENT_CONVERTER_H_
