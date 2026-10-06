// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_sleep.h"

#include <memory>

#include "dbus/message.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// Builds logind's signal: one boolean in the body, not a variant.
std::unique_ptr<dbus::Signal> PrepareForSleep(bool start) {
  std::unique_ptr<dbus::Signal> signal = std::make_unique<dbus::Signal>(
      "org.freedesktop.login1.Manager", "PrepareForSleep");
  dbus::MessageWriter writer(signal.get());
  writer.AppendBool(start);
  return signal;
}

// `false` means the machine is back, even if the sleep failed, so the
// hardware may have been reset.
TEST(DrmSleepTest, TheWakeIsTheEdgeThatLightsTheScreensAgain) {
  const std::unique_ptr<dbus::Signal> woke = PrepareForSleep(false);

  EXPECT_TRUE(SleepEnded(woke.get()));
}

// Relighting on the way down would waste a modeset on panels about to go
// dark.
TEST(DrmSleepTest, GoingToSleepLightsNothing) {
  const std::unique_ptr<dbus::Signal> going = PrepareForSleep(true);

  EXPECT_FALSE(SleepEnded(going.get()));
}

}  // namespace
}  // namespace ui
