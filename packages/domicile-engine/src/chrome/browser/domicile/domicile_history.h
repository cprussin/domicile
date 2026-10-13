// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_HISTORY_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_HISTORY_H_

#include <vector>

#include "base/time/time.h"
#include "components/domicile/browser/command_protocol.h"

class GURL;
class Profile;

namespace domicile {

// A profile's history, favicons and browsing data, for the History app, which
// reaches them through the command socket in place of `chrome.history` and
// `chrome.browsingData` (docs/architecture/APP-MODULES.md). Each runs its
// callback once, after returning.

// The pages `search` finds in `profile`, most recently visited first, each
// with its cached favicon, as `chrome.history.search` finds them.
void SearchHistoryIn(Profile& profile,
                     const HistorySearch& search,
                     HistoryFound found);

// The time of every visit to `url` in `profile`, as
// `chrome.history.getVisits` lists them.
void ListVisitsIn(Profile& profile, const GURL& url, VisitsFound found);

// Removes the visits at exactly these times from `profile`, as their user
// would.
void DeleteVisitsIn(Profile& profile,
                    const std::vector<base::Time>& visits,
                    CommandDone done);

// Clears what `clearing` names from `profile`, as
// `chrome.browsingData.remove` does.
void ClearBrowsingDataIn(Profile& profile,
                         const BrowsingDataClearing& clearing,
                         CommandDone done);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_HISTORY_H_
