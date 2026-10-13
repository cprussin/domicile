// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_FETCH_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_FETCH_H_

#include "components/domicile/mojom/shell_fetch.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {
class RenderFrameHost;
}  // namespace content

namespace domicile {

// Binds ShellFetch for `frame`: GETs with the cookies of the frame's profile's
// default storage partition, the one its ordinary browser windows use. See
// components/domicile/mojom/shell_fetch.mojom.
//
// Access control is the caller's, as for BindBrowserWindows: it registers this
// only for a document with the shell's origin. The checks on each request are
// in components/domicile/browser/shell_fetch.h, which has the tests.
void BindShellFetch(content::RenderFrameHost* frame,
                    mojo::PendingReceiver<mojom::ShellFetch> receiver);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_FETCH_H_
