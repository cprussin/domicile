// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PAGE_PRIVACY_H_
#define COMPONENTS_DOMICILE_BROWSER_PAGE_PRIVACY_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/timer/timer.h"
#include "components/domicile/browser/browser_profiles.h"
#include "components/prefs/pref_change_registrar.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"

class PrefService;

namespace domicile {

// How one page blocks ads and trackers, for a shell's shield: its profile's
// mode, changed for its site (site_privacy.h) or for its window, and how many
// of its requests were blocked. A window's mode lasts as long as its page's
// WebContents, which is its browser window's. See
// docs/architecture/AD-BLOCKING.md.
//
// Where a page's mode comes from.
enum class AdBlockingSetFor {
  kProfile,
  kSite,
  kWindow,
};

// One page's ad blocking. UI thread only.
class PagePrivacy : public content::WebContentsObserver,
                    public content::WebContentsUserData<PagePrivacy> {
 public:
  PagePrivacy(const PagePrivacy&) = delete;
  PagePrivacy& operator=(const PagePrivacy&) = delete;
  ~PagePrivacy() override;

  // The page's site, as PrivacySiteOf has it.
  std::string site() const;

  // The mode the page's requests are checked in: its window's, else its
  // site's, else its profile's.
  AdBlockingMode mode() const;
  AdBlockingSetFor set_for() const;

  // Requests blocked since the page was committed.
  int blocked() const { return blocked_; }

  // Counts a request the blocker refused.
  void CountBlocked();

  // Sets the mode for the window, or none for its site's or profile's.
  void SetForWindow(std::optional<AdBlockingMode> mode);

  // Runs `changed` when anything above changes: at once for a mode, whoever
  // set it, or a new page, and at most every quarter second for the count.
  // One listener, the page's guest; another replaces it.
  void OnChanged(base::RepeatingClosure changed);

 private:
  friend class content::WebContentsUserData<PagePrivacy>;
  explicit PagePrivacy(content::WebContents* contents);

  // content::WebContentsObserver:
  void PrimaryPageChanged(content::Page& page) override;

  PrefService& prefs() const;
  void Changed();

  PrefChangeRegistrar watched_;
  std::optional<AdBlockingMode> window_;
  int blocked_ = 0;
  base::RepeatingClosure changed_;
  base::OneShotTimer count_report_;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PAGE_PRIVACY_H_
