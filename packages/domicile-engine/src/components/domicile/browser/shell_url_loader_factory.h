// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_URL_LOADER_FACTORY_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_URL_LOADER_FACTORY_H_

#include <optional>
#include <string>

#include "base/files/file_path.h"
#include "base/memory/self_deleting.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {

// Serves `domicile://shell/...` out of a directory on disk, and
// `domicile://home/...` out of the user's home for the shell's previews.
//
// The content client registers the scheme. Lifetime follows
// content::AboutURLLoaderFactory; file reading reuses
// content::CreateFileURLLoaderBypassingSecurityChecks.
//
// A request is served only if it names a known host and resolves inside that
// host's root. The scheme is not web-safe, so web content cannot reach it.
class ShellURLLoaderFactory : public network::SelfDeletingURLLoaderFactory {
 public:
  // A self-owned factory serving `shell_root`. Deletes itself once every
  // receiver disconnects. An empty `shell_root` refuses every request.
  static mojo::PendingRemote<network::mojom::URLLoaderFactory> Create(
      const base::FilePath& shell_root);

  ShellURLLoaderFactory(
      mojo::PendingReceiver<network::mojom::URLLoaderFactory> factory_receiver,
      const base::FilePath& shell_root,
      const base::FilePath& home,
      base::SelfDeletingPassKey key);

  ShellURLLoaderFactory(const ShellURLLoaderFactory&) = delete;
  ShellURLLoaderFactory& operator=(const ShellURLLoaderFactory&) = delete;

  // The HTML document that loads the shell's `module`. Exposed for testing.
  static std::string ShellDocument(const std::string& module);

  // The response head ShellDocument is served with. Exposed for testing.
  static network::mojom::URLResponseHeadPtr ShellDocumentHead();

  // Resolves a domicile:// URL to a file under `shell_root`, or fails. Exposed
  // for testing.
  static bool ResolveShellPath(const base::FilePath& shell_root,
                               const GURL& url,
                               base::FilePath* out_path);

  // Resolves a domicile://home/ URL to a file under `home`, or fails. Also
  // refuses any path containing a dotfile, matching the compositor's file
  // index, so ~/.ssh and ~/.config stay unreachable.
  static bool ResolveHomePath(const base::FilePath& home,
                              const GURL& url,
                              base::FilePath* out_path);

  // Whether a request from `initiator` may read the home: only the shell
  // origin, and never while the desk is locked. Every frame, including sites
  // in a <webview>, uses this factory, and a site could probe which files
  // exist from load errors.
  static bool MayReadHome(const std::optional<url::Origin>& initiator,
                          bool desk_locked);

 private:
  ~ShellURLLoaderFactory() override;

  // Responds with the generated shell document.
  void ServeDocument(
      mojo::PendingRemote<network::mojom::URLLoaderClient> client);

  // network::mojom::URLLoaderFactory:
  void CreateLoaderAndStart(
      mojo::PendingReceiver<network::mojom::URLLoader> loader,
      int32_t request_id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& traffic_annotation)
      override;

  const base::FilePath shell_root_;
  const base::FilePath home_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_URL_LOADER_FACTORY_H_
