// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_profiles.h"

#include <optional>
#include <string>
#include <vector>

#include "base/check.h"
#include "base/json/json_reader.h"
#include "base/values.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

base::DictValue Dict(const std::string& json) {
  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(json, base::JSON_PARSE_RFC);
  CHECK(parsed) << json;
  return *std::move(parsed);
}

// A message with these sites and a Personal, Work and Private profile.
std::string Message(const std::string& sites) {
  return R"({"profiles":[)"
         R"({"id":"personal","name":"Personal","color":"#0d9488",)"
         R"("private":false,"extensions":null},)"
         R"({"id":"work","name":"Work","color":"#d97706","private":false,)"
         R"("extensions":["aeblfdkhhhdcdjpifhhbdiojplfjncoa"]},)"
         R"({"id":"incognito","name":"Private","color":"#a78bfa",)"
         R"("private":true,"extensions":null}],)"
         R"("default_profile":"personal",)"
         R"("default_private_profile":"incognito",)"
         R"("sites":)" +
         sites + "}";
}

TEST(BrowserProfilesTest, AMessageReadsAsTheConfigWroteIt) {
  std::optional<BrowserProfiles> read =
      ParseBrowserProfiles(Dict(Message(R"({"github.com/acme":"work"})")));

  ASSERT_TRUE(read.has_value());
  ASSERT_EQ(read->profiles.size(), 3u);
  EXPECT_EQ(read->default_profile, "personal");
  EXPECT_EQ(read->default_private_profile, "incognito");
  EXPECT_EQ(read->sites.at("github.com/acme"), "work");
  const BrowserProfile* work = read->Find("work");
  ASSERT_NE(work, nullptr);
  EXPECT_EQ(work->name, "Work");
  EXPECT_FALSE(work->is_private);
  EXPECT_EQ(work->extensions,
            std::vector<std::string>{"aeblfdkhhhdcdjpifhhbdiojplfjncoa"});
  EXPECT_EQ(read->Find("personal")->extensions, std::nullopt);
  EXPECT_TRUE(read->Find("incognito")->is_private);
}

TEST(BrowserProfilesTest, AMessageThatContradictsItselfIsRefused) {
  // A site in no profile, and one in the default profile.
  EXPECT_FALSE(ParseBrowserProfiles(Dict(Message(R"({"acme.com":"office"})"))));
  EXPECT_FALSE(
      ParseBrowserProfiles(Dict(Message(R"({"acme.com":"personal"})"))));
  // A private default, and a default private profile that is not private.
  EXPECT_FALSE(ParseBrowserProfiles(Dict(
      R"({"profiles":[{"id":"incognito","name":"P","color":"#000000",)"
      R"("private":true,"extensions":null}],"default_profile":"incognito",)"
      R"("default_private_profile":"incognito","sites":{}})")));
  EXPECT_FALSE(ParseBrowserProfiles(Dict(
      R"({"profiles":[{"id":"personal","name":"P","color":"#000000",)"
      R"("private":false,"extensions":null}],"default_profile":"personal",)"
      R"("default_private_profile":"personal","sites":{}})")));
  // An id that is no directory name.
  EXPECT_FALSE(ParseBrowserProfiles(
      Dict(R"({"profiles":[{"id":"../p","name":"P","color":"#000000",)"
           R"("private":false,"extensions":null}],"default_profile":"../p",)"
           R"("default_private_profile":"../p","sites":{}})")));
}

TEST(BrowserProfilesTest, AProfileTurnsOnOnlyTheExtensionsItNames) {
  const ExtensionList all{
      .web_store = {"aeblfdkhhhdcdjpifhhbdiojplfjncoa",
                    "nngceckbapebfimnlniiiahkandclblb"},
      .unpacked = {"/home/me/src/mine"},
  };
  const auto unpacked_id = [](const std::string&) {
    return std::string("mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm");
  };
  const BrowserProfile every{.id = "personal"};
  const BrowserProfile work{.id = "work",
                            .extensions = std::vector<std::string>{
                                "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
                                "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"}};

  EXPECT_EQ(ExtensionsFor(every, all, unpacked_id).web_store, all.web_store);
  const ExtensionList chosen = ExtensionsFor(work, all, unpacked_id);
  EXPECT_EQ(chosen.web_store,
            std::vector<std::string>{"aeblfdkhhhdcdjpifhhbdiojplfjncoa"});
  EXPECT_EQ(chosen.unpacked, std::vector<std::string>{"/home/me/src/mine"});
  // Its pages are not private, so it leaves where its extensions run as set.
  EXPECT_FALSE(chosen.settings.contains("aeblfdkhhhdcdjpifhhbdiojplfjncoa"));
}

// A private profile's pages are off the record, so the extensions it turns on
// run there, and only those.
TEST(BrowserProfilesTest, APrivateProfilesExtensionsRunInItsPages) {
  const ExtensionList all{
      .web_store = {"aeblfdkhhhdcdjpifhhbdiojplfjncoa",
                    "nngceckbapebfimnlniiiahkandclblb"},
      .unpacked = {"/home/me/src/mine"},
  };
  const auto unpacked_id = [](const std::string&) {
    return std::string("mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm");
  };
  const BrowserProfile hidden{.id = "private",
                              .is_private = true,
                              .extensions = std::vector<std::string>{
                                  "nngceckbapebfimnlniiiahkandclblb",
                                  "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"}};

  const ExtensionList chosen = ExtensionsFor(hidden, all, unpacked_id);
  EXPECT_EQ(chosen.web_store,
            std::vector<std::string>{"nngceckbapebfimnlniiiahkandclblb"});
  EXPECT_EQ(chosen.settings.at("nngceckbapebfimnlniiiahkandclblb").in_private,
            true);
  EXPECT_EQ(chosen.settings.at("mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm").in_private,
            true);
  EXPECT_FALSE(chosen.settings.contains("aeblfdkhhhdcdjpifhhbdiojplfjncoa"));

  // One that names none keeps them all out, as a private page has always
  // been kept from extensions unless they were allowed.
  const BrowserProfile unnamed{.id = "private", .is_private = true};
  const ExtensionList none = ExtensionsFor(unnamed, all, unpacked_id);
  EXPECT_TRUE(none.web_store.empty());
  EXPECT_TRUE(none.unpacked.empty());
}

}  // namespace
}  // namespace domicile
