// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_PAGE_UNLOADING_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_PAGE_UNLOADING_H_

#include "base/functional/callback.h"

namespace domicile {

// Runs `pagehide` and `unload` in the main frame of every browser window's page
// and writes the pages' localStorage to disk, then calls `done`, at the latest
// 2 s from now.
//
// SIGTERM ends the browser with `chrome::SessionEnding`, which runs neither
// event. A page that gives something up in one, such as a lock in
// localStorage, would find it taken at the next start.
//
// Must be called once, on the UI thread.
void LetPagesUnload(base::OnceClosure done);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_PAGE_UNLOADING_H_
