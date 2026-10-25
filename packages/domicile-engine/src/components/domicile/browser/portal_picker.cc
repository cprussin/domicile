// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/portal_picker.h"

#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "components/dbus/thread_linux/dbus_thread_linux.h"
#include "content/public/browser/desktop_capture.h"
#include "dbus/bus.h"
#include "dbus/message.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"
#include "third_party/webrtc/modules/desktop_capture/desktop_capture_options.h"
#include "third_party/webrtc/modules/desktop_capture/desktop_capture_types.h"
#include "third_party/webrtc/modules/desktop_capture/linux/wayland/base_capturer_pipewire.h"

namespace domicile {

namespace {

// The compositor's portal backend, where it also serves
// `org.domicile.ScreenCast`.
constexpr char kBackend[] = "org.freedesktop.impl.portal.desktop.domicile";
constexpr char kBackendPath[] = "/org/freedesktop/portal/desktop";
constexpr char kInterface[] = "org.domicile.ScreenCast";
constexpr char kPick[] = "Pick";

// The page waits on it, so a desktop that does not answer is given up on
// soon.
constexpr int kTimeoutMs = 2000;

// webrtc's capturer keeps the node to itself: its GetSessionDetails is empty
// for the ScreenCast portal. The portal tells the capturer through this
// override.
class PipeWirePicker final : public webrtc::BaseCapturerPipeWire,
                             public PortalPicker {
 public:
  explicit PipeWirePicker(const webrtc::DesktopCaptureOptions& options)
      : webrtc::BaseCapturerPipeWire(options,
                                     webrtc::CaptureType::kAnyScreenContent) {}

  webrtc::DesktopCapturer& capturer() override { return *this; }
  uint32_t node() const override { return node_; }

  void OnScreenCastRequestResult(webrtc::xdg_portal::RequestResponse result,
                                 uint32_t stream_node_id,
                                 int fd) override {
    node_ = stream_node_id;
    webrtc::BaseCapturerPipeWire::OnScreenCastRequestResult(result,
                                                            stream_node_id, fd);
  }

 private:
  uint32_t node_ = 0;
};

}  // namespace

std::unique_ptr<PortalPicker> MakePortalPicker() {
  webrtc::DesktopCaptureOptions options =
      content::desktop_capture::CreateDesktopCaptureOptions();
  // As content::desktop_capture::CreateScreenCapturer, whose capture restores
  // the pick.
  options.set_prefer_cursor_embedded(true);
  return std::make_unique<PipeWirePicker>(options);
}

void AskWhatThePortalPicked(uint32_t node, ToldWhatThePortalPicked told) {
  dbus::ObjectProxy* const backend =
      dbus_thread_linux::GetSharedSessionBus()->GetObjectProxy(
          kBackend, dbus::ObjectPath(kBackendPath));
  dbus::MethodCall pick(kInterface, kPick);
  dbus::MessageWriter(&pick).AppendUint32(node);
  backend->CallMethod(
      &pick, kTimeoutMs,
      base::BindOnce(
          [](ToldWhatThePortalPicked told, dbus::Response* response) {
            std::move(told).Run(ReadPortalPick(response));
          },
          std::move(told)));
}

std::optional<PortalPick> ReadPortalPick(dbus::Response* response) {
  if (response == nullptr) {
    return std::nullopt;
  }
  dbus::MessageReader reader(response);
  PortalPick pick;
  if (!reader.PopUint32(&pick.source_type) ||
      !reader.PopString(&pick.browser_window) ||
      !reader.PopString(&pick.sound) || reader.HasMoreData()) {
    return std::nullopt;
  }
  return pick;
}

}  // namespace domicile
