// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_sleep.h"

#include <memory>

#include "dbus/message.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// What logind broadcasts: one boolean, in the signal's own body rather than in
// the variant a property would arrive in.
std::unique_ptr<dbus::Signal> PrepareForSleep(bool start) {
  std::unique_ptr<dbus::Signal> signal = std::make_unique<dbus::Signal>(
      "org.freedesktop.login1.Manager", "PrepareForSleep");
  dbus::MessageWriter writer(signal.get());
  writer.AppendBool(start);
  return signal;
}

// THE EDGE THE WHOLE FEATURE HANGS ON. `false` is logind saying the machine is
// back, and it is emitted even when the sleep it announced never happened --
// so this is "the hardware may have been reset", which is the only thing a
// display driver can act on.
TEST(DrmSleepTest, TheWakeIsTheEdgeThatLightsTheScreensAgain) {
  const std::unique_ptr<dbus::Signal> woke = PrepareForSleep(false);

  EXPECT_TRUE(SleepEnded(woke.get()));
}

// And the other half, which costs a screen if it is got wrong the other way:
// relighting on the way DOWN asks the GPU for a modeset in the window logind
// is holding open for exactly this kind of work, and the panels are dark a
// moment later regardless.
TEST(DrmSleepTest, GoingToSleepLightsNothing) {
  const std::unique_ptr<dbus::Signal> going = PrepareForSleep(true);

  EXPECT_FALSE(SleepEnded(going.get()));
}

}  // namespace
}  // namespace ui
