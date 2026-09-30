// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/file_choice.h"

#include <optional>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using ::testing::Contains;
using ::testing::ElementsAre;
using ::testing::IsEmpty;
using ::testing::UnorderedElementsAre;

// A string rather than a FilePath: a file-scope object with a destructor is an
// exit-time destructor, which this build refuses.
constexpr char kHome[] = "/home/someone";

TEST(FileChoiceTest, ARelativePathIsUnderTheHome) {
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "Downloads/report.pdf"),
            base::FilePath("/home/someone/Downloads/report.pdf"));
}

TEST(FileChoiceTest, TheEmptyPathIsTheHome) {
  // What a picker lists first, and what a save into the home is made under.
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), ""),
            base::FilePath("/home/someone"));
}

TEST(FileChoiceTest, AnAbsolutePathIsItself) {
  // A picker walks the whole filesystem, not only what the index found.
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "/mnt/usb/photo.png"),
            base::FilePath("/mnt/usb/photo.png"));
}

TEST(FileChoiceTest, ADirectoryMayEndInASlash) {
  // How a `found_files` answer and a listing spell one, and so how a picker
  // built on them hands one back.
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "Documents/"),
            base::FilePath("/home/someone/Documents"));
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "/etc/"),
            base::FilePath("/etc"));
}

TEST(FileChoiceTest, NoPathClimbs) {
  // A renderer can put any string on the pipe; the element refuses these
  // before sending, so one that arrives did not come from it.
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "../other/secret"),
            std::nullopt);
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "/etc/../root"), std::nullopt);
}

TEST(FileChoiceTest, AListingIsNamesWithDirectoriesSlashed) {
  base::ScopedTempDir temp;
  ASSERT_TRUE(temp.CreateUniqueTempDir());
  ASSERT_TRUE(base::CreateDirectory(temp.GetPath().Append("photos")));
  ASSERT_TRUE(base::WriteFile(temp.GetPath().Append("notes.txt"), "hi"));

  const std::optional<std::vector<std::string>> entries =
      DirectoryEntries(temp.GetPath());
  ASSERT_TRUE(entries.has_value());
  EXPECT_THAT(*entries, UnorderedElementsAre("photos/", "notes.txt"));
}

TEST(FileChoiceTest, NothingIsNotADirectory) {
  base::ScopedTempDir temp;
  ASSERT_TRUE(temp.CreateUniqueTempDir());
  const base::FilePath file = temp.GetPath().Append("notes.txt");
  ASSERT_TRUE(base::WriteFile(file, "hi"));

  EXPECT_EQ(DirectoryEntries(file), std::nullopt);
  EXPECT_EQ(DirectoryEntries(temp.GetPath().Append("missing")), std::nullopt);
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
