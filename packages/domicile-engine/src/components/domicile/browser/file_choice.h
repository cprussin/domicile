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

namespace domicile {

// What a shell's answer to a <webview>'s file chooser means to the browser.
//
// THE SHELL PICKS AND THE BROWSER READS. A picker is desktop UI, so a page's
// `<input type="file">` and a download's "where to?" are asked of the shell --
// see FileChooserRequested in components/domicile/mojom/web_view_guest.mojom --
// and what comes back is paths. These are the three questions the browser
// asks of them, kept here because they can be answered with no browser at all.

// `relative`, a path the shell answered with, under `home`.
//
// RELATIVE TO THE HOME because that is the vocabulary a shell already has: the
// compositor's `found_files` names every file that way, and a picker built on
// it hands back what it was shown. A directory may end in `/`, which is how
// that answer spells one.
//
// Nothing for a path that is empty, absolute, or climbs out with `..`. The
// element refuses all three before sending, so one arriving here did not come
// from it.
std::optional<base::FilePath> PathInHome(const base::FilePath& home,
                                         std::string_view relative);

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

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FILE_CHOICE_H_
