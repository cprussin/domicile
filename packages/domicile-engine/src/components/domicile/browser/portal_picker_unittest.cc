// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/portal_picker.h"

#include <memory>

#include "dbus/message.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(PortalPickerTest, ThePickIsReadFromTheCompositorsReply) {
  std::unique_ptr<dbus::Response> response = dbus::Response::CreateEmpty();
  dbus::MessageWriter writer(response.get());
  writer.AppendUint32(2);
  writer.AppendString("7");
  writer.AppendString("");

  EXPECT_EQ(ReadPortalPick(response.get()),
            (PortalPick{.source_type = 2, .browser_window = "7", .sound = ""}));
}

TEST(PortalPickerTest, AFailedOrMisshapenReplySaysNothing) {
  EXPECT_EQ(ReadPortalPick(nullptr), std::nullopt);

  std::unique_ptr<dbus::Response> response = dbus::Response::CreateEmpty();
  dbus::MessageWriter writer(response.get());
  writer.AppendUint32(1);
  writer.AppendString("");
  EXPECT_EQ(ReadPortalPick(response.get()), std::nullopt);
}

}  // namespace
}  // namespace domicile
