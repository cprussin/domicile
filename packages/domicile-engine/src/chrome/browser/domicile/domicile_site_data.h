// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_SITE_DATA_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_SITE_DATA_H_

#include <string>

#include "components/domicile/browser/command_protocol.h"

class Profile;

namespace domicile {

// A profile's site data, for the Settings app, read and removed through
// Chrome's BrowsingDataModel as chrome://settings/content/all does. Each runs
// its callback once, after returning.

// Every web host that stores data in `profile`, with its size and cookies.
void ListSiteDataIn(Profile& profile, SiteDataFound found);

// Removes everything `host` stores in `profile`.
void ClearSiteDataIn(Profile& profile,
                     const std::string& host,
                     CommandDone done);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_SITE_DATA_H_
