// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_URL_LOADER_FACTORY_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_URL_LOADER_FACTORY_H_

#include "base/files/file_path.h"
#include "base/memory/self_deleting.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"

namespace domicile {

// Serves `domicile://shell/...` out of a directory on disk.
//
// This is the half of the scheme that reads bytes; registering the scheme so it
// has an origin is the other half, and lives in the content client. Modelled on
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
      base::SelfDeletingPassKey key,
      const base::FilePath& shell_root);

  ShellURLLoaderFactory(const ShellURLLoaderFactory&) = delete;
  ShellURLLoaderFactory& operator=(const ShellURLLoaderFactory&) = delete;

  // Resolve a domicile:// URL to a file under `shell_root`, or fail. Exposed
  // for testing, because the refusals are the part worth testing and they do
  // not need a mojo pipe to exercise.
  static bool ResolveShellPath(const base::FilePath& shell_root,
                               const GURL& url,
                               base::FilePath* out_path);

 private:
  ~ShellURLLoaderFactory() override;

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
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_URL_LOADER_FACTORY_H_
