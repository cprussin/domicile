// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Every locale but en-US is packed with only the strings a desk can show
// (//components/domicile/locales), so ResourceBundle reads en-US for the rest.

#include <map>
#include <optional>
#include <string>
#include <string_view>

#include "base/files/scoped_temp_dir.h"
#include "base/scoped_environment_variable_override.h"
#include "base/test/scoped_path_override.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/resource/data_pack.h"
#include "ui/base/resource/resource_bundle.h"
#include "ui/base/ui_base_paths.h"

namespace domicile {
namespace {

constexpr uint16_t kKeptString = 100;
constexpr uint16_t kTrimmedString = 101;

class LocaleFallbackTest : public testing::Test {
 protected:
  void SetUp() override {
    ASSERT_TRUE(locales_.CreateUniqueTempDir());
    locales_override_.emplace(ui::DIR_LOCALES, locales_.GetPath());
    WritePack("en-US", {{kKeptString, "Today"}, {kTrimmedString, "Settings"}});
    WritePack("fr", {{kKeptString, "Aujourd'hui"}});
    // Linux picks the locale from the environment, not the one asked for.
    language_.emplace("LANGUAGE", "fr");
    ASSERT_EQ(ui::ResourceBundle::InitSharedInstanceWithLocale(
                  "fr", nullptr,
                  ui::ResourceBundle::DO_NOT_LOAD_COMMON_RESOURCES),
              "fr");
  }

  void TearDown() override { ui::ResourceBundle::CleanupSharedInstance(); }

  std::u16string String(uint16_t id) {
    return ui::ResourceBundle::GetSharedInstance().GetLocalizedString(id);
  }

 private:
  void WritePack(std::string_view locale,
                 const std::map<uint16_t, std::string_view>& strings) {
    ASSERT_TRUE(ui::DataPack::WritePack(
        locales_.GetPath().AppendASCII(std::string(locale) + ".pak"), strings,
        ui::DataPack::UTF8));
  }

  base::ScopedTempDir locales_;
  std::optional<base::ScopedPathOverride> locales_override_;
  std::optional<base::ScopedEnvironmentVariableOverride> language_;
};

TEST_F(LocaleFallbackTest, ALocaleAnswersWithItsOwnString) {
  EXPECT_EQ(String(kKeptString), u"Aujourd'hui");
}

TEST_F(LocaleFallbackTest, AStringTheLocaleWasPackedWithoutComesFromEnUs) {
  EXPECT_EQ(String(kTrimmedString), u"Settings");
}

}  // namespace
}  // namespace domicile
