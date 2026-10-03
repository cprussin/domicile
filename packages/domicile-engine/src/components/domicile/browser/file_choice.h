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

// What a shell's answer to a <webview>'s file chooser means to the browser.
//
// THE SHELL PICKS AND THE BROWSER READS. A picker is desktop UI, so a page's
// `<input type="file">` and a download's "where to?" are asked of the shell --
// see FileChooserRequested in components/domicile/mojom/web_view_guest.mojom --
// and what comes back is paths. These are the three questions the browser
// asks of them, kept here because they can be answered with no browser at all.

// `path`, as a shell named it, as the path it means.
//
// ABSOLUTE, OR RELATIVE TO THE HOME. Relative is the vocabulary a shell
// already has -- the compositor's `found_files` names every file that way --
// and absolute is how a picker walking the whole filesystem names the rest.
// The empty path is the home. A directory may end in `/`, which is how both
// that answer and DirectoryEntries below spell one.
//
// Nothing for a path that climbs with `..`. The element refuses one before
// sending, so one arriving here did not come from it.
std::optional<base::FilePath> ResolvedPath(const base::FilePath& home,
                                           std::string_view path);

// The names in `directory`, each a directory's ending in `/` -- the spelling
// `found_files` uses -- in no order. Nothing for a path that is not a
// directory this process can read.
//
// Blocking, so it runs on the thread pool.
std::optional<std::vector<std::string>> DirectoryEntries(
    const base::FilePath& directory);

// Whether `count` paths answer what `mode` asked: one, except for
// kOpenMultiple, which takes at least one.
bool IsAnswerFor(mojom::WebViewFileChooserMode mode, size_t count);

// The file extensions an `accept` list names, lower case and without the dot.
//
// A picker has a name to go on and nothing else, so `image/*` is turned into
// the names an image has here rather than there. A MIME type the browser knows
// no extension for adds nothing -- which leaves a list that named only such
// types empty, and empty is "anything". That is Chrome's own answer too: its
// dialog falls back to all files when no filter survives.
std::vector<std::string> AcceptedExtensions(
    const std::vector<std::u16string>& accept_types);

// The picker that answers a dialog of `type`: the same four a page's
// `<input type="file">` is asked as. See
// //chrome/browser/domicile/domicile_file_dialogs.h for which dialogs.
//
// SELECT_NONE is no dialog, and nothing opens one.
mojom::WebViewFileChooserMode ModeForDialog(ui::SelectFileDialog::Type type);

// The file extensions a dialog's `types` name, lower case, as
// AcceptedExtensions spells them.
//
// Empty -- anything -- when there are no types, and when the dialog keeps its
// "all files" filter: a picker has no filters to switch between, so a dialog
// that would let the user pick any file is one whose picker shows every file.
std::vector<std::string> DialogExtensions(
    const ui::SelectFileDialog::FileTypeInfo* types);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FILE_CHOICE_H_
