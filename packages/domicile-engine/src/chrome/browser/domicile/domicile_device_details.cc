// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_device_details.h"

#include <array>
#include <cstdint>
#include <memory>
#include <string>

#include "base/containers/span.h"
#include "base/logging.h"
#include "base/numerics/byte_conversions.h"
#include "base/supports_user_data.h"
#include "chrome/browser/domicile/domicile_electron_page.h"
#include "components/domicile/browser/page_privacy.h"
#include "components/domicile/browser/site_privacy.h"
#include "components/domicile/mojom/device_details.mojom.h"
#include "components/prefs/pref_service.h"
#include "components/user_prefs/user_prefs.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "crypto/hmac.h"
#include "crypto/random.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "url/gurl.h"

namespace domicile {

namespace {

// A profile's key for the session, which every site's seed comes from. On
// the BrowserContext, so it goes with it, and an off-the-record profile has
// its own.
class SessionKey final : public base::SupportsUserData::Data {
 public:
  static const SessionKey& Of(content::BrowserContext& context) {
    static const char kKey = 0;
    auto* key = static_cast<SessionKey*>(context.GetUserData(&kKey));
    if (key == nullptr) {
      auto made = std::make_unique<SessionKey>();
      key = made.get();
      context.SetUserData(&kKey, std::move(made));
    }
    return *key;
  }

  SessionKey() : bytes_(crypto::RandBytesAsArray<32>()) {}

  // `site`'s seed: the first 8 bytes of its HMAC under the key.
  uint64_t SeedFor(const std::string& site) const {
    const auto mac =
        crypto::hmac::SignSha256(bytes_, base::as_byte_span(site));
    return base::U64FromNativeEndian(base::span(mac).first<8>());
  }

 private:
  const std::array<uint8_t, 32> bytes_;
};

// Sends each website frame of one guest its seed before it commits. See
// AttachDeviceDetailsHiding.
class DeviceDetailsHiding final
    : public content::WebContentsObserver,
      public content::WebContentsUserData<DeviceDetailsHiding> {
 public:
  DeviceDetailsHiding(const DeviceDetailsHiding&) = delete;
  DeviceDetailsHiding& operator=(const DeviceDetailsHiding&) = delete;
  ~DeviceDetailsHiding() override = default;

  // content::WebContentsObserver:
  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override {
    if (navigation->IsSameDocument() || navigation->IsErrorPage()) {
      return;
    }
    // A prerendered or fenced page is not the window's yet.
    if (navigation->IsInMainFrame() && !navigation->IsInPrimaryMainFrame()) {
      return;
    }
    if (!navigation->GetURL().SchemeIsHTTPOrHTTPS()) {
      return;
    }
    content::WebContents& contents = GetWebContents();
    // An app may take a window over after it was attached.
    if (ElectronPage::SessionOf(contents)) {
      return;
    }
    content::BrowserContext& context = *contents.GetBrowserContext();
    if (!user_prefs::UserPrefs::Get(&context)->GetBoolean(
            kHideDeviceDetailsPref)) {
      return;
    }
    // The page's top site: a frame in it is seen as its page is, so one
    // site's frame in two others' pages can't tell them apart from it.
    const GURL& page =
        navigation->IsInPrimaryMainFrame()
            ? navigation->GetURL()
            : contents.GetPrimaryMainFrame()->GetLastCommittedURL();
    const std::string site = PrivacySiteOf(page);
    if (site.empty()) {
      return;
    }
    PagePrivacy::CreateForWebContents(&contents);
    const PagePrivacy& privacy = *PagePrivacy::FromWebContents(&contents);
    const AdBlockingMode mode = navigation->IsInPrimaryMainFrame()
                                    ? privacy.ModeFor(page)
                                    : privacy.mode();
    // Protections off for the site or the window are all off.
    if (mode == AdBlockingMode::kOff) {
      return;
    }
    VLOG(1) << "domicile: device details: hidden from "
            << navigation->GetURL().possibly_invalid_spec() << " as "
            << site;
    mojo::AssociatedRemote<mojom::DeviceDetails> frame;
    navigation->GetRenderFrameHost()
        ->GetRemoteAssociatedInterfaces()
        ->GetInterface(&frame);
    frame->Hide(SessionKey::Of(context).SeedFor(site));
  }

 private:
  friend class content::WebContentsUserData<DeviceDetailsHiding>;
  explicit DeviceDetailsHiding(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<DeviceDetailsHiding>(*contents) {}

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(DeviceDetailsHiding);

}  // namespace

void AttachDeviceDetailsHiding(content::WebContents& guest) {
  DeviceDetailsHiding::CreateForWebContents(&guest);
}

}  // namespace domicile
