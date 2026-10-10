// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/command_protocol.h"

#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "components/domicile/browser/site_permissions.h"

namespace domicile {
namespace {

// The command names.
constexpr char kLoadShell[] = "load_shell";
constexpr char kOpenUrl[] = "open_url";
constexpr char kListSitePermissionsCommand[] = "site_permissions";
constexpr char kSetSitePermissionCommand[] = "set_site_permission";

std::string Line(base::DictValue reply) {
  std::string line;
  // Replies hold only strings, lists and objects, so a write failure is a
  // bug.
  CHECK(base::JSONWriter::Write(reply, &line));
  line.push_back('\n');
  return line;
}

std::string Done(std::string_view type) {
  base::DictValue reply;
  reply.Set("type", type);
  return Line(std::move(reply));
}

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell);
std::string AnswerOpenUrl(const base::DictValue& request, OpenUrl open_url);
std::string AnswerSitePermissions(ListSitePermissions list_site_permissions);
std::string AnswerSetSitePermission(const base::DictValue& request,
                                    SetSitePermission set_site_permission);

}  // namespace

SitePermissionList::SitePermissionList() = default;
SitePermissionList::SitePermissionList(const SitePermissionList&) = default;
SitePermissionList& SitePermissionList::operator=(const SitePermissionList&) =
    default;
SitePermissionList::~SitePermissionList() = default;

std::string RefusedCommand(std::string_view why) {
  base::DictValue reply;
  reply.Set("type", "refused");
  reply.Set("why", why);
  return Line(std::move(reply));
}

void AnswerCommand(std::string_view line,
                   const CommandActions& actions,
                   CommandReply reply) {
  const std::optional<base::DictValue> request =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!request) {
    std::move(reply).Run(RefusedCommand(
        "a command is one JSON object on one line, and this is not one"));
    return;
  }

  // Check the version before `type`: an unknown version means the rest of the
  // request cannot be trusted either.
  const std::optional<int> version = request->FindInt("version");
  if (version != kCommandVersion) {
    std::move(reply).Run(RefusedCommand(base::StrCat(
        {"this engine speaks version ", base::NumberToString(kCommandVersion),
         " of the command protocol and the request says ",
         version ? base::NumberToString(*version) : std::string("nothing"),
         ". The supervisor and the engine are published separately, so this "
         "is two different releases talking rather than a typo: "
         "packages/domicile-engine/engine-release.nix is which engine this "
         "desktop is running."})));
    return;
  }

  const std::string* type = request->FindString("type");
  if (type == nullptr) {
    std::move(reply).Run(RefusedCommand("a command needs a \"type\""));
    return;
  }
  if (*type == kLoadShell) {
    std::move(reply).Run(AnswerLoadShell(*request, actions.load_shell));
    return;
  }
  if (*type == kOpenUrl) {
    std::move(reply).Run(AnswerOpenUrl(*request, actions.open_url));
    return;
  }
  if (*type == kListSitePermissionsCommand) {
    std::move(reply).Run(AnswerSitePermissions(actions.list_site_permissions));
    return;
  }
  if (*type == kSetSitePermissionCommand) {
    std::move(reply).Run(
        AnswerSetSitePermission(*request, actions.set_site_permission));
    return;
  }
  std::move(reply).Run(RefusedCommand(base::StrCat(
      {"\"", *type, "\" is not a command this engine knows; it takes \"",
       kLoadShell, "\", \"", kOpenUrl, "\", \"", kListSitePermissionsCommand,
       "\" and \"", kSetSitePermissionCommand, "\""})));
}

namespace {

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell) {
  // Requires both `root` and `module`: changing only one would serve a 404 or
  // the wrong shell.
  const std::string* root = request.FindString("root");
  if (root == nullptr || root->empty()) {
    return RefusedCommand(
        "load_shell needs a \"root\": the directory the shell is served out "
        "of");
  }
  const base::FilePath shell_root = base::FilePath::FromUTF8Unsafe(*root);
  if (!shell_root.IsAbsolute()) {
    return RefusedCommand(base::StrCat(
        {"\"", *root,
         "\" is not an absolute path. The root is resolved in the engine's "
         "process, whose working directory the sender does not know -- a "
         "relative one would serve some other directory without saying so."}));
  }

  const std::string* module = request.FindString("module");
  if (module == nullptr || module->empty()) {
    return RefusedCommand(
        "load_shell needs a \"module\": the one JavaScript file a shell is, "
        "as a name under \"root\"");
  }

  // The root and module are not checked here. `domicile load-shell` validates
  // the path first (`shell_path` in domicile-launch), and the shell document
  // shows an error if the module fails to load.
  if (!load_shell(shell_root, *module)) {
    return RefusedCommand(
        "this engine has no shell window to load a shell into");
  }
  return Done("loaded");
}

std::string AnswerOpenUrl(const base::DictValue& request, OpenUrl open_url) {
  const std::string* url = request.FindString("url");
  if (url == nullptr) {
    return RefusedCommand("open_url needs a \"url\": the address to open");
  }
  // Validated here so an invalid URL is refused instead of opening an empty
  // window and reporting success.
  const GURL parsed(*url);
  if (!parsed.is_valid()) {
    return RefusedCommand(
        base::StrCat({"\"", *url, "\" is not a URL this engine can open"}));
  }
  // Optional, so a supervisor older than app windows is still understood.
  const base::Value* app = request.Find("app");
  if (app != nullptr && !app->is_bool()) {
    return RefusedCommand(
        "open_url's \"app\" is true for an app window or false for a "
        "browser window");
  }
  if (!open_url(parsed, app != nullptr && app->GetBool())) {
    return RefusedCommand("this engine has no shell page to open it in");
  }
  return Done("opened");
}

std::string AnswerSitePermissions(ListSitePermissions list_site_permissions) {
  const std::optional<SitePermissionList> list = list_site_permissions();
  if (!list) {
    return RefusedCommand(
        "this engine has no shell, and so no profile whose site permissions "
        "to list");
  }
  base::DictValue defaults;
  for (const auto& [permission, setting] : list->defaults) {
    defaults.Set(PermissionName(permission), SettingName(setting));
  }
  base::ListValue sites;
  for (const StoredSitePermission& site : list->sites) {
    base::DictValue entry;
    entry.Set("origin", site.origin.Serialize());
    entry.Set("permission", PermissionName(site.permission));
    entry.Set("setting", SettingName(site.setting));
    sites.Append(std::move(entry));
  }
  base::DictValue reply;
  reply.Set("type", kListSitePermissionsCommand);
  reply.Set("defaults", std::move(defaults));
  reply.Set("sites", std::move(sites));
  return Line(std::move(reply));
}

std::string AnswerSetSitePermission(const base::DictValue& request,
                                    SetSitePermission set_site_permission) {
  const std::string* origin = request.FindString("origin");
  const std::string* permission_name = request.FindString("permission");
  const std::string* setting_name = request.FindString("setting");
  if (origin == nullptr || permission_name == nullptr ||
      setting_name == nullptr) {
    return RefusedCommand(
        "set_site_permission needs an \"origin\", a \"permission\" and a "
        "\"setting\"");
  }
  const GURL site(*origin);
  if (!site.is_valid() || !HasSitePermissions(site)) {
    return RefusedCommand(base::StrCat(
        {"\"", *origin,
         "\" is not a site: only http, https and extension pages have site "
         "permissions"}));
  }
  const std::optional<mojom::WebViewPermission> permission =
      PermissionNamed(*permission_name);
  if (!permission) {
    return RefusedCommand(
        base::StrCat({"\"", *permission_name,
                      "\" is not a permission a site is asked for"}));
  }
  const std::optional<mojom::WebViewPermissionSetting> setting =
      SettingNamed(*setting_name);
  if (!setting) {
    return RefusedCommand(base::StrCat(
        {"\"", *setting_name,
         "\" is not a setting; a site permission is \"ask\", \"allow\" or "
         "\"block\""}));
  }
  if (!set_site_permission(url::Origin::Create(site), *permission, *setting)) {
    return RefusedCommand(
        "this engine has no shell, and so no profile to store the setting in");
  }
  return Done("set");
}

}  // namespace
}  // namespace domicile
