// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/libinput_seat.h"

#include <errno.h>
#include <fcntl.h>
#include <unistd.h>

#include <utility>

#include "base/check.h"
#include "base/compiler_specific.h"
#include "base/logging.h"
#include "base/notreached.h"
#include "base/posix/eintr_wrapper.h"
#include "base/posix/safe_strerror.h"
#include "base/strings/stringprintf.h"
#include "base/task/current_thread.h"

namespace ui {

LibInputSeat::LibInputSeat()
    : context_(libinput_path_create_context(&interface_, this)),
      watch_(FROM_HERE) {
  CHECK(context_) << "libinput_path_create_context failed";
  libinput_log_set_handler(context_, LogHandler);
  libinput_log_set_priority(context_, LIBINPUT_LOG_PRIORITY_DEBUG);
}

LibInputSeat::~LibInputSeat() {
  CHECK(paths_.empty());
  watch_.StopWatchingFileDescriptor();
  libinput_unref(context_.ExtractAsDangling());
}

base::expected<libinput_device*, std::string> LibInputSeat::AddDevice(
    const base::ScopedFD& fd,
    const base::FilePath& path) {
  CHECK(fd.is_valid());
  base::ScopedFD authorized(HANDLE_EINTR(fcntl(fd.get(), F_DUPFD_CLOEXEC, 0)));
  if (!authorized.is_valid()) {
    return base::unexpected("cannot retain authorized descriptor: " +
                            base::safe_strerror(errno));
  }
  CHECK(authorized_fds_.try_emplace(path, std::move(authorized)).second);
  auto* device = libinput_path_add_device(context_, path.value().c_str());
  if (!device) {
    authorized_fds_.erase(path);
    return base::unexpected("libinput_path_add_device rejected the device");
  }
  libinput_device_ref(device);
  CHECK(paths_.try_emplace(device, path).second);
  if (!watching_) {
    CHECK(base::CurrentUIThread::Get()->WatchFileDescriptor(
        libinput_get_fd(context_), true, base::MessagePumpForUI::WATCH_READ,
        &watch_, this));
    watching_ = true;
  }
  return device;
}

void LibInputSeat::SetEventHandler(libinput_device* device,
                                   EventHandler handler) {
  CHECK(paths_.contains(device));
  if (handler) {
    handlers_.insert_or_assign(device, std::move(handler));
  } else {
    handlers_.erase(device);
  }
}

void LibInputSeat::RemoveDevice(libinput_device* device) {
  auto entry = paths_.find(device);
  CHECK(entry != paths_.end());
  handlers_.erase(device);
  libinput_path_remove_device(device);
  OnFileCanReadWithoutBlocking(libinput_get_fd(context_));
  libinput_device_unref(device);
  authorized_fds_.erase(entry->second);
  paths_.erase(entry);
}

int LibInputSeat::OpenRestricted(const char* path, int flags, void* data) {
  auto& seat = *static_cast<LibInputSeat*>(data);
  auto authorized = seat.authorized_fds_.find(base::FilePath(path));
  CHECK(authorized != seat.authorized_fds_.end()) << path;
  const int fd =
      HANDLE_EINTR(fcntl(authorized->second.get(), F_DUPFD_CLOEXEC, 0));
  if (fd < 0) {
    const int error = errno;
    PLOG(ERROR) << "Cannot duplicate authorized input descriptor: " << path;
    return -error;
  }
  return fd;
}

void LibInputSeat::CloseRestricted(int fd, void* data) {
  close(fd);
}

void LibInputSeat::LogHandler(libinput* context,
                              libinput_log_priority priority,
                              const char* format,
                              va_list arguments) {
  // libinput owns the printf format and the matching argument list.
  const auto message = UNSAFE_BUFFERS(base::StringPrintV(format, arguments));
  switch (priority) {
    case LIBINPUT_LOG_PRIORITY_DEBUG:
      VLOG(4) << "libinput: " << message;
      break;
    case LIBINPUT_LOG_PRIORITY_INFO:
      VLOG(1) << "libinput: " << message;
      break;
    case LIBINPUT_LOG_PRIORITY_ERROR:
      LOG(ERROR) << "libinput: " << message;
      break;
  }
}

void LibInputSeat::OnFileCanReadWithoutBlocking(int fd) {
  CHECK_EQ(libinput_dispatch(context_), 0);
  while (auto* event = libinput_get_event(context_)) {
    auto handler = handlers_.find(libinput_event_get_device(event));
    // Device-added/removed events and events queued before attach have no
    // converter subscription.
    if (handler != handlers_.end()) {
      handler->second.Run(event);
    }
    libinput_event_destroy(event);
  }
}

void LibInputSeat::OnFileCanWriteWithoutBlocking(int fd) {
  NOTREACHED();
}

}  // namespace ui
