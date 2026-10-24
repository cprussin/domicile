// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PORTAL_FILE_CHOOSER_H_
#define COMPONENTS_DOMICILE_BROWSER_PORTAL_FILE_CHOOSER_H_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "components/domicile/mojom/web_view_guest.mojom-shared.h"

namespace dbus {
class MethodCall;
class Response;
}  // namespace dbus

namespace domicile {

// A file dialog for a page in no <webview>, such as the shell's own, which has
// no element to ask (see //chrome/browser/domicile/domicile_file_dialogs.h).
// It asks the compositor's FileChooser portal backend directly, whose picker
// the shell draws as any application's.
//
// Chrome's own portal dialog goes through xdg-desktop-portal, which a desk may
// not run, and stops input to its parent window, which is the desk.

// The backend's OpenFile or SaveFile call for `mode`. `extensions` filters
// the files offered, empty for any; `suggested` names the file a save
// suggests, and its folder if absolute.
std::unique_ptr<dbus::MethodCall> PortalFileChooserCall(
    mojom::WebViewFileChooserMode mode,
    const std::vector<std::string>& extensions,
    const base::FilePath& suggested);

// The paths the backend's reply chose, or nullopt for a cancel, an error or
// a reply of another shape.
std::optional<std::vector<base::FilePath>> PortalFileChooserPaths(
    dbus::Response* response);

// Asks the backend. `chosen` runs on this sequence once the user answers.
using PortalFilesChosen =
    base::OnceCallback<void(std::optional<std::vector<base::FilePath>>)>;
void AskThePortalForFiles(mojom::WebViewFileChooserMode mode,
                          const std::vector<std::string>& extensions,
                          const base::FilePath& suggested,
                          PortalFilesChosen chosen);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PORTAL_FILE_CHOOSER_H_
