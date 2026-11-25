// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_extension_menus.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/ref_counted_memory.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/domicile/domicile_extension_tray.h"
#include "chrome/browser/extensions/commands/command_service.h"
#include "chrome/browser/extensions/context_menu_helpers.h"
#include "chrome/browser/extensions/context_menu_matcher.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "components/domicile/browser/extension_tray_entry.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/context_menu_params.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/event_router.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_event_histogram_value.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_util.h"
#include "extensions/browser/permissions/active_tab_permission_granter.h"
#include "extensions/browser/ui_util.h"
#include "extensions/common/api/commands/commands_handler.h"
#include "extensions/common/api/extension_action/action_info.h"
#include "extensions/common/command.h"
#include "extensions/common/event_args.h"
#include "extensions/common/extension.h"
#include "extensions/common/mojom/context_type.mojom.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/accelerators/command.h"
#include "ui/base/models/image_model.h"
#include "ui/base/models/menu_model.h"
#include "ui/content_accelerators/accelerator_util.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/image/image.h"
#include "ui/menus/simple_menu_model.h"

namespace domicile {
namespace {

using extensions::ActionInfo;
using extensions::Command;
using extensions::CommandService;
using extensions::ContextMenuMatcher;
using extensions::Extension;
using extensions::MenuItem;

// Runs Chrome's matcher and reads the menu it makes.
class MenuReader final : public ui::SimpleMenuModel::Delegate {
 public:
  MenuReader(content::BrowserContext& context,
             base::RepeatingCallback<bool(const MenuItem*)> filter)
      : model_(this), matcher_(&context, this, &model_, std::move(filter)) {}

  MenuReader(const MenuReader&) = delete;
  MenuReader& operator=(const MenuReader&) = delete;

  ContextMenuMatcher& matcher() { return matcher_; }

  ExtensionMenu Read(int first_id) {
    ExtensionMenu menu;
    next_id_ = first_id;
    menu.json = ExtensionMenuAsJson(EntriesOf(model_, menu.items));
    return menu;
  }

  // ui::SimpleMenuModel::Delegate:
  bool IsCommandIdChecked(int command_id) const override {
    return matcher_.IsCommandIdChecked(command_id);
  }
  bool IsCommandIdEnabled(int command_id) const override {
    return matcher_.IsCommandIdEnabled(command_id);
  }
  bool IsCommandIdVisible(int command_id) const override {
    return matcher_.IsCommandIdVisible(command_id);
  }
  // The shell runs an entry by its id. See RunItem.
  void ExecuteCommand(int command_id, int event_flags) override {}

 private:
  std::vector<ExtensionMenuEntry> EntriesOf(
      const ui::MenuModel& model,
      std::map<int, MenuItem::Id>& items) {
    const std::map<int, MenuItem::Id> matched = matcher_.extension_item_map();
    std::vector<ExtensionMenuEntry> entries;
    for (size_t i = 0; i < model.GetItemCount(); ++i) {
      ExtensionMenuEntry entry;
      entry.id = next_id_++;
      entry.visible = model.IsVisibleAt(i);
      const ui::MenuModel::ItemType type = model.GetTypeAt(i);
      if (type == ui::MenuModel::TYPE_SEPARATOR) {
        entry.type = ExtensionMenuEntry::Type::kSeparator;
        entries.push_back(std::move(entry));
        continue;
      }
      entry.label = base::UTF16ToUTF8(model.GetLabelAt(i));
      entry.enabled = model.IsEnabledAt(i);
      entry.checked = model.IsItemCheckedAt(i);
      const ui::ImageModel icon = model.GetIconAt(i);
      if (icon.IsImage() && !icon.GetImage().IsEmpty()) {
        const scoped_refptr<base::RefCountedMemory> png =
            icon.GetImage().As1xPNGBytes();
        entry.icon = PngAsDataUrl(base::span(*png));
      }
      if (const ui::MenuModel* submenu = model.GetSubmenuModelAt(i)) {
        entry.type = ExtensionMenuEntry::Type::kSubmenu;
        entry.submenu = EntriesOf(*submenu, items);
      } else if (type == ui::MenuModel::TYPE_CHECK) {
        entry.type = ExtensionMenuEntry::Type::kCheckbox;
      } else if (type == ui::MenuModel::TYPE_RADIO) {
        entry.type = ExtensionMenuEntry::Type::kRadio;
      }
      const auto found = matched.find(model.GetCommandIdAt(i));
      if (found != matched.end() &&
          entry.type != ExtensionMenuEntry::Type::kSubmenu) {
        items.emplace(entry.id, found->second);
      }
      entries.push_back(std::move(entry));
    }
    return entries;
  }

  ui::SimpleMenuModel model_;
  ContextMenuMatcher matcher_;
  int next_id_ = 1;
};

// Whether `item` is in the menu of an action of type `type`, as
// ExtensionContextMenuModel decides it.
bool MatchesAction(ActionInfo::Type type, const MenuItem* item) {
  const MenuItem::ContextList& contexts = item->contexts();
  return contexts.Contains(MenuItem::ALL) ||
         (type == ActionInfo::Type::kPage &&
          contexts.Contains(MenuItem::PAGE_ACTION)) ||
         (type == ActionInfo::Type::kBrowser &&
          contexts.Contains(MenuItem::BROWSER_ACTION)) ||
         (type == ActionInfo::Type::kAction &&
          contexts.Contains(MenuItem::ACTION));
}

// Runs `id` as a click on it, unless it went or was disabled after its menu
// was drawn.
void RunItem(content::BrowserContext& context,
             const MenuItem::Id& id,
             content::WebContents* tab,
             content::RenderFrameHost* frame,
             const content::ContextMenuParams& params) {
  extensions::MenuManager* manager = extensions::MenuManager::Get(&context);
  MenuItem* item = manager->GetItemById(id);
  if (item == nullptr || !item->enabled()) {
    LOG(INFO) << "domicile: an extension's menu item is gone or disabled; "
                 "dropping the click.";
    return;
  }
  LOG(INFO) << "domicile: the shell ran a menu item of "
            << item->extension_id() << ".";
  manager->ExecuteCommand(&context, tab, frame, params, id);
}

// The extension items of one page's context menu.
class PageMenu final : public GuestExtensionMenu {
 public:
  PageMenu(ExtensionMenu menu, const content::ContextMenuParams& params)
      : menu_(std::move(menu)), params_(params) {}

  // GuestExtensionMenu:
  const std::string& json() const override { return menu_.json; }
  void Run(int item,
           content::WebContents& page,
           content::RenderFrameHost& frame) override {
    const auto found = menu_.items.find(item);
    if (found == menu_.items.end()) {
      LOG(WARNING) << "domicile: the shell ran extension item " << item
                   << ", which its page's menu does not have.";
      return;
    }
    RunItem(*page.GetBrowserContext(), found->second, &page, &frame, params_);
  }

 private:
  ExtensionMenu menu_;
  content::ContextMenuParams params_;
};

// Runs command `name` of `id` in `page`, unless the shell does or the page is
// gone.
void RunUnlessHandled(content::WeakDocumentPtr page,
                      const extensions::ExtensionId& id,
                      const std::string& name,
                      bool handled) {
  content::RenderFrameHost* frame = page.AsRenderFrameHostIfValid();
  if (!handled && frame != nullptr && frame->IsActive()) {
    RunCommandIn(*content::WebContents::FromRenderFrameHost(frame), id, name);
  }
}

void AskThenRun(content::WeakDocumentPtr page,
                const extensions::ExtensionId& id,
                const std::string& name) {
  if (content::RenderFrameHost* frame = page.AsRenderFrameHostIfValid()) {
    AskShellToRunCommand(frame->GetBrowserContext(), id, name,
                         base::BindOnce(&RunUnlessHandled, page, id, name));
  }
}

// What runs the command whose keys `event` in `page` presses, in the page's
// own profile. Null for none.
base::OnceClosure CommandPressed(content::WebContents& page,
                                 const input::NativeWebKeyboardEvent& event) {
  // Only a tab's, as PageMenuOf's items.
  if (sessions::SessionTabHelper::FromWebContents(&page) == nullptr) {
    return base::OnceClosure();
  }
  const ui::Accelerator pressed =
      ui::GetAcceleratorFromNativeWebKeyboardEvent(event);
  content::BrowserContext& context = *page.GetBrowserContext();
  CommandService* service = CommandService::Get(&context);
  for (const ExtensionCommands& extension :
       CommandsIn(context, std::string())) {
    for (const ExtensionCommand& command : extension.commands) {
      // As ExtensionKeybindingRegistry: a key nothing listens for is the page's.
      // Global commands are not keys of a page.
      if (!command.keys.empty() && !command.global &&
          (Command::IsActionRelatedCommand(command.name) ||
           extensions::EventRouter::Get(&context)->ExtensionHasEventListener(
               extension.id, "commands.onCommand")) &&
          service->FindCommandByName(extension.id, command.name)
                  .accelerator() == pressed) {
        return base::BindOnce(
            &AskThenRun, page.GetPrimaryMainFrame()->GetWeakDocumentPtr(),
            extension.id, command.name);
      }
    }
  }
  return base::OnceClosure();
}

std::unique_ptr<GuestExtensionMenu> PageMenuOf(
    content::WebContents& page,
    const content::ContextMenuParams& params) {
  // Only a tab's: an item runs on a tab, and an extension's popup is in none.
  if (sessions::SessionTabHelper::FromWebContents(&page) == nullptr) {
    return std::make_unique<PageMenu>(ExtensionMenu(), params);
  }
  MenuReader reader(
      *page.GetBrowserContext(),
      base::BindRepeating(
          extensions::context_menu_helpers::MenuItemMatchesParams, params));
  extensions::context_menu_helpers::PopulateExtensionItems(
      page.GetBrowserContext(), params, reader.matcher());
  return std::make_unique<PageMenu>(reader.Read(/*first_id=*/1), params);
}

ExtensionCommand CommandAsEntry(content::BrowserContext& context,
                                CommandService& service,
                                const Extension& extension,
                                const ui::Command& command) {
  // The keys bound now. A command's own are only what its manifest suggests,
  // which another extension may hold, or the shell.
  const Command bound =
      service.FindCommandByName(extension.id(), command.command_name());
  return ExtensionCommand{
      .name = command.command_name(),
      .description = base::UTF16ToUTF8(command.description()),
      .keys = bound.accelerator().key_code() == ui::VKEY_UNKNOWN ||
                      IsReservedByShell(&context, bound.accelerator())
                  ? std::string()
                  : ui::Command::AcceleratorToString(bound.accelerator()),
      .global = bound.global(),
  };
}

// As DispatchCommandEvent in
// chrome/browser/extensions/extension_keybinding_registry.cc, which is
// private to it.
void DispatchCommand(content::BrowserContext& context,
                     const extensions::ExtensionId& id,
                     const std::string& command,
                     content::WebContents* tab) {
  const Extension* extension = extensions::ExtensionRegistry::Get(&context)
                                   ->enabled_extensions()
                                   .GetByID(id);
  if (extension == nullptr ||
      (context.IsOffTheRecord() &&
       !extensions::util::IsIncognitoEnabled(extension, &context))) {
    return;
  }
  auto args = base::MakeRefCounted<extensions::EventArgs>();
  args->data.Append(command);
  base::Value tab_value;
  if (tab != nullptr) {
    tab_value = base::Value(
        extensions::ExtensionTabUtil::CreateTabObject(
            tab,
            extensions::ExtensionTabUtil::GetScrubTabBehavior(
                extension,
                extensions::mojom::ContextType::kPrivilegedExtension, tab),
            extension)
            .ToValue());
  }
  args->data.Append(std::move(tab_value));
  auto event = std::make_unique<extensions::Event>(
      extensions::events::COMMANDS_ON_COMMAND, "commands.onCommand",
      std::move(args), &context);
  event->user_gesture = extensions::EventRouter::UserGestureState::kEnabled;
  // The extension command guard greps for this line.
  LOG(INFO) << "domicile: ran command " << command << " of " << id
            << ".";
  extensions::EventRouter::Get(&context)->DispatchEventToExtension(
      id, std::move(event));
}

}  // namespace

ExtensionMenu::ExtensionMenu() = default;
ExtensionMenu::ExtensionMenu(ExtensionMenu&&) = default;
ExtensionMenu& ExtensionMenu::operator=(ExtensionMenu&&) = default;
ExtensionMenu::~ExtensionMenu() = default;

ExtensionMenu ActionMenuOf(content::BrowserContext& context,
                           const Extension& extension,
                           int first_id) {
  const extensions::ExtensionAction* action =
      extensions::ExtensionActionManager::Get(&context)->GetExtensionAction(
          extension);
  if (action == nullptr) {
    return ExtensionMenu();
  }
  MenuReader reader(context,
                    base::BindRepeating(&MatchesAction, action->action_type()));
  int index = 0;
  reader.matcher().AppendExtensionItems(
      MenuItem::ExtensionKey(extension.id()), std::u16string(), &index,
      /*is_action_menu=*/true);
  return reader.Read(first_id);
}

void RunActionMenuItem(content::BrowserContext& context,
                       const MenuItem::Id& item,
                       content::WebContents* tab) {
  // Chrome's action menu is over no frame and no click either.
  RunItem(context, item, tab, /*frame=*/nullptr, content::ContextMenuParams());
}

ExtensionCommands CommandsOf(content::BrowserContext& context,
                             const Extension& extension,
                             const std::string& profile) {
  CommandService* service = CommandService::Get(&context);
  ExtensionCommands commands;
  commands.id = extension.id();
  commands.name = extension.name();
  commands.profile = profile;
  for (const Command* action :
       {extensions::CommandsInfo::GetActionCommand(&extension),
        extensions::CommandsInfo::GetBrowserActionCommand(&extension),
        extensions::CommandsInfo::GetPageActionCommand(&extension)}) {
    if (action != nullptr) {
      commands.commands.push_back(CommandAsEntry(context, *service, extension, *action));
    }
  }
  if (const ui::CommandMap* named =
          extensions::CommandsInfo::GetNamedCommands(&extension)) {
    for (const auto& [name, command] : *named) {
      commands.commands.push_back(CommandAsEntry(context, *service, extension, command));
    }
  }
  return commands;
}

std::vector<ExtensionCommands> CommandsIn(content::BrowserContext& context,
                                          const std::string& profile) {
  std::vector<ExtensionCommands> all;
  for (const scoped_refptr<const Extension>& extension :
       extensions::ExtensionRegistry::Get(&context)->enabled_extensions()) {
    if (!extensions::ui_util::ShouldDisplayInExtensionSettings(*extension) ||
        (context.IsOffTheRecord() &&
         !extensions::util::IsIncognitoEnabled(extension.get(), &context))) {
      continue;
    }
    ExtensionCommands commands = CommandsOf(context, *extension, profile);
    if (!commands.commands.empty()) {
      all.push_back(std::move(commands));
    }
  }
  return all;
}

void SendCommand(content::BrowserContext& context,
                 const Extension& extension,
                 const std::string& command,
                 content::WebContents* tab) {
  extensions::ActiveTabPermissionGranter* granter =
      tab == nullptr
          ? nullptr
          : extensions::ActiveTabPermissionGranter::FromWebContents(tab);
  if (granter == nullptr) {
    DispatchCommand(context, extension.id(), command, tab);
    return;
  }
  // Once the grant reaches the network service, so the listener can use it.
  granter->GrantIfRequested(
      &extension,
      base::BindOnce(
          [](base::WeakPtr<content::WebContents> tab,
             const extensions::ExtensionId& id, const std::string& command) {
            if (tab) {
              DispatchCommand(*tab->GetBrowserContext(), id, command,
                              tab.get());
            }
          },
          tab->GetWeakPtr(), extension.id(), command));
}

void RunCommandIn(content::WebContents& page,
                  const extensions::ExtensionId& id,
                  const std::string& name) {
  content::BrowserContext& context = *page.GetBrowserContext();
  const Extension* extension = extensions::ExtensionRegistry::Get(&context)
                                   ->enabled_extensions()
                                   .GetByID(id);
  if (extension == nullptr) {
    return;
  }
  if (!Command::IsActionRelatedCommand(name)) {
    SendCommand(context, *extension, name, &page);
    return;
  }
  const extensions::ExtensionAction* action =
      extensions::ExtensionActionManager::Get(&context)->GetExtensionAction(
          *extension);
  extensions::ExtensionActionRunner* runner =
      extensions::ExtensionActionRunner::GetForWebContents(&page);
  const int tab = sessions::SessionTabHelper::IdForTab(&page).id();
  // A disabled action does nothing, as in Chrome.
  if (action == nullptr || runner == nullptr || !action->GetIsVisible(tab)) {
    return;
  }
  LOG(INFO) << "domicile: ran the action of " << id << ".";
  if (runner->RunAction(extension, /*grant_tab_permissions=*/true) ==
      extensions::ExtensionAction::ShowAction::kShowPopup) {
    RequestExtensionPopup(&context, id, action->GetPopupUrl(tab));
  }
}

void UseChromeForGuestExtensionMenus() {
  WebViewGuest::SetExtensionMenus(base::BindRepeating(&PageMenuOf));
  WebViewGuest::SetExtensionKeys(base::BindRepeating(&CommandPressed));
}

}  // namespace domicile
