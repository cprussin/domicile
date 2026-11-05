// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_LIBINPUT_SEAT_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_LIBINPUT_SEAT_H_

#include <libinput.h>

#include <map>
#include <string>

#include "base/component_export.h"
#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/message_loop/message_pump_for_ui.h"
#include "base/types/expected.h"

namespace ui {

// Shares libinput's keyboard pairing and timers across authorized seat devices.
class COMPONENT_EXPORT(EVDEV) LibInputSeat
    : public base::MessagePumpForUI::FdWatcher {
 public:
  using EventHandler = base::RepeatingCallback<void(libinput_event*)>;

  LibInputSeat();
  LibInputSeat(const LibInputSeat&) = delete;
  LibInputSeat& operator=(const LibInputSeat&) = delete;
  ~LibInputSeat() override;

  // Duplicates the authorized descriptor for restricted opens; never opens a
  // device node by name.
  base::expected<libinput_device*, std::string> AddDevice(
      const base::ScopedFD& fd,
      const base::FilePath& path);
  void SetEventHandler(libinput_device* device, EventHandler handler);
  void RemoveDevice(libinput_device* device);

 private:
  static int OpenRestricted(const char* path, int flags, void* data);
  static void CloseRestricted(int fd, void* data);
  static void LogHandler(libinput* context,
                         libinput_log_priority priority,
                         const char* format,
                         va_list arguments);

  void OnFileCanReadWithoutBlocking(int fd) override;
  void OnFileCanWriteWithoutBlocking(int fd) override;

  static constexpr libinput_interface interface_ = {OpenRestricted,
                                                    CloseRestricted};

  std::map<base::FilePath, base::ScopedFD> authorized_fds_;
  std::map<libinput_device*, base::FilePath> paths_;
  std::map<libinput_device*, EventHandler> handlers_;
  raw_ptr<libinput> context_;
  base::MessagePumpForUI::FdWatchController watch_;
  bool watching_ = false;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_LIBINPUT_SEAT_H_
