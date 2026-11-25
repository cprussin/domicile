// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_MENUS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_MENUS_H_

#include <map>
#include <string>
#include <vector>

#include "chrome/browser/extensions/menu_manager.h"
#include "components/domicile/browser/extension_menu.h"
#include "extensions/common/extension_id.h"

namespace content {
class BrowserContext;
class WebContents;
}  // namespace content

namespace extensions {
class Extension;
}  // namespace extensions

// Extensions' chrome.contextMenus items and chrome.commands, for the shell to
// draw and run. Chrome's own matcher picks the items, so a menu holds what
// Chrome's would.
//
// The caller passes the active tab, and a private one only for an extension
// allowed there. See docs/architecture/EXTENSIONS.md in the Domicile
// repository.

namespace domicile {

// A menu as the shell draws it, and what each entry's id runs.
struct ExtensionMenu {
  ExtensionMenu();
  ExtensionMenu(ExtensionMenu&&);
  ExtensionMenu& operator=(ExtensionMenu&&);
  ~ExtensionMenu();

  // See ExtensionMenuAsJson.
  std::string json = "[]";
  std::map<int, extensions::MenuItem::Id> items;
};

// `extension`'s items for its action's menu, as ExtensionContextMenuModel
// lists them. `context` is the active tab's profile. Ids go up from
// `first_id`, so the caller tells two menus' ids apart.
ExtensionMenu ActionMenuOf(content::BrowserContext& context,
                           const extensions::Extension& extension,
                           int first_id);

// Runs `item` of an action's menu on `tab`, null for none: grants activeTab,
// then sends contextMenus.onClicked. An item gone or disabled since the menu
// was drawn is dropped.
void RunActionMenuItem(content::BrowserContext& context,
                       const extensions::MenuItem::Id& item,
                       content::WebContents* tab);

// `extension`'s commands with the keys now bound to them, the action's own
// (`_execute_action`) included.
ExtensionCommands CommandsOf(content::BrowserContext& context,
                             const extensions::Extension& extension,
                             const std::string& profile);

// CommandsOf every extension with commands whose keys work in `context`'s
// pages: those Chrome lists to the user, and in a private profile those
// allowed there.
std::vector<ExtensionCommands> CommandsIn(content::BrowserContext& context,
                                          const std::string& profile);

// Sends commands.onCommand for `command` on `tab`, null for none, after
// granting activeTab on it, as ExtensionKeybindingRegistry::CommandExecuted
// does for a key.
void SendCommand(content::BrowserContext& context,
                 const extensions::Extension& extension,
                 const std::string& command,
                 content::WebContents* tab);

// Runs command `name` of extension `id` on `page`'s tab, as its keys do in
// Chrome. The action's own command clicks the action, or asks the shell for its
// popup.
void RunCommandIn(content::WebContents& page,
                  const extensions::ExtensionId& id,
                  const std::string& name);

// Has guests ask here for the extension items of their context menus and for
// the commands their keys run.
void UseChromeForGuestExtensionMenus();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_MENUS_H_
