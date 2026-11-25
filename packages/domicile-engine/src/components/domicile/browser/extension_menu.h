// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_EXTENSION_MENU_H_
#define COMPONENTS_DOMICILE_BROWSER_EXTENSION_MENU_H_

#include <string>
#include <vector>

namespace domicile {

// Formats extensions' menus and commands as JSON for the shell page. Reading
// them is //chrome/browser/domicile/domicile_extension_menus.cc; these live
// here so tests need no profile.

// One entry of a menu. The same entries as an Electron app's menu, so a shell
// reads both with the SDK's `appMenu`.
struct ExtensionMenuEntry {
  enum class Type { kNormal, kSeparator, kSubmenu, kCheckbox, kRadio };

  ExtensionMenuEntry();
  ExtensionMenuEntry(const ExtensionMenuEntry&);
  ExtensionMenuEntry(ExtensionMenuEntry&&);
  ExtensionMenuEntry& operator=(const ExtensionMenuEntry&);
  ExtensionMenuEntry& operator=(ExtensionMenuEntry&&);
  ~ExtensionMenuEntry();

  // From 1, unique in its menu. What the shell runs it by.
  int id = 0;
  Type type = Type::kNormal;
  // With `&` mnemonics, as Chrome's menus have: `&&` is an ampersand.
  std::string label;
  bool enabled = true;
  bool visible = true;
  bool checked = false;
  // A PNG data: URL, or empty for none.
  std::string icon;
  std::vector<ExtensionMenuEntry> submenu;
};

// `entries` as a JSON array.
std::string ExtensionMenuAsJson(const std::vector<ExtensionMenuEntry>& entries);

// One of an extension's chrome.commands.
struct ExtensionCommand {
  std::string name;
  std::string description;
  // The keys bound to it, as `Ctrl+Shift+L`, or empty for none.
  std::string keys;
  // Bound everywhere, not only in browser windows.
  bool global = false;
};

// One extension's commands.
struct ExtensionCommands {
  ExtensionCommands();
  ExtensionCommands(const ExtensionCommands&);
  ExtensionCommands(ExtensionCommands&&);
  ExtensionCommands& operator=(const ExtensionCommands&);
  ExtensionCommands& operator=(ExtensionCommands&&);
  ~ExtensionCommands();

  std::string id;
  std::string name;
  // The browser profile the extension is in.
  std::string profile;
  std::vector<ExtensionCommand> commands;
};

// `extensions` as a JSON array.
std::string ExtensionCommandsAsJson(
    const std::vector<ExtensionCommands>& extensions);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_EXTENSION_MENU_H_
