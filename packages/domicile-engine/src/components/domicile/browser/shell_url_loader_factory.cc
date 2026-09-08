// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_url_loader_factory.h"

#include <string>
#include <utility>

#include "base/strings/escape.h"
#include "components/domicile/common/domicile_scheme.h"
#include "content/public/browser/file_url_loader.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/filename_util.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"

namespace domicile {

// static
bool ShellURLLoaderFactory::ResolveShellPath(const base::FilePath& shell_root,
                                            const GURL& url,
                                            base::FilePath* out_path) {
  // No root means the engine was started without --domicile-shell-root. There
  // is nothing to serve and no sensible guess to make.
  if (shell_root.empty()) {
    return false;
  }
  if (!url.is_valid() || !url.SchemeIs(kDomicileScheme)) {
    return false;
  }
  // One host. A URL naming any other is refused rather than mapped, so the
  // scheme cannot grow a second meaning by accident.
  if (url.host_piece() != kDomicileShellHost) {
    return false;
  }

  // Percent-decoding happens here rather than in the path arithmetic below,
  // because "%2e%2e%2f" has to be ".." *before* ReferencesParent() is asked
  // about it, or the check reads an escape and sees nothing wrong.
  std::string path = base::UnescapeBinaryURLComponent(
      url.path_piece(), base::UnescapeRule::PATH_SEPARATORS |
                            base::UnescapeRule::URL_SPECIAL_CHARS_EXCEPT_PATH_SEPARATORS);

  // A NUL in the decoded path would truncate the name the filesystem is asked
  // for, so a request for "index.html%00.png" could reach a different file than
  // the one it appears to name.
  if (path.find('\0') != std::string::npos) {
    return false;
  }

  // GURL always gives an absolute path for a standard scheme. Strip the leading
  // separator so this is appended to the root rather than replacing it.
  while (!path.empty() && path.front() == '/') {
    path.erase(0, 1);
  }
  if (path.empty()) {
    path = kDomicileShellIndex;
  }

  base::FilePath relative = base::FilePath::FromUTF8Unsafe(path);
  if (relative.IsAbsolute() || relative.ReferencesParent()) {
    return false;
  }

  base::FilePath candidate = shell_root.Append(relative);

  // The belt to the braces above: whatever the path arithmetic did, the answer
  // has to be inside the root. This is what makes the refusals a property of
  // the result rather than of the cleverness of the checks before it.
  if (!shell_root.IsParent(candidate)) {
    return false;
  }

  *out_path = std::move(candidate);
  return true;
}

ShellURLLoaderFactory::ShellURLLoaderFactory(
    mojo::PendingReceiver<network::mojom::URLLoaderFactory> factory_receiver,
    base::SelfDeletingPassKey key,
    const base::FilePath& shell_root)
    : network::SelfDeletingURLLoaderFactory(std::move(factory_receiver), key),
      shell_root_(shell_root) {}

ShellURLLoaderFactory::~ShellURLLoaderFactory() = default;

void ShellURLLoaderFactory::CreateLoaderAndStart(
    mojo::PendingReceiver<network::mojom::URLLoader> loader,
    int32_t request_id,
    uint32_t options,
    const network::ResourceRequest& request,
    mojo::PendingRemote<network::mojom::URLLoaderClient> client,
    const net::MutableNetworkTrafficAnnotationTag& traffic_annotation) {
  base::FilePath path;
  if (!ResolveShellPath(shell_root_, request.url, &path)) {
    mojo::Remote<network::mojom::URLLoaderClient> client_remote(
        std::move(client));
    client_remote->OnComplete(
        network::URLLoaderCompletionStatus(net::ERR_INVALID_URL));
    return;
  }

  // Hand the resolved file to content's file loader. "BypassingSecurityChecks"
  // names the file: URL policy it skips, which is the right thing to skip here:
  // this request never was a file: URL and has already been checked against the
  // only policy that applies to it, which is that it resolve inside the shell
  // root.
  network::ResourceRequest file_request = request;
  file_request.url = net::FilePathToFileURL(path);
  content::CreateFileURLLoaderBypassingSecurityChecks(
      file_request, std::move(loader), std::move(client),
      /*observer=*/nullptr,
      // A shell is a set of files, not a place to browse. A directory URL is a
      // request for something that is not a document, and answering it with a
      // listing would publish the shape of the tree.
      /*allow_directory_listing=*/false);
}

// static
mojo::PendingRemote<network::mojom::URLLoaderFactory>
ShellURLLoaderFactory::Create(const base::FilePath& shell_root) {
  mojo::PendingRemote<network::mojom::URLLoaderFactory> pending_remote;
  base::MakeSelfDeleting<ShellURLLoaderFactory>(
      pending_remote.InitWithNewPipeAndPassReceiver(), shell_root);
  return pending_remote;
}

}  // namespace domicile
