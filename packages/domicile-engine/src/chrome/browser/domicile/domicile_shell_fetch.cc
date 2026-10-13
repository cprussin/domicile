// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_shell_fetch.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/time/time.h"
#include "components/domicile/browser/desk_lock.h"
#include "components/domicile/browser/shell_fetch.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/isolation_info.h"
#include "net/base/net_errors.h"
#include "net/cookies/canonical_cookie.h"
#include "net/cookies/cookie_options.h"
#include "net/cookies/cookie_partition_key_collection.h"
#include "net/cookies/site_for_cookies.h"
#include "net/http/http_request_headers.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "net/url_request/redirect_info.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/cookie_manager.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {
namespace {

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("domicile_shell_fetch", R"(
      semantics {
        sender: "Domicile shell"
        description:
          "A GET the desktop's shell makes with the profile's cookies, such "
          "as a bar item reading the user's unread mail count."
        trigger: "The shell's own polling, as the user configured it."
        data: "The cookies the profile holds for the address."
        destination: OTHER
      }
      policy {
        cookies_allowed: YES
        cookies_store: "user"
        setting: "Remove the bar item from the shell's config."
        policy_exception_justification: "Not a Chrome feature."
      })");

using FetchCallback = mojom::ShellFetch::FetchCallback;

// One request, from its start to the page's answer. Owns its loader and
// deletes itself once it has answered; the loader always finishes, at the
// latest at kShellFetchTimeout.
class PendingFetch {
 public:
  // GETs `url` as GaiaAuthFetcher does: the profile's cookies for the
  // address's own site. `authorization` is a SAPISIDHASH, or empty. A hashed
  // request follows no redirect, so the hash goes nowhere else.
  static void Start(network::SharedURLLoaderFactory& factory,
                    const GURL& url,
                    std::vector<mojom::ShellFetchHeaderPtr> headers,
                    const std::string& authorization,
                    FetchCallback callback) {
    const url::Origin origin = url::Origin::Create(url);
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = url;
    for (const mojom::ShellFetchHeaderPtr& header : headers) {
      request->headers.SetHeader(header->name, header->value);
    }
    if (!authorization.empty()) {
      request->headers.SetHeader(net::HttpRequestHeaders::kAuthorization,
                                 authorization);
      request->redirect_mode = network::mojom::RedirectMode::kError;
    }
    request->credentials_mode = network::mojom::CredentialsMode::kInclude;
    request->site_for_cookies = net::SiteForCookies::FromOrigin(origin);
    request->trusted_params = network::ResourceRequest::TrustedParams();
    request->trusted_params->isolation_info =
        net::IsolationInfo::CreateForInternalRequest(origin);
    // Deletes itself in Finish().
    PendingFetch* fetch =
        new PendingFetch(std::move(request), std::move(headers),
                         std::move(callback));
    fetch->loader_->DownloadToString(
        &factory,
        base::BindOnce(&PendingFetch::Downloaded, base::Unretained(fetch)),
        kShellFetchMaxBody);
  }

 private:
  PendingFetch(std::unique_ptr<network::ResourceRequest> request,
               std::vector<mojom::ShellFetchHeaderPtr> headers,
               FetchCallback callback)
      : loader_(network::SimpleURLLoader::Create(std::move(request),
                                                 kTrafficAnnotation)),
        headers_(std::move(headers)),
        callback_(std::move(callback)) {
    loader_->SetAllowHttpErrorResults(true);
    loader_->SetTimeoutDuration(kShellFetchTimeout);
    // Unretained: `this` owns the loader that calls it.
    loader_->SetOnRedirectCallback(base::BindRepeating(
        &PendingFetch::Redirected, base::Unretained(this)));
  }

  // Refuses a redirect off https, and drops the page's headers on one that
  // leaves the origin they were written for. See shell_fetch.h.
  void Redirected(const GURL& url_before_redirect,
                  const net::RedirectInfo& redirect_info,
                  const network::mojom::URLResponseHead& /*response_head*/,
                  std::vector<std::string>* removed_headers) {
    std::optional<std::string> refusal =
        ShellFetchRedirectRefusal(redirect_info.new_url);
    if (refusal.has_value()) {
      // Deletes the loader, which the callback may do.
      Finish(nullptr, *refusal);
      return;
    }
    for (std::string& name : ShellFetchHeadersDroppedOnRedirect(
             url_before_redirect, redirect_info.new_url, headers_)) {
      removed_headers->push_back(std::move(name));
    }
  }

  void Downloaded(std::optional<std::string> body) {
    const network::mojom::URLResponseHead* head = loader_->ResponseInfo();
    if (!body.has_value() || head == nullptr || !head->headers) {
      Finish(nullptr, net::ErrorToShortString(loader_->NetError()));
      return;
    }
    // A desk that locked while this was in flight gets nothing.
    if (DeskLock::IsLocked()) {
      Finish(nullptr, "the desk is locked");
      return;
    }
    std::optional<uint16_t> status =
        ShellFetchStatus(head->headers->response_code());
    if (!status.has_value()) {
      Finish(nullptr, "the response has no HTTP status");
      return;
    }
    // The page reads text, and a mojo string to Blink is UTF-8.
    if (!base::IsStringUTF8(*body)) {
      Finish(nullptr, "the response is not UTF-8 text");
      return;
    }
    Finish(mojom::ShellFetchResponse::New(*status, loader_->GetFinalURL(),
                                          std::move(*body)),
           std::string());
  }

  void Finish(mojom::ShellFetchResponsePtr response, const std::string& error) {
    std::move(callback_).Run(std::move(response), error);
    delete this;
  }

  const std::unique_ptr<network::SimpleURLLoader> loader_;
  // The page's headers, for what a redirect drops.
  const std::vector<mojom::ShellFetchHeaderPtr> headers_;
  FetchCallback callback_;
};

// The fetches of one shell document. A DocumentService, so a request the page
// can no longer hear is answered into a closed pipe.
class ShellFetchService final
    : public content::DocumentService<mojom::ShellFetch> {
 public:
  ShellFetchService(content::RenderFrameHost& frame,
                    mojo::PendingReceiver<mojom::ShellFetch> receiver)
      : DocumentService(frame, std::move(receiver)),
        partition_(frame.GetBrowserContext()->GetDefaultStoragePartition()) {}

 private:
  // mojom::ShellFetch:
  void Fetch(const GURL& url,
             std::vector<mojom::ShellFetchHeaderPtr> headers,
             const std::optional<std::string>& sapisid_hash_origin,
             FetchCallback callback) override {
    std::optional<std::string> refusal = ShellFetchRefusal(
        url, headers, sapisid_hash_origin, DeskLock::IsLocked());
    if (refusal.has_value()) {
      std::move(callback).Run(nullptr, *refusal);
      return;
    }
    if (!sapisid_hash_origin.has_value()) {
      PendingFetch::Start(*partition_->GetURLLoaderFactoryForBrowserProcess(),
                          url, std::move(headers), std::string(),
                          std::move(callback));
      return;
    }
    // The cookies the request will carry, so the hash is from the SAPISID
    // the site receives with it.
    partition_->GetCookieManagerForBrowserProcess()->GetCookieList(
        url, net::CookieOptions::MakeAllInclusive(),
        net::CookiePartitionKeyCollection(),
        base::BindOnce(&ShellFetchService::Hash, weak_factory_.GetWeakPtr(),
                       url, std::move(headers), *sapisid_hash_origin,
                       std::move(callback)));
  }

  void Hash(const GURL& url,
            std::vector<mojom::ShellFetchHeaderPtr> headers,
            const std::string& origin,
            FetchCallback callback,
            const net::CookieAccessResultList& cookies,
            const net::CookieAccessResultList& /*excluded*/) {
    std::vector<std::pair<std::string, std::string>> named;
    for (const net::CookieWithAccessResult& cookie : cookies) {
      named.emplace_back(cookie.cookie.Name(), cookie.cookie.Value());
    }
    std::optional<std::string> sapisid = SapisidAmong(named);
    if (!sapisid.has_value()) {
      std::move(callback).Run(
          nullptr, base::StrCat({"no SAPISID cookie is sent to ", url.host()}));
      return;
    }
    PendingFetch::Start(
        *partition_->GetURLLoaderFactoryForBrowserProcess(), url,
        std::move(headers),
        SapisidHash(*sapisid, origin, base::Time::Now().ToTimeT()),
        std::move(callback));
  }

  // Owned by the browser context, which outlives every document in it.
  const raw_ptr<content::StoragePartition> partition_;
  base::WeakPtrFactory<ShellFetchService> weak_factory_{this};
};

}  // namespace

void BindShellFetch(content::RenderFrameHost* frame,
                    mojo::PendingReceiver<mojom::ShellFetch> receiver) {
  // Owns itself and dies with the document, like every DocumentService.
  new ShellFetchService(*frame, std::move(receiver));
}

}  // namespace domicile
