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
#include "ui/shell_dialogs/select_file_dialog.h"

namespace domicile {
namespace {

using ::testing::Contains;
using ::testing::ElementsAre;
using ::testing::IsEmpty;
using ::testing::UnorderedElementsAre;

using FileExtensions = ui::SelectFileDialog::FileTypeInfo::FileExtensionList;

// A string, not a FilePath: the build forbids exit-time destructors.
constexpr char kHome[] = "/home/someone";

TEST(FileChoiceTest, ARelativePathIsUnderTheHome) {
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "Downloads/report.pdf"),
            base::FilePath("/home/someone/Downloads/report.pdf"));
}

TEST(FileChoiceTest, TheEmptyPathIsTheHome) {
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), ""),
            base::FilePath("/home/someone"));
}

TEST(FileChoiceTest, AnAbsolutePathIsItself) {
  // A picker can browse the whole filesystem.
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "/mnt/usb/photo.png"),
            base::FilePath("/mnt/usb/photo.png"));
}

TEST(FileChoiceTest, ADirectoryMayEndInASlash) {
  // `found_files` and DirectoryEntries both mark directories this way.
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "Documents/"),
            base::FilePath("/home/someone/Documents"));
  EXPECT_EQ(ResolvedPath(base::FilePath(kHome), "/etc/"),
            base::FilePath("/etc"));
}

TEST(FileChoiceTest, NoPathClimbs) {
  // The element rejects these, so one arriving here is untrusted.
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
  const std::vector<std::string> images = AcceptedExtensions({u"image/*"});
  EXPECT_THAT(images, Contains("png"));
  EXPECT_THAT(images, Contains("jpg"));
}

TEST(FileChoiceTest, NoAcceptListIsAnything) {
  EXPECT_THAT(AcceptedExtensions({}), IsEmpty());
}

TEST(FileChoiceTest, EachDialogIsThePickerThatAnswersIt) {
  // Browser dialogs, such as the PDF viewer's save or showSaveFilePicker(), use
  // the same picker modes as `<input type="file">`.
  EXPECT_EQ(ModeForDialog(ui::SelectFileDialog::SELECT_OPEN_FILE),
            mojom::WebViewFileChooserMode::kOpen);
  EXPECT_EQ(ModeForDialog(ui::SelectFileDialog::SELECT_OPEN_MULTI_FILE),
            mojom::WebViewFileChooserMode::kOpenMultiple);
  EXPECT_EQ(ModeForDialog(ui::SelectFileDialog::SELECT_SAVEAS_FILE),
            mojom::WebViewFileChooserMode::kSave);
  EXPECT_EQ(ModeForDialog(ui::SelectFileDialog::SELECT_FOLDER),
            mojom::WebViewFileChooserMode::kOpenFolder);
  EXPECT_EQ(ModeForDialog(ui::SelectFileDialog::SELECT_UPLOAD_FOLDER),
            mojom::WebViewFileChooserMode::kOpenFolder);
  EXPECT_EQ(ModeForDialog(ui::SelectFileDialog::SELECT_EXISTING_FOLDER),
            mojom::WebViewFileChooserMode::kOpenFolder);
}

TEST(FileChoiceTest, ADialogsFileTypesAreItsExtensions) {
  // Typed explicitly because `{{"pdf"}}` is ambiguous.
  ui::SelectFileDialog::FileTypeInfo types(
      std::vector<FileExtensions>{{"PDF"}, {"htm", "html"}});
  EXPECT_THAT(DialogExtensions(&types), ElementsAre("pdf", "htm", "html"));
}

TEST(FileChoiceTest, ADialogThatAlsoTakesAllFilesTakesAnything) {
  // The PDF viewer's save names `pdf` and also allows all files.
  ui::SelectFileDialog::FileTypeInfo types(
      std::vector<FileExtensions>{{"pdf"}});
  types.include_all_files = true;
  EXPECT_THAT(DialogExtensions(&types), IsEmpty());
}

TEST(FileChoiceTest, ADialogWithNoFileTypesTakesAnything) {
  EXPECT_THAT(DialogExtensions(nullptr), IsEmpty());
}

}  // namespace
}  // namespace domicile
