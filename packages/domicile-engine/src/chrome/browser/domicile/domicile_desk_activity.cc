// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk_activity.h"

#include "base/no_destructor.h"
#include "components/domicile/browser/desk_activity.h"
#include "content/public/browser/browser_thread.h"
#include "ui/base/user_activity/user_activity_detector.h"
#include "ui/base/user_activity/user_activity_observer.h"

namespace domicile {
namespace {

class DeskActivityReporter : public ui::UserActivityObserver {
 public:
  DeskActivityReporter() { ui::UserActivityDetector::Get()->AddObserver(this); }

  // ui::UserActivityObserver:
  void OnUserActivity(const ui::Event* event) override {
    DeskActivity::Get().Heard();
  }
};

}  // namespace

void StartDeskActivity() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the life of the browser.
  static base::NoDestructor<DeskActivityReporter> reporter;
}

}  // namespace domicile
