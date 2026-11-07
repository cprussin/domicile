// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_PROMPTS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_PROMPTS_H_

namespace domicile {

// Questions Chrome asks with dialogs of its own, asked by the shell.
//
// Chrome draws these on the outermost WebContents' window, which for a
// <webview> guest is the shell's own, so Chrome's unstyled boxes were drawn
// over the desktop. This sets Chrome's overrides (patch 0179) so each asks
// the guest's element through PromptRequested (see
// components/domicile/mojom/web_view_guest.mojom):
//
// - File System Access: letting a site view or edit a file or folder (a guest
//   has no prompt manager, so these were refused outright), a folder that
//   holds system files, and a file Safe Browsing calls dangerous.
// - The certificate a site asks to sign in with. With none installed, the
//   page continues without one and nothing is asked, as in Chrome.
// - A Bluetooth device's PIN or pairing confirmation.
// - An extension's install, added permissions and re-enable prompts.
//
// A page outside any guest gets no: its request is refused and logged.
//
// Called once from StartDesk, before any guest exists.
void UseTheShellForPrompts();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_PROMPTS_H_
