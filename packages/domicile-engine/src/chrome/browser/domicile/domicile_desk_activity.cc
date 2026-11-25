// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_activity.h"

#include <string_view>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/time/default_tick_clock.h"
#include "components/domicile/browser/desk_activity.h"
#include "components/domicile/browser/desk_activity_reporter.h"
#include "content/public/browser/browser_thread.h"
#include "ui/base/user_activity/user_activity_detector.h"
#include "ui/events/devices/device_data_manager.h"
#include "ui/events/devices/input_device.h"
#include "ui/events/event.h"
#include "ui/events/platform/platform_event_source.h"

namespace domicile {
namespace {

// The name of the device `id` names, or empty for one not listed, like a
// synthesized event's.
std::string_view DeviceNamed(int id) {
  const ui::DeviceDataManager* devices = ui::DeviceDataManager::GetInstance();
  // Each list holds its own subclass of ui::InputDevice.
  const auto in = [id](const auto& listed) -> const ui::InputDevice* {
    for (const ui::InputDevice& device : listed) {
      if (device.id == id) {
        return &device;
      }
    }
    return nullptr;
  };
  for (const ui::InputDevice* device :
       {in(devices->GetKeyboardDevices()), in(devices->GetMouseDevices()),
        in(devices->GetTouchpadDevices()),
        in(devices->GetTouchscreenDevices())}) {
    if (device != nullptr) {
      return device->name;
    }
  }
  return {};
}

void Report(const ui::Event* event, ActivityKind kind) {
  DeskActivity::Get().Heard(
      event == nullptr ? "activity"
                       : DescribeInput(event->GetName(),
                                       DeviceNamed(event->source_device_id())),
      kind);
}

}  // namespace

void StartDeskActivity() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the life of the browser.
  static base::NoDestructor<DeskActivityReporter> reporter(
      ui::UserActivityDetector::Get(), ui::PlatformEventSource::GetInstance(),
      base::DefaultTickClock::GetInstance(), base::BindRepeating(&Report));
}

}  // namespace domicile
