// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_GUEST_DIALOGS_H_
#define COMPONENTS_DOMICILE_BROWSER_GUEST_DIALOGS_H_

#include <string>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"

namespace domicile {

// The `alert()`, `confirm()` or `prompt()` a guest's page has open, if any.
//
// The shell shows one dialog at a time. An answer the shell sends after the
// dialog was canceled, for example by a navigation, is ignored. See
// DialogRequested in components/domicile/mojom/web_view_guest.mojom.
class GuestDialogs {
 public:
  // OK or Cancel, and a prompt's text.
  using Closed =
      base::OnceCallback<void(bool accepted, const std::u16string& user_input)>;
  // Asks the shell; it runs the given callback with its answer.
  using Show = base::OnceCallback<void(Closed answer)>;

  GuestDialogs();
  GuestDialogs(const GuestDialogs&) = delete;
  GuestDialogs& operator=(const GuestDialogs&) = delete;
  ~GuestDialogs();

  // Opens a dialog with `show`; the page gets its answer through `closed`.
  // Returns false, and runs neither, when a dialog is already open.
  bool Open(Closed closed, Show show);

  // Answers the open dialog with Cancel. Returns false when none is open.
  bool Cancel();

 private:
  void Answered(int id, bool accepted, const std::u16string& user_input);

  // The open dialog's page, or null.
  Closed open_;
  // Numbers each dialog, so an answer to an earlier one is ignored.
  int open_id_ = 0;

  base::WeakPtrFactory<GuestDialogs> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_GUEST_DIALOGS_H_
