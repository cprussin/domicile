// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_cast_sinks.h"

#include <limits>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/time/time.h"
#include "chrome/browser/media/router/media_router_feature.h"
#include "components/media_router/browser/media_router.h"
#include "components/media_router/browser/media_router_factory.h"
#include "components/media_router/browser/media_routes_observer.h"
#include "components/media_router/browser/media_sinks_observer.h"
#include "components/media_router/common/media_route.h"
#include "components/media_router/common/media_sink.h"
#include "components/media_router/common/media_source.h"
#include "components/media_router/common/route_request_result.h"
#include "content/public/browser/desktop_media_id.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "url/origin.h"

namespace domicile {

namespace {

// As long as Chrome's Cast dialog gives a desktop cast: the TV may show a
// prompt first.
constexpr base::TimeDelta kCastTimeout = base::Seconds(60);

// The desktop, whose picture the capture asks the ScreenCast portal for (patch
// 0128), and its sound. The shell answers that request, so it picks what the
// TV shows. A chosen desktop, so the Media Router shows no picker of its own
// (patch 0141).
//
// A new screen id each cast. webrtc's PipeWire capturer keeps the portal's
// restore token under the id it was given and hands it back next time, so
// one id would recast the first pick without asking the shell. Ids count down
// from the top, clear of the ones webrtc's RestoreTokenManager counts up from
// 1.
media_router::MediaSource::Id DesktopSource() {
  static content::DesktopMediaID::Id next =
      std::numeric_limits<content::DesktopMediaID::Id>::max();
  const content::DesktopMediaID screen(content::DesktopMediaID::TYPE_SCREEN,
                                       next--);
  return media_router::MediaSource::ForDesktop(screen.ToString(),
                                               /*with_audio=*/true)
      .id();
}

// The TVs and the routes to them for one shell document. A DocumentService
// like BrowserWindows, so a reloaded shell binds a new one and gets the list
// again.
class CastSinksService final
    : public content::DocumentService<mojom::CastSinks> {
 public:
  CastSinksService(content::RenderFrameHost& frame,
                   mojo::PendingReceiver<mojom::CastSinks> receiver)
      : DocumentService(frame, std::move(receiver)),
        router_(media_router::MediaRouterEnabled(frame.GetBrowserContext())
                    ? media_router::MediaRouterFactory::
                          GetApiForBrowserContext(frame.GetBrowserContext())
                    : nullptr) {}

 private:
  // The TVs that can show a desktop.
  class Sinks final : public media_router::MediaSinksObserver {
   public:
    Sinks(media_router::MediaRouter* router, CastSinksService* service)
        : MediaSinksObserver(router,
                             media_router::MediaSource::ForUnchosenDesktop(),
                             url::Origin()),
          service_(service) {}

   private:
    void OnSinksReceived(
        const std::vector<media_router::MediaSink>& sinks) override {
      service_->found_ = sinks;
      service_->Send();
    }

    const raw_ptr<CastSinksService> service_;
  };

  // The routes, for the TV each casts to.
  class Routes final : public media_router::MediaRoutesObserver {
   public:
    Routes(media_router::MediaRouter* router, CastSinksService* service)
        : MediaRoutesObserver(router), service_(service) {}

   private:
    void OnRoutesUpdated(
        const std::vector<media_router::MediaRoute>& routes) override {
      service_->routes_.clear();
      for (const media_router::MediaRoute& route : routes) {
        // Only this browser's: another sender's cast is not the shell's to
        // stop.
        if (route.is_local()) {
          service_->routes_[route.media_sink_id()] = route.media_route_id();
        }
      }
      service_->Send();
    }

    const raw_ptr<CastSinksService> service_;
  };

  // mojom::CastSinks:
  void SetClient(mojo::PendingRemote<mojom::CastSinksClient> client) override {
    if (client_.is_bound()) {
      ReportBadMessageAndDeleteThis(
          "domicile: the TVs have one client per document.");
      return;
    }
    client_.Bind(std::move(client));
    if (router_ != nullptr) {
      sinks_ = std::make_unique<Sinks>(router_, this);
      sinks_->Init();
      routes_observer_ = std::make_unique<Routes>(router_, this);
      // What opening Chrome's Cast dialog does: start discovery, or look again.
      router_->OnUserGesture();
    }
    Send();
  }

  void Cast(const std::string& id, CastCallback callback) override {
    if (router_ == nullptr) {
      std::move(callback).Run(std::string(), "Casting is off in this profile");
      return;
    }
    router_->CreateRoute(
        DesktopSource(), id, url::Origin(),
        content::WebContents::FromRenderFrameHost(&render_frame_host()),
        base::BindOnce(
            [](CastCallback callback,
               media_router::mojom::RoutePresentationConnectionPtr,
               const media_router::RouteRequestResult& result) {
              if (result.route() != nullptr) {
                std::move(callback).Run(result.route()->media_route_id(),
                                        std::string());
              } else {
                std::move(callback).Run(
                    std::string(), result.error().empty()
                                       ? "The TV did not take the cast"
                                       : result.error());
              }
            },
            std::move(callback)),
        kCastTimeout);
  }

  void Stop(const std::string& route) override {
    if (router_ != nullptr) {
      router_->TerminateRoute(route);
    }
  }

  void Send() {
    if (!client_.is_bound()) {
      return;
    }
    std::vector<mojom::CastSinkPtr> listed;
    listed.reserve(found_.size());
    for (const media_router::MediaSink& sink : found_) {
      const auto route = routes_.find(sink.id());
      listed.push_back(mojom::CastSink::New(
          sink.id(), sink.name(),
          route == routes_.end() ? std::string() : route->second));
    }
    client_->SinksChanged(std::move(listed));
  }

  // Null when the profile turns the Media Router off: the list stays empty.
  const raw_ptr<media_router::MediaRouter> router_;
  mojo::Remote<mojom::CastSinksClient> client_;
  std::vector<media_router::MediaSink> found_;
  // Each TV's route from this browser, by the TV's id.
  std::map<media_router::MediaSink::Id, media_router::MediaRoute::Id> routes_;
  // Last, so they stop observing before the state they write goes.
  std::unique_ptr<Sinks> sinks_;
  std::unique_ptr<Routes> routes_observer_;
};

}  // namespace

void BindCastSinks(content::RenderFrameHost* frame,
                   mojo::PendingReceiver<mojom::CastSinks> receiver) {
  // Owns itself and dies with the document, like every DocumentService.
  new CastSinksService(*frame, std::move(receiver));
}

}  // namespace domicile
