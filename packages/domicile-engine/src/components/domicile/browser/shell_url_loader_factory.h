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
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {

// Serves `domicile://shell/...` out of a directory on disk, and
// `domicile://home/...` out of the user's home for the shell's previews.
//
// This is the half of the scheme that reads bytes; registering the scheme so it
// has an origin is the other half, and lives in the content client. Modeled on
// content::AboutURLLoaderFactory for its lifetime and on
// content::CreateFileURLLoaderBypassingSecurityChecks for the reading, because
// the reading is the same reading -- the file-handling in
// FileURLLoaderFactory, ContentURLLoaderFactory and ExtensionURLLoaderFactory
// is already three copies of it, and this does not add a fourth.
//
// The security property is the whole point and it is narrow: a request is
// answered only if it names the one host and resolves to a path inside the
// shell root. Nothing else on the machine is reachable through it, and no page
// that is not the shell can ask -- the scheme is not web-safe, so ordinary web
// content cannot navigate to or fetch it at all.
class ShellURLLoaderFactory : public network::SelfDeletingURLLoaderFactory {
 public:
  // A self-owned factory serving `shell_root`. Deletes itself once every
  // receiver disconnects. An empty `shell_root` yields a factory that refuses
  // everything, which is what should happen when the engine was started without
  // --domicile-shell-root: there is no shell to serve, and guessing a directory
  // would be worse than saying so.
  static mojo::PendingRemote<network::mojom::URLLoaderFactory> Create(
      const base::FilePath& shell_root);

  ShellURLLoaderFactory(
      mojo::PendingReceiver<network::mojom::URLLoaderFactory> factory_receiver,
      const base::FilePath& shell_root,
      const base::FilePath& home,
      base::SelfDeletingPassKey key);

  ShellURLLoaderFactory(const ShellURLLoaderFactory&) = delete;
  ShellURLLoaderFactory& operator=(const ShellURLLoaderFactory&) = delete;

  // The document Domicile writes for a shell, given the module it should load.
  // Exposed for testing: what is in it is not negotiable and a test is how that
  // stays true.
  static std::string ShellDocument(const std::string& module);

  // Resolve a domicile:// URL to a file under `shell_root`, or fail. Exposed
  // for testing, because the refusals are the part worth testing and they do
  // not need a mojo pipe to exercise.
  static bool ResolveShellPath(const base::FilePath& shell_root,
                               const GURL& url,
                               base::FilePath* out_path);

  // Resolve a domicile://home/ URL to a file under `home`, or fail. The same
  // containment as the shell's, and one refusal more: no path with a dotfile
  // anywhere in it, which is the line the compositor's file index draws, and
  // what keeps ~/.ssh and every token under ~/.config out of reach.
  static bool ResolveHomePath(const base::FilePath& home,
                              const GURL& url,
                              base::FilePath* out_path);

  // Whether a request from `initiator` may read the home. Only the shell's own
  // document: this factory is every frame's -- a site in a <webview> too --
  // and a site that could name domicile://home/ in an <img> would learn which
  // files exist from load and error alone. And never while the desk is
  // locked, which is the compositor's rule for its own reads of the home.
  static bool MayReadHome(const std::optional<url::Origin>& initiator,
                          bool desk_locked);

 private:
  ~ShellURLLoaderFactory() override;

  // Answer with the generated document rather than a file on disk.
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
