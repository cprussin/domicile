// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/portal_file_chooser.h"

#include <memory>
#include <string>
#include <vector>

#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "dbus/message.h"
#include "dbus/object_path.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using mojom::WebViewFileChooserMode;

// The keys of a call's options, in order.
std::vector<std::string> OptionKeys(dbus::MethodCall& call) {
  dbus::MessageReader reader(&call);
  dbus::ObjectPath handle;
  std::string app, parent, title;
  dbus::MessageReader options(nullptr);
  EXPECT_TRUE(reader.PopObjectPath(&handle));
  EXPECT_TRUE(reader.PopString(&app));
  EXPECT_TRUE(reader.PopString(&parent));
  EXPECT_TRUE(reader.PopString(&title));
  EXPECT_TRUE(reader.PopArray(&options));
  std::vector<std::string> keys;
  while (options.HasMoreData()) {
    dbus::MessageReader entry(nullptr);
    std::string key;
    EXPECT_TRUE(options.PopDictEntry(&entry));
    EXPECT_TRUE(entry.PopString(&key));
    keys.push_back(key);
  }
  return keys;
}

TEST(PortalFileChooserTest, AFolderUploadAsksForADirectory) {
  std::unique_ptr<dbus::MethodCall> call = PortalFileChooserCall(
      WebViewFileChooserMode::kOpenFolder, {"png"}, base::FilePath());

  EXPECT_EQ(call->GetMember(), "OpenFile");
  // A folder has no file type to filter by.
  EXPECT_EQ(OptionKeys(*call), std::vector<std::string>{"directory"});
}

TEST(PortalFileChooserTest, ASaveSuggestsTheNameAndItsFolder) {
  std::unique_ptr<dbus::MethodCall> call =
      PortalFileChooserCall(WebViewFileChooserMode::kSave, {"txt"},
                            base::FilePath("/home/me/notes.txt"));

  EXPECT_EQ(call->GetMember(), "SaveFile");
  EXPECT_EQ(
      OptionKeys(*call),
      (std::vector<std::string>{"current_name", "current_folder", "filters"}));
}

std::unique_ptr<dbus::Response> Reply(uint32_t answer,
                                      std::vector<std::string> uris) {
  std::unique_ptr<dbus::Response> response = dbus::Response::CreateEmpty();
  dbus::MessageWriter writer(response.get());
  writer.AppendUint32(answer);
  dbus::MessageWriter results(nullptr);
  writer.OpenArray("{sv}", &results);
  dbus::MessageWriter entry(nullptr);
  results.OpenDictEntry(&entry);
  entry.AppendString("uris");
  dbus::MessageWriter variant(nullptr);
  entry.OpenVariant("as", &variant);
  variant.AppendArrayOfStrings(uris);
  entry.CloseContainer(&variant);
  results.CloseContainer(&entry);
  writer.CloseContainer(&results);
  return response;
}

TEST(PortalFileChooserTest, TheChosenUrisArePaths) {
  std::unique_ptr<dbus::Response> response =
      Reply(0, {"file:///home/me/a%20b.txt", "file:///home/me/c.txt"});

  EXPECT_EQ(PortalFileChooserPaths(response.get()),
            (std::vector<base::FilePath>{base::FilePath("/home/me/a b.txt"),
                                         base::FilePath("/home/me/c.txt")}));
}

TEST(PortalFileChooserTest, ACancelOrAnErrorChoosesNothing) {
  std::unique_ptr<dbus::Response> canceled =
      Reply(1, {"file:///home/me/a.txt"});
  EXPECT_EQ(PortalFileChooserPaths(canceled.get()), std::nullopt);
  EXPECT_EQ(PortalFileChooserPaths(nullptr), std::nullopt);

  std::unique_ptr<dbus::Response> remote = Reply(0, {"https://example.com/a"});
  EXPECT_EQ(PortalFileChooserPaths(remote.get()), std::nullopt);
}

}  // namespace
}  // namespace domicile
