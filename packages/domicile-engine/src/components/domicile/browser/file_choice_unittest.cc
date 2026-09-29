// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/file_choice.h"

#include <optional>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using ::testing::Contains;
using ::testing::ElementsAre;
using ::testing::IsEmpty;

// A string rather than a FilePath: a file-scope object with a destructor is an
// exit-time destructor, which this build refuses.
constexpr char kHome[] = "/home/someone";

TEST(FileChoiceTest, APathIsUnderTheHome) {
  EXPECT_EQ(PathInHome(base::FilePath(kHome), "Downloads/report.pdf"),
            base::FilePath("/home/someone/Downloads/report.pdf"));
}

TEST(FileChoiceTest, ADirectoryMayEndInASlash) {
  // How a `found_files` answer spells one, and so how a picker built on it
  // hands one back.
  EXPECT_EQ(PathInHome(base::FilePath(kHome), "Documents/"),
            base::FilePath("/home/someone/Documents"));
}

TEST(FileChoiceTest, NothingOutsideTheHomeIsAPath) {
  // A renderer can put any string on the pipe; the element refuses these
  // before sending, so one that arrives did not come from it.
  EXPECT_EQ(PathInHome(base::FilePath(kHome), ""), std::nullopt);
  EXPECT_EQ(PathInHome(base::FilePath(kHome), "/etc/passwd"), std::nullopt);
  EXPECT_EQ(PathInHome(base::FilePath(kHome), "../other/secret"),
            std::nullopt);
  EXPECT_EQ(PathInHome(base::FilePath(kHome), "Documents/../../other"),
            std::nullopt);
}

TEST(FileChoiceTest, EachModeTakesItsOwnCount) {
  EXPECT_TRUE(IsAnswerFor(mojom::WebViewFileChooserMode::kOpen, 1));
  EXPECT_FALSE(IsAnswerFor(mojom::WebViewFileChooserMode::kOpen, 2));
  EXPECT_TRUE(IsAnswerFor(mojom::WebViewFileChooserMode::kOpenMultiple, 3));
  EXPECT_FALSE(IsAnswerFor(mojom::WebViewFileChooserMode::kOpenMultiple, 0));
  EXPECT_TRUE(IsAnswerFor(mojom::WebViewFileChooserMode::kOpenFolder, 1));
  EXPECT_FALSE(IsAnswerFor(mojom::WebViewFileChooserMode::kOpenFolder, 0));
  EXPECT_TRUE(IsAnswerFor(mojom::WebViewFileChooserMode::kSave, 1));
  EXPECT_FALSE(IsAnswerFor(mojom::WebViewFileChooserMode::kSave, 2));
}

TEST(FileChoiceTest, AnExtensionIsTakenAsWritten) {
  EXPECT_THAT(AcceptedExtensions({u".PDF", u".txt"}), ElementsAre("pdf", "txt"));
}

TEST(FileChoiceTest, AMimeTypeBecomesItsExtensions) {
  // What `accept="image/*"` means to a picker that can only read a name.
  const std::vector<std::string> images = AcceptedExtensions({u"image/*"});
  EXPECT_THAT(images, Contains("png"));
  EXPECT_THAT(images, Contains("jpg"));
}

TEST(FileChoiceTest, NoAcceptListIsAnything) {
  EXPECT_THAT(AcceptedExtensions({}), IsEmpty());
}

}  // namespace
}  // namespace domicile
