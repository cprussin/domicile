// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_activity.h"

#include <string>
#include <string_view>

#include "base/no_destructor.h"
#include "components/domicile/browser/desk_activity.h"
#include "content/public/browser/browser_thread.h"
#include "ui/base/user_activity/user_activity_detector.h"
#include "ui/base/user_activity/user_activity_observer.h"
#include "ui/events/devices/device_data_manager.h"
#include "ui/events/devices/input_device.h"
#include "ui/events/event.h"

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

class DeskActivityReporter : public ui::UserActivityObserver {
 public:
  DeskActivityReporter() { ui::UserActivityDetector::Get()->AddObserver(this); }

  // ui::UserActivityObserver:
  void OnUserActivity(const ui::Event* event) override {
    // `event` is null for activity reported with no event.
    DeskActivity::Get().Heard(
        event == nullptr ? std::string("activity")
                         : DescribeInput(event->GetName(),
                                         DeviceNamed(event->source_device_id())));
  }
};

}  // namespace

void StartDeskActivity() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the life of the browser.
  static base::NoDestructor<DeskActivityReporter> reporter;
}

}  // namespace domicile
