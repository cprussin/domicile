// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_url_loader_factory.h"

#include <string>
#include <utility>

#include "base/containers/span.h"
#include "base/files/file_util.h"
#include "base/logging.h"
#include "base/strings/escape.h"
#include "base/strings/strcat.h"
#include "mojo/public/cpp/system/data_pipe.h"
#include "components/domicile/browser/desk_lock.h"
#include "components/domicile/browser/shell_source.h"
#include "components/domicile/common/domicile_scheme.h"
#include "content/public/browser/file_url_loader.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "net/base/filename_util.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "url/gurl.h"

namespace domicile {

namespace {

// Resolves a domicile:// URL for `host` to a file under `root`. Returns false
// if the URL does not resolve inside `root`. Shared by the shell and home
// hosts.
bool ResolveUnder(const base::FilePath& root,
                  const char* host,
                  bool refuse_dotfiles,
                  const GURL& url,
                  base::FilePath* out_path) {
  // Empty when the engine started without --domicile-shell-root or a home.
  if (root.empty()) {
    return false;
  }
  if (!url.is_valid() || !url.SchemeIs(kDomicileScheme)) {
    return false;
  }
  // Each root serves only its own host.
  if (url.host() != host) {
    return false;
  }

  // Decode fully before the checks below, so "%2e%2e%2f" is seen as "../" and
  // "%00" as NUL. UnescapeBinaryURLComponent leaves nothing escaped.
  std::string path = base::UnescapeBinaryURLComponent(
      url.path(), base::UnescapeRule::NORMAL);

  // A NUL would truncate the filename, so "index.html%00.png" could open a
  // different file than it names.
  if (path.find('\0') != std::string::npos) {
    return false;
  }

  // Strip the leading separator so the path appends to the root instead of
  // replacing it.
  while (!path.empty() && path.front() == '/') {
    path.erase(0, 1);
  }
  // No index fallback: CreateLoaderAndStart serves the bare root itself.
  if (path.empty()) {
    return false;
  }

  base::FilePath relative = base::FilePath::FromUTF8Unsafe(path);
  if (relative.IsAbsolute() || relative.ReferencesParent()) {
    return false;
  }
  // Runs after decoding, so `%2essh` is seen as `.ssh`.
  if (refuse_dotfiles) {
    for (const std::string& component : relative.GetComponents()) {
      if (!component.empty() && component.front() == '.') {
        return false;
      }
    }
  }

  base::FilePath candidate = root.Append(relative);

  // Final check on the result, independent of the checks above.
  if (!root.IsParent(candidate)) {
    return false;
  }

  *out_path = std::move(candidate);
  return true;
}

}  // namespace

// static
bool ShellURLLoaderFactory::ResolveShellPath(const base::FilePath& shell_root,
                                            const GURL& url,
                                            base::FilePath* out_path) {
  return ResolveUnder(shell_root, kDomicileShellHost,
                      /*refuse_dotfiles=*/false, url, out_path);
}

// static
bool ShellURLLoaderFactory::ResolveHomePath(const base::FilePath& home,
                                           const GURL& url,
                                           base::FilePath* out_path) {
  return ResolveUnder(home, kDomicileHomeHost, /*refuse_dotfiles=*/true, url,
                      out_path);
}

// static
bool ShellURLLoaderFactory::MayReadHome(
    const std::optional<url::Origin>& initiator,
    bool desk_locked) {
  return !desk_locked && initiator.has_value() &&
         initiator->scheme() == kDomicileScheme &&
         initiator->host() == kDomicileShellHost;
}


// static
std::string ShellURLLoaderFactory::ShellDocument(const std::string& module) {
  // The fixed document every shell loads into. It holds only what a desktop
  // needs:
  //
  //   - a charset
  //   - a viewport, so layout and compositor coordinates share a scale
  //   - a full-window root with no margin, so the page and compositor agree on
  //     where windows are
  //
  // The shell's CSS comes from its module, so nothing paints before it runs.
  //
  // The module is named in a `domicile-shell-module` meta element. Blink's
  // DomicileShell loads it after the body is parsed and calls its `Shell`
  // export; see DomicileShell, which also reports load failures.
  //
  // The module name comes from disk and goes into the most privileged page.
  // EscapeAllExceptUnreserved makes it safe in a quoted attribute and encodes
  // `#`, `?` and `%` so they stay part of the filename.
  //
  // The body stays empty with no ids: every name in this document is in the
  // shell's namespace and could collide with the shell's own lookups.
  const std::string escaped = base::EscapeAllExceptUnreserved(module);
  return base::StrCat({
      "<!doctype html>\n"
      "<html lang=\"en\">\n"
      "  <head>\n"
      "    <meta charset=\"utf-8\" />\n"
      "    <meta content=\"width=device-width, initial-scale=1\" "
      "name=\"viewport\" />\n"
      "    <meta content=\"./",
      escaped,
      "\" name=\"domicile-shell-module\" />\n"
      "    <title>Domicile</title>\n"
      "    <style>\n"
      "      html,\n"
      "      body {\n"
      "        block-size: 100%;\n"
      "        inline-size: 100%;\n"
      "        margin: 0;\n"
      "        overflow: hidden;\n"
      "        padding: 0;\n"
      "      }\n"
      "    </style>\n"
      "  </head>\n"
      "  <body></body>\n"
      "</html>\n"});
}

void ShellURLLoaderFactory::ServeDocument(
    mojo::PendingRemote<network::mojom::URLLoaderClient> client) {
  mojo::Remote<network::mojom::URLLoaderClient> client_remote(
      std::move(client));

  // Read per request so a reload serves whatever `domicile load-shell` last
  // set. ShellSource starts with the command-line values.
  const std::string module = ShellSource::Get().Module();
  if (module.empty()) {
    // Fail instead of serving an empty page that looks like a broken shell.
    LOG(ERROR) << "domicile: the engine was started without --"
               << kDomicileShellModuleSwitch
               << ", so there is no shell to load.";
    client_remote->OnComplete(
        network::URLLoaderCompletionStatus(net::ERR_INVALID_ARGUMENT));
    return;
  }

  const std::string document = ShellDocument(module);

  auto response = network::mojom::URLResponseHead::New();
  response->mime_type = "text/html";
  response->charset = "utf-8";

  mojo::ScopedDataPipeProducerHandle producer;
  mojo::ScopedDataPipeConsumerHandle consumer;
  if (mojo::CreateDataPipe(document.size(), producer, consumer) !=
      MOJO_RESULT_OK) {
    client_remote->OnComplete(
        network::URLLoaderCompletionStatus(net::ERR_INSUFFICIENT_RESOURCES));
    return;
  }

  size_t written = 0;
  const MojoResult result =
      producer->WriteData(base::as_byte_span(document),
                          MOJO_WRITE_DATA_FLAG_NONE, written);
  if (result != MOJO_RESULT_OK || written != document.size()) {
    client_remote->OnComplete(
        network::URLLoaderCompletionStatus(net::ERR_FAILED));
    return;
  }
  producer.reset();

  client_remote->OnReceiveResponse(std::move(response), std::move(consumer),
                                   std::nullopt);
  client_remote->OnComplete(network::URLLoaderCompletionStatus(net::OK));
}

ShellURLLoaderFactory::ShellURLLoaderFactory(
    mojo::PendingReceiver<network::mojom::URLLoaderFactory> factory_receiver,
    const base::FilePath& shell_root,
    const base::FilePath& home,
    base::SelfDeletingPassKey key)
    : network::SelfDeletingURLLoaderFactory(std::move(factory_receiver), key),
      shell_root_(shell_root),
      home_(home) {}

ShellURLLoaderFactory::~ShellURLLoaderFactory() = default;

void ShellURLLoaderFactory::CreateLoaderAndStart(
    mojo::PendingReceiver<network::mojom::URLLoader> loader,
    int32_t request_id,
    uint32_t options,
    const network::ResourceRequest& request,
    mojo::PendingRemote<network::mojom::URLLoaderClient> client,
    const net::MutableNetworkTrafficAnnotationTag& traffic_annotation) {
  const bool home = request.url.host() == kDomicileHomeHost;
  // The bare root is the generated document; only the module and its imports
  // come from disk.
  if (!home && (request.url.path() == "/" || request.url.path().empty())) {
    ServeDocument(std::move(client));
    return;
  }

  base::FilePath path;
  const bool resolved =
      home ? MayReadHome(request.request_initiator, DeskLock::IsLocked()) &&
                 ResolveHomePath(home_, request.url, &path)
           : ResolveShellPath(shell_root_, request.url, &path);
  if (!resolved) {
    mojo::Remote<network::mojom::URLLoaderClient> client_remote(
        std::move(client));
    client_remote->OnComplete(
        network::URLLoaderCompletionStatus(net::ERR_INVALID_URL));
    return;
  }

  // Skipping file: URL policy is safe: this was never a file: URL, and the
  // checks above already confined it to the root.
  network::ResourceRequest file_request = request;
  file_request.url = net::FilePathToFileURL(path);
  content::CreateFileURLLoaderBypassingSecurityChecks(
      file_request, std::move(loader), std::move(client),
      /*observer=*/nullptr,
      // A listing would expose the tree's layout.
      /*allow_directory_listing=*/false);
}

// static
mojo::PendingRemote<network::mojom::URLLoaderFactory>
ShellURLLoaderFactory::Create(const base::FilePath& shell_root) {
  mojo::PendingRemote<network::mojom::URLLoaderFactory> pending_remote;
  base::MakeSelfDeleting<ShellURLLoaderFactory>(
      pending_remote.InitWithNewPipeAndPassReceiver(), shell_root,
      base::GetHomeDir());
  return pending_remote;
}

}  // namespace domicile
