// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/command_protocol.h"

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/mojom/web_view_guest.mojom-shared.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {
namespace {

using ::testing::HasSubstr;
using mojom::WebViewPermission;
using mojom::WebViewPermissionSetting;

// Records which actions a request triggered.
//
// Most tests assert that a refused request triggered none.
struct Told {
  bool asked = false;
  base::FilePath root;
  std::string module;
  bool opened = false;
  std::string url;
  bool app = false;
  bool set = false;
  std::string origin;
  std::optional<WebViewPermission> permission;
  std::optional<WebViewPermissionSetting> setting;
  base::FilePath unpacked;
  std::string uninstalled;
};

// The id the recording `load_unpacked` gives what it loads, and the one the
// recording `config_extensions` lists.
constexpr char kExtensionId[] = "abcdefghijklmnopabcdefghijklmnop";

// What the recording `list_site_permissions` answers: camera's default is
// ask and notifications' allow, and one site has the camera.
SitePermissionList StoredSettings() {
  SitePermissionList list;
  list.defaults = {{WebViewPermission::kCamera, WebViewPermissionSetting::kAsk},
                   {WebViewPermission::kNotifications,
                    WebViewPermissionSetting::kAllow}};
  list.sites = {{url::Origin::Create(GURL("https://meet.example")),
                 WebViewPermission::kCamera, WebViewPermissionSetting::kAllow}};
  return list;
}

// Answers one line with recording actions. `has_window` false makes every
// action fail, as when the engine has no shell window.
std::string Answer(std::string_view line,
                   Told* told,
                   bool has_window = true) {
  auto load_shell = [told, has_window](const base::FilePath& root,
                                       const std::string& module) {
    told->asked = true;
    told->root = root;
    told->module = module;
    return has_window;
  };
  auto open_url = [told, has_window](const GURL& url, bool app) {
    told->opened = true;
    told->url = url.spec();
    told->app = app;
    return has_window;
  };
  auto list_site_permissions =
      [has_window]() -> std::optional<SitePermissionList> {
    if (!has_window) {
      return std::nullopt;
    }
    return StoredSettings();
  };
  auto set_site_permission = [told, has_window](
                                 const url::Origin& origin,
                                 WebViewPermission permission,
                                 WebViewPermissionSetting setting) {
    told->set = true;
    told->origin = origin.Serialize();
    told->permission = permission;
    told->setting = setting;
    return has_window;
  };
  auto load_unpacked = [told, has_window](const base::FilePath& directory,
                                          UnpackedLoaded loaded) {
    told->unpacked = directory;
    if (!has_window) {
      std::move(loaded).Run(base::unexpected("no shell"));
      return;
    }
    std::move(loaded).Run(base::ok(std::string(kExtensionId)));
  };
  auto uninstall_extension =
      [told, has_window](
          const std::string& id) -> base::expected<void, std::string> {
    told->uninstalled = id;
    if (!has_window) {
      return base::unexpected("no shell");
    }
    return base::ok();
  };
  auto list_config_extensions =
      [has_window]() -> std::optional<std::vector<std::string>> {
    if (!has_window) {
      return std::nullopt;
    }
    return std::vector<std::string>{kExtensionId};
  };
  std::string reply;
  AnswerCommand(line,
                {.load_shell = load_shell,
                 .open_url = open_url,
                 .list_site_permissions = list_site_permissions,
                 .set_site_permission = set_site_permission,
                 .load_unpacked = load_unpacked,
                 .uninstall_extension = uninstall_extension,
                 .list_config_extensions = list_config_extensions},
                base::BindOnce([](std::string* out,
                                  std::string line) { *out = std::move(line); },
                               &reply));
  return reply;
}

// Returns the reply's `type`, or "" if the reply is not a JSON object with
// one.
std::string TypeOf(const std::string& reply) {
  const std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC);
  if (!parsed) {
    return "";
  }
  const std::string* type = parsed->FindString("type");
  return type ? *type : "";
}

// Returns the reply's `why`, or "" as for TypeOf.
std::string WhyOf(const std::string& reply) {
  const std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC);
  if (!parsed) {
    return "";
  }
  const std::string* why = parsed->FindString("why");
  return why ? *why : "";
}

constexpr char kLoadOther[] =
    R"({"type":"load_shell","version":1,)"
    R"("root":"/home/someone/desktop/dist","module":"desktop.js"})";

TEST(CommandProtocolTest, LoadsTheShellARequestNames) {
  Told told;
  const std::string reply = Answer(kLoadOther, &told);

  EXPECT_EQ(TypeOf(reply), "loaded");
  EXPECT_TRUE(told.asked);
  EXPECT_EQ(told.root, base::FilePath("/home/someone/desktop/dist"));
  EXPECT_EQ(told.module, "desktop.js");
  // The reply is one line and includes its newline.
  EXPECT_EQ(reply.find('\n'), reply.size() - 1);
}

TEST(CommandProtocolTest, RefusesALineThatIsNotARequest) {
  Told told;
  EXPECT_EQ(TypeOf(Answer("load_shell /home/someone/desktop", &told)),
            "refused");
  // Valid JSON that is not an object.
  EXPECT_EQ(TypeOf(Answer("[1, 2, 3]", &told)), "refused");
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAVersionItDoesNotSpeak) {
  // The supervisor and engine ship separately, so a version mismatch must be
  // refused with a reason.
  Told told;
  const std::string newer = Answer(
      R"({"type":"load_shell","version":2,"root":"/x","module":"shell.js"})",
      &told);
  EXPECT_EQ(TypeOf(newer), "refused");
  EXPECT_THAT(WhyOf(newer), HasSubstr("version"));

  // A missing version is also a mismatch.
  EXPECT_EQ(
      TypeOf(Answer(R"({"type":"load_shell","root":"/x","module":"s.js"})",
                    &told)),
      "refused");

  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesACommandItDoesNotKnow) {
  Told told;
  const std::string reply =
      Answer(R"({"type":"reload_shell","version":1})", &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  // The reason names the command so the sender can be found.
  EXPECT_THAT(WhyOf(reply), HasSubstr("reload_shell"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAShellThatIsMissingHalfOfItself) {
  // A shell needs both its root and its module; neither has a usable default.
  Told told;
  EXPECT_EQ(
      TypeOf(Answer(R"({"type":"load_shell","version":1,"module":"s.js"})",
                    &told)),
      "refused");
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"/x/dist"})",
                &told)),
            "refused");
  // An empty field counts as missing.
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"","module":"s.js"})",
                &told)),
            "refused");
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"/x","module":""})",
                &told)),
            "refused");
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesARootThatIsNotAbsolute) {
  // A relative root would resolve against the engine's working directory,
  // which the sender does not know.
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_shell","version":1,"root":"dist","module":"s.js"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("absolute"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesWhenThereIsNoShellWindowToLoadInto) {
  // Without a window, answering `loaded` would report a shell nobody can see.
  Told told;
  const std::string reply = Answer(kLoadOther, &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("window"));
}

TEST(CommandProtocolTest, IgnoresFieldsItDoesNotKnow) {
  // Adding a field does not bump the version, so unknown fields are ignored.
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_shell","version":1,"root":"/x/dist",)"
      R"("module":"shell.js","because":"the bundler rebuilt"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "loaded");
  EXPECT_EQ(told.module, "shell.js");
}

TEST(CommandProtocolTest, HandsTheShellTheAddressARequestNames) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"open_url","version":1,"url":"https://example.com/a?b=c"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "opened");
  EXPECT_TRUE(told.opened);
  EXPECT_EQ(told.url, "https://example.com/a?b=c");
  EXPECT_FALSE(told.app);
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, OpensAnAppWindowWhenARequestAsksForOne) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"open_url","version":1,"url":"https://example.com/",)"
      R"("app":true})",
      &told);
  EXPECT_EQ(TypeOf(reply), "opened");
  EXPECT_TRUE(told.app);
}

TEST(CommandProtocolTest, RefusesAnAppThatIsNotABoolean) {
  // A typo must not open a browser window and report success.
  Told told;
  const std::string reply = Answer(
      R"({"type":"open_url","version":1,"url":"https://example.com/",)"
      R"("app":"yes"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("\"app\""));
  EXPECT_FALSE(told.opened);
}

TEST(CommandProtocolTest, RefusesAnAddressThatIsNotAUrl) {
  // Otherwise the shell would open an empty window and report success.
  Told told;
  const std::string reply = Answer(
      R"({"type":"open_url","version":1,"url":"not a url"})", &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("not a url"));
  EXPECT_EQ(TypeOf(Answer(R"({"type":"open_url","version":1})", &told)),
            "refused");
  EXPECT_FALSE(told.opened);
}

TEST(CommandProtocolTest, RefusesWhenThereIsNoShellPageToOpenIn) {
  Told told;
  const std::string reply =
      Answer(R"({"type":"open_url","version":1,"url":"https://example.com/"})",
             &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("shell page"));
}

TEST(CommandProtocolTest, ListsEachPermissionsDefaultAndEachSitesSetting) {
  Told told;
  const std::string reply =
      Answer(R"({"type":"site_permissions","version":1})", &told);
  EXPECT_EQ(
      base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC),
      base::JSONReader::ReadDict(
          R"({"type":"site_permissions",)"
          R"("defaults":{"camera":"ask","notifications":"allow"},)"
          R"("sites":[{"origin":"https://meet.example",)"
          R"("permission":"camera","setting":"allow"}]})",
          base::JSON_PARSE_RFC));
  EXPECT_EQ(reply.find('\n'), reply.size() - 1);
}

TEST(CommandProtocolTest, StoresTheSettingARequestNames) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"set_site_permission","version":1,)"
      R"("origin":"https://meet.example","permission":"microphone",)"
      R"("setting":"block"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "set");
  EXPECT_TRUE(told.set);
  EXPECT_EQ(told.origin, "https://meet.example");
  EXPECT_EQ(told.permission, WebViewPermission::kMicrophone);
  EXPECT_EQ(told.setting, WebViewPermissionSetting::kBlock);
}

TEST(CommandProtocolTest, RefusesASettingItCannotStore) {
  // Each is refused by name, so the sender sees which field was wrong.
  Told told;
  const std::string permission = Answer(
      R"({"type":"set_site_permission","version":1,)"
      R"("origin":"https://meet.example","permission":"bluetooth",)"
      R"("setting":"block"})",
      &told);
  EXPECT_EQ(TypeOf(permission), "refused");
  EXPECT_THAT(WhyOf(permission), HasSubstr("bluetooth"));

  const std::string setting = Answer(
      R"({"type":"set_site_permission","version":1,)"
      R"("origin":"https://meet.example","permission":"camera",)"
      R"("setting":"sometimes"})",
      &told);
  EXPECT_EQ(TypeOf(setting), "refused");
  EXPECT_THAT(WhyOf(setting), HasSubstr("sometimes"));

  // A page with no site, such as a file, has no site permissions.
  const std::string origin = Answer(
      R"({"type":"set_site_permission","version":1,)"
      R"("origin":"file:///home/someone/a.html","permission":"camera",)"
      R"("setting":"block"})",
      &told);
  EXPECT_EQ(TypeOf(origin), "refused");
  EXPECT_THAT(WhyOf(origin), HasSubstr("file:///home/someone/a.html"));

  EXPECT_FALSE(told.set);
}

TEST(CommandProtocolTest, RefusesSitePermissionsWithNoProfileToKeepThem) {
  // The settings are the shell's profile's; without a shell there is none.
  Told told;
  EXPECT_EQ(TypeOf(Answer(R"({"type":"site_permissions","version":1})",
                          &told, /*has_window=*/false)),
            "refused");
  EXPECT_EQ(TypeOf(Answer(R"({"type":"set_site_permission","version":1,)"
                          R"("origin":"https://meet.example",)"
                          R"("permission":"camera","setting":"block"})",
                          &told, /*has_window=*/false)),
            "refused");
}

TEST(CommandProtocolTest, LoadsTheUnpackedExtensionARequestNames) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_unpacked","version":1,)"
      R"("directory":"/home/someone/src/an-extension"})",
      &told);
  EXPECT_EQ(base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC),
            base::JSONReader::ReadDict(
                R"({"type":"loaded_unpacked",)"
                R"("id":"abcdefghijklmnopabcdefghijklmnop"})",
                base::JSON_PARSE_RFC));
  EXPECT_EQ(told.unpacked,
            base::FilePath("/home/someone/src/an-extension"));
}

TEST(CommandProtocolTest, RefusesAnUnpackedExtensionItCannotFind) {
  Told told;
  const std::string missing =
      Answer(R"({"type":"load_unpacked","version":1})", &told);
  EXPECT_EQ(TypeOf(missing), "refused");
  EXPECT_THAT(WhyOf(missing), HasSubstr("directory"));

  // Relative to the engine's working directory, which the sender does not
  // know.
  const std::string relative = Answer(
      R"({"type":"load_unpacked","version":1,"directory":"src/x"})", &told);
  EXPECT_EQ(TypeOf(relative), "refused");
  EXPECT_THAT(WhyOf(relative), HasSubstr("src/x"));

  EXPECT_TRUE(told.unpacked.empty());
}

TEST(CommandProtocolTest, SaysWhyAnUnpackedExtensionDidNotLoad) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_unpacked","version":1,)"
      R"("directory":"/home/someone/src/an-extension"})",
      &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("no shell"));
}

TEST(CommandProtocolTest, UninstallsTheExtensionARequestNames) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"uninstall_extension","version":1,)"
      R"("id":"abcdefghijklmnopabcdefghijklmnop"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "uninstalled");
  EXPECT_EQ(told.uninstalled, kExtensionId);

  const std::string refused = Answer(
      R"({"type":"uninstall_extension","version":1,)"
      R"("id":"abcdefghijklmnopabcdefghijklmnop"})",
      &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(refused), "refused");
  EXPECT_THAT(WhyOf(refused), HasSubstr("no shell"));
}

TEST(CommandProtocolTest, RefusesAnIdThatNamesNoExtension) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"uninstall_extension","version":1,"id":"../x"})", &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("../x"));
  EXPECT_TRUE(told.uninstalled.empty());
}

TEST(CommandProtocolTest, ListsTheExtensionsTheConfigInstalled) {
  Told told;
  EXPECT_EQ(base::JSONReader::ReadDict(
                Answer(R"({"type":"config_extensions","version":1})", &told),
                base::JSON_PARSE_RFC),
            base::JSONReader::ReadDict(
                R"({"type":"config_extensions",)"
                R"("ids":["abcdefghijklmnopabcdefghijklmnop"]})",
                base::JSON_PARSE_RFC));
  EXPECT_EQ(TypeOf(Answer(R"({"type":"config_extensions","version":1})",
                          &told, /*has_window=*/false)),
            "refused");
}

}  // namespace
}  // namespace domicile
