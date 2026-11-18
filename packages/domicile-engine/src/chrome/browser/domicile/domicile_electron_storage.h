// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_STORAGE_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_STORAGE_H_

#include <optional>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "components/domicile/browser/electron_protocol.h"
#include "components/domicile/browser/web_view_partition.h"
#include "url/gurl.h"

namespace domicile {

// An Electron app session's storage: its cookies (session.cookies), its
// sites' data (clearStorageData) and its HTTP cache, in `partition` of the
// shell's profile, where the app's windows keep theirs. Each runs `done`
// once. With no shell there is no profile, so there is nothing to find,
// keep or clear. See "Sessions" in docs/architecture/ELECTRON-APPS.md.

void GetElectronCookies(
    const WebViewPartition& partition,
    const std::optional<GURL>& url,
    base::OnceCallback<void(std::vector<ElectronCookie>)> done);
void SetElectronCookie(
    const WebViewPartition& partition,
    const ElectronCookieDetails& details,
    base::OnceCallback<void(std::optional<std::string> why)> done);
void RemoveElectronCookie(const WebViewPartition& partition,
                          const GURL& url,
                          const std::string& name,
                          base::OnceClosure done);
void FlushElectronCookies(const WebViewPartition& partition,
                          base::OnceClosure done);
void ClearElectronStorage(const WebViewPartition& partition,
                          const ElectronClearStorage& clear,
                          base::OnceClosure done);
void ClearElectronCache(const WebViewPartition& partition,
                        base::OnceClosure done);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_ELECTRON_STORAGE_H_
