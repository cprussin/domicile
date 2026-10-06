// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_FILE_CHOICE_H_
#define COMPONENTS_DOMICILE_BROWSER_FILE_CHOICE_H_

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/files/file_path.h"
#include "components/domicile/mojom/web_view_guest.mojom-forward.h"
#include "ui/shell_dialogs/select_file_dialog.h"

namespace domicile {

// Helpers for interpreting the shell's answer to a file chooser.
//
// The shell draws file pickers, for both `<input type="file">` and downloads
// (see FileChooserRequested in components/domicile/mojom/web_view_guest.mojom),
// and returns paths. These helpers need no browser, so they live here.

// Resolves a path from the shell.
//
// `path` is absolute or relative to `home`; empty means `home`. A trailing `/`
// is allowed. Returns nothing for a path containing `..`: the element rejects
// those, so one arriving here is untrusted.
std::optional<base::FilePath> ResolvedPath(const base::FilePath& home,
                                           std::string_view path);

// The unordered names in `directory`, with a trailing `/` on directories as in
// `found_files`. Returns nothing if `directory` is not a readable directory.
//
// Blocking, so call it on the thread pool.
std::optional<std::vector<std::string>> DirectoryEntries(
    const base::FilePath& directory);

// Whether `count` paths answer what `mode` asked: one, except for
// kOpenMultiple, which takes at least one.
bool IsAnswerFor(mojom::WebViewFileChooserMode mode, size_t count);

// The file extensions an `accept` list names, lowercase and without the dot.
//
// The picker filters by file name, so MIME types such as `image/*` become
// extensions. Unknown MIME types add nothing; an empty result means any file,
// matching Chrome's dialog.
std::vector<std::string> AcceptedExtensions(
    const std::vector<std::u16string>& accept_types);

// The picker mode for a dialog of `type`. See
// //chrome/browser/domicile/domicile_file_dialogs.h for which dialogs use it.
//
// `type` must not be SELECT_NONE.
mojom::WebViewFileChooserMode ModeForDialog(ui::SelectFileDialog::Type type);

// The file extensions a dialog's `types` name, lowercase, as in
// AcceptedExtensions.
//
// Empty, meaning any file, when there are no types or the dialog includes
// "all files". The picker has no filter switcher, so it must show every file.
std::vector<std::string> DialogExtensions(
    const ui::SelectFileDialog::FileTypeInfo* types);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FILE_CHOICE_H_
