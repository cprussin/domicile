// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/page_privacy.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/time/time.h"
#include "components/domicile/browser/site_privacy.h"
#include "components/prefs/pref_service.h"
#include "components/user_prefs/user_prefs.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"

namespace domicile {
namespace {

// How often a page's count is reported at most: a page that loads a hundred
// ads sends a few messages, not a hundred.
constexpr base::TimeDelta kCountEvery = base::Milliseconds(250);

}  // namespace

PagePrivacy::PagePrivacy(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<PagePrivacy>(*contents) {
  watched_.Init(&prefs());
  // Another window, or Settings, may change the site's or the profile's.
  watched_.Add(kSiteAdBlockingPref, base::BindRepeating(&PagePrivacy::Changed,
                                               base::Unretained(this)));
  watched_.Add(kProfileAdBlockingPref, base::BindRepeating(&PagePrivacy::Changed,
                                                 base::Unretained(this)));
  for (const char* pref : {kSiteProtectionsPref, kHideDeviceDetailsPref,
                           kRemoveLinkTrackingPref, kHideCookieBannersPref}) {
    watched_.Add(pref, base::BindRepeating(&PagePrivacy::Changed,
                                           base::Unretained(this)));
  }
}

PagePrivacy::~PagePrivacy() = default;

PrefService& PagePrivacy::prefs() const {
  return *user_prefs::UserPrefs::Get(
      web_contents()->GetBrowserContext());
}

std::string PagePrivacy::site() const {
  return PrivacySiteOf(
      GetWebContents().GetPrimaryMainFrame()->GetLastCommittedURL());
}

AdBlockingMode PagePrivacy::mode() const {
  return ModeFor(GetWebContents().GetPrimaryMainFrame()->GetLastCommittedURL());
}

AdBlockingMode PagePrivacy::ModeFor(const GURL& page) const {
  if (window_.has_value()) {
    return *window_;
  }
  const std::string page_site = PrivacySiteOf(page);
  if (!page_site.empty()) {
    if (const std::optional<AdBlockingMode> mode =
            SiteAdBlocking(prefs(), page_site)) {
      return *mode;
    }
  }
  return ProfileAdBlocking(prefs());
}

AdBlockingSetFor PagePrivacy::set_for() const {
  if (window_.has_value()) {
    return AdBlockingSetFor::kWindow;
  }
  const std::string page_site = site();
  if (!page_site.empty() && SiteAdBlocking(prefs(), page_site).has_value()) {
    return AdBlockingSetFor::kSite;
  }
  return AdBlockingSetFor::kProfile;
}

bool PagePrivacy::IsOn(PageProtection protection) const {
  return IsOnFor(protection,
                 GetWebContents().GetPrimaryMainFrame()->GetLastCommittedURL());
}

bool PagePrivacy::IsOnFor(PageProtection protection, const GURL& page) const {
  // Protections off for the page are all off, whatever each one says.
  if (ModeFor(page) == AdBlockingMode::kOff) {
    return false;
  }
  if (const auto own = window_protections_.find(protection);
      own != window_protections_.end()) {
    return own->second;
  }
  const std::string page_site = PrivacySiteOf(page);
  if (!page_site.empty()) {
    if (const std::optional<bool> on =
            SiteProtection(prefs(), page_site, protection)) {
      return *on;
    }
  }
  return ProfileProtection(prefs(), protection);
}

AdBlockingSetFor PagePrivacy::SetFor(PageProtection protection) const {
  if (window_protections_.contains(protection)) {
    return AdBlockingSetFor::kWindow;
  }
  const std::string page_site = site();
  if (!page_site.empty() &&
      SiteProtection(prefs(), page_site, protection).has_value()) {
    return AdBlockingSetFor::kSite;
  }
  return AdBlockingSetFor::kProfile;
}

void PagePrivacy::SetForWindow(PageProtection protection,
                               std::optional<bool> on) {
  if (on.has_value()) {
    window_protections_[protection] = *on;
  } else {
    window_protections_.erase(protection);
  }
  Changed();
}

void PagePrivacy::CountBlocked() {
  ++blocked_;
  if (!count_report_.IsRunning()) {
    count_report_.Start(FROM_HERE, kCountEvery,
                        base::BindOnce(&PagePrivacy::Changed,
                                       base::Unretained(this)));
  }
}

void PagePrivacy::SetForWindow(std::optional<AdBlockingMode> mode) {
  window_ = mode;
  Changed();
}

void PagePrivacy::OnChanged(base::RepeatingClosure changed) {
  changed_ = std::move(changed);
}

void PagePrivacy::PrimaryPageChanged(content::Page& page) {
  blocked_ = 0;
  count_report_.Stop();
  Changed();
}

void PagePrivacy::Changed() {
  if (changed_) {
    changed_.Run();
  }
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(PagePrivacy);

}  // namespace domicile
