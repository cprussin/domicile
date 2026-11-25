// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/extension_menu.h"

#include <utility>

#include "base/check.h"
#include "base/json/json_writer.h"
#include "base/values.h"

namespace domicile {
namespace {

// No default arm, so a type added to the enum fails the build.
const char* TypeName(ExtensionMenuEntry::Type type) {
  switch (type) {
    case ExtensionMenuEntry::Type::kNormal:
      return "normal";
    case ExtensionMenuEntry::Type::kSeparator:
      return "separator";
    case ExtensionMenuEntry::Type::kSubmenu:
      return "submenu";
    case ExtensionMenuEntry::Type::kCheckbox:
      return "checkbox";
    case ExtensionMenuEntry::Type::kRadio:
      return "radio";
  }
}

base::ListValue AsList(const std::vector<ExtensionMenuEntry>& entries) {
  base::ListValue list;
  for (const ExtensionMenuEntry& entry : entries) {
    base::DictValue row;
    row.Set("id", entry.id);
    row.Set("type", TypeName(entry.type));
    row.Set("label", entry.label);
    row.Set("enabled", entry.enabled);
    row.Set("visible", entry.visible);
    row.Set("checked", entry.checked);
    if (!entry.icon.empty()) {
      row.Set("icon", entry.icon);
    }
    if (entry.type == ExtensionMenuEntry::Type::kSubmenu) {
      row.Set("submenu", AsList(entry.submenu));
    }
    list.Append(std::move(row));
  }
  return list;
}

std::string Written(const base::ListValue& list) {
  std::string json;
  CHECK(base::JSONWriter::Write(list, &json));
  return json;
}

}  // namespace

ExtensionMenuEntry::ExtensionMenuEntry() = default;
ExtensionMenuEntry::ExtensionMenuEntry(const ExtensionMenuEntry&) = default;
ExtensionMenuEntry::ExtensionMenuEntry(ExtensionMenuEntry&&) = default;
ExtensionMenuEntry& ExtensionMenuEntry::operator=(const ExtensionMenuEntry&) =
    default;
ExtensionMenuEntry& ExtensionMenuEntry::operator=(ExtensionMenuEntry&&) =
    default;
ExtensionMenuEntry::~ExtensionMenuEntry() = default;

ExtensionCommands::ExtensionCommands() = default;
ExtensionCommands::ExtensionCommands(const ExtensionCommands&) = default;
ExtensionCommands::ExtensionCommands(ExtensionCommands&&) = default;
ExtensionCommands& ExtensionCommands::operator=(const ExtensionCommands&) =
    default;
ExtensionCommands& ExtensionCommands::operator=(ExtensionCommands&&) = default;
ExtensionCommands::~ExtensionCommands() = default;

std::string ExtensionMenuAsJson(
    const std::vector<ExtensionMenuEntry>& entries) {
  return Written(AsList(entries));
}

std::string ExtensionCommandsAsJson(
    const std::vector<ExtensionCommands>& extensions) {
  base::ListValue list;
  for (const ExtensionCommands& extension : extensions) {
    base::ListValue commands;
    for (const ExtensionCommand& command : extension.commands) {
      base::DictValue row;
      row.Set("name", command.name);
      row.Set("description", command.description);
      row.Set("keys", command.keys);
      row.Set("global", command.global);
      commands.Append(std::move(row));
    }
    base::DictValue row;
    row.Set("id", extension.id);
    row.Set("name", extension.name);
    row.Set("profile", extension.profile);
    row.Set("commands", std::move(commands));
    list.Append(std::move(row));
  }
  return Written(list);
}

}  // namespace domicile
