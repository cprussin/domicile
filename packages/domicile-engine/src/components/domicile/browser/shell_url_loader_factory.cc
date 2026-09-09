// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_url_loader_factory.h"

#include <string>
#include <utility>

#include "base/command_line.h"
#include "base/strings/escape.h"
#include "base/strings/strcat.h"
#include "mojo/public/cpp/system/data_pipe.h"
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
  if (url.host() != kDomicileShellHost) {
    return false;
  }

  // Percent-decoding happens here rather than in the path arithmetic below,
  // because "%2e%2e%2f" has to be ".." *before* ReferencesParent() is asked
  // about it, or the check reads an escape and sees nothing wrong.
  // NORMAL is the only rule this function takes besides plus-for-space, and it
  // is the right one anyway: UnescapeBinaryURLComponent "leaves nothing
  // unescaped, including nulls", so %2e%2e%2f really is ".." by the time
  // ReferencesParent() below is asked about it, and %00 really is a NUL by the
  // time it is refused. Anything that decodes less would make both checks read
  // an escape and see nothing wrong.
  std::string path = base::UnescapeBinaryURLComponent(
      url.path(), base::UnescapeRule::NORMAL);

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


// static
std::string ShellURLLoaderFactory::ShellDocument(const std::string& module) {
  // The same page for every shell, on purpose: nothing here is negotiable and
  // there is no way to supply a document of your own. What is in it is only
  // what a desktop cannot do without.
  //
  //   - a charset, because a page without one is decoded by guesswork
  //   - a viewport, because without it the engine lays out for a phone and
  //     every coordinate the compositor is told about is wrong by a scale
  //   - a root that fills the window with no margin. A desktop is the whole
  //     screen; eight pixels of body margin is eight pixels the compositor
  //     believes it has and does not, and a client's window drawn in the wrong
  //     place looks like the seam rather than like a stylesheet
  //
  // No stylesheet link, and that is the interesting omission: a shell's CSS
  // arrives through its module, so nothing paints before the module has run and
  // the themed-flash problem cannot happen.
  //
  // The title is not guessed. The directory a module came out of is as likely
  // to be `dist` as anything a person would recognise, so it says Domicile
  // until the shell says otherwise with document.title.
  //
  // EscapeAllExceptUnreserved on the module name is one escape doing two jobs.
  // The name came off somebody's disk and lands in the most privileged page in
  // this system, so it has to be safe inside a double-quoted attribute *and*
  // still name the file the author meant. The encoding is strictly the stronger
  // answer: its output is unreserved characters and %XX, so no `"`, `<`, `>` or
  // `&` survives it to be parsed as markup. An HTML escaper beside it would
  // never fire -- and would not do the job it looked like it was doing, since
  // `#`, `?` and `%` are legal in a POSIX filename and none is HTML-special.
  return base::StrCat({
      "<!doctype html>\n"
      "<html lang=\"en\">\n"
      "  <head>\n"
      "    <meta charset=\"utf-8\" />\n"
      "    <meta content=\"width=device-width, initial-scale=1\" "
      "name=\"viewport\" />\n"
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
      "  <body>\n"
      "    <script src=\"",
      base::EscapeAllExceptUnreserved(module),
      "\" type=\"module\"></script>\n"
      "  </body>\n"
      "</html>\n"});
}

void ShellURLLoaderFactory::ServeDocument(
    mojo::PendingRemote<network::mojom::URLLoaderClient> client) {
  mojo::Remote<network::mojom::URLLoaderClient> client_remote(
      std::move(client));

  const std::string module =
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
          kDomicileShellModuleSwitch);
  if (module.empty()) {
    // No module is no shell. Failing is the honest answer; a document with an
    // empty src would load, paint nothing, and look like a broken shell rather
    // than like a missing argument.
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
    base::SelfDeletingPassKey key)
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
  // The bare root is the document Domicile writes, not a file on disk. A shell
  // is a module and a page to load it in; only the module and what it imports
  // come off the filesystem.
  if (request.url.path() == "/" || request.url.path().empty()) {
    ServeDocument(std::move(client));
    return;
  }

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
