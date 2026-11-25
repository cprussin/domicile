// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/extension_menu.h"

#include <optional>
#include <vector>

#include "base/json/json_reader.h"
#include "base/test/values_test_util.h"
#include "base/values.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Type = ExtensionMenuEntry::Type;

TEST(ExtensionMenuTest, NoEntriesAreAnEmptyArray) {
  EXPECT_EQ(ExtensionMenuAsJson({}), "[]");
}

TEST(ExtensionMenuTest, AnEntryCarriesItsStateAndOnlyASubmenuHasEntries) {
  ExtensionMenuEntry fill;
  fill.id = 2;
  fill.label = "Fill";
  fill.enabled = false;
  ExtensionMenuEntry remember;
  remember.id = 3;
  remember.type = Type::kCheckbox;
  remember.label = "Remember";
  remember.checked = true;
  ExtensionMenuEntry top;
  top.id = 1;
  top.type = Type::kSubmenu;
  top.label = "Vault";
  top.icon = "data:image/png;base64,AA==";
  top.submenu = {fill, remember};

  EXPECT_EQ(base::test::ParseJson(ExtensionMenuAsJson({top})),
            base::test::ParseJson(R"([{
              "id": 1, "type": "submenu", "label": "Vault", "enabled": true,
              "visible": true, "checked": false,
              "icon": "data:image/png;base64,AA==",
              "submenu": [
                {"id": 2, "type": "normal", "label": "Fill", "enabled": false,
                 "visible": true, "checked": false},
                {"id": 3, "type": "checkbox", "label": "Remember",
                 "enabled": true, "visible": true, "checked": true}
              ]
            }])"));
}

TEST(ExtensionMenuTest, ACommandWithNoKeysSaysNone) {
  ExtensionCommands vault;
  vault.id = "abcdefghijklmnopabcdefghijklmnop";
  vault.name = "Vault";
  vault.profile = "default";
  vault.commands = {{"fill", "Fill in", "Ctrl+Shift+L", false},
                    {"lock", "Lock", "", false}};

  EXPECT_EQ(base::test::ParseJson(ExtensionCommandsAsJson({vault})),
            base::test::ParseJson(R"([{
              "id": "abcdefghijklmnopabcdefghijklmnop", "name": "Vault",
              "profile": "default",
              "commands": [
                {"name": "fill", "description": "Fill in",
                 "keys": "Ctrl+Shift+L", "global": false},
                {"name": "lock", "description": "Lock", "keys": "",
                 "global": false}
              ]
            }])"));
}

}  // namespace
}  // namespace domicile
