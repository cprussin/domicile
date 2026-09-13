// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_url_loader_factory.h"

#include <string>
#include <utility>

// `LOG` and `as_byte_span` are used below and had never been asked for by name;
// they arrived through base/command_line.h, which the shell source replaces. An
// include this file does not use is not allowed to be what keeps it compiling.
#include "base/containers/span.h"
#include "base/logging.h"
#include "base/strings/escape.h"
#include "base/strings/strcat.h"
#include "mojo/public/cpp/system/data_pipe.h"
#include "components/domicile/browser/shell_source.h"
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
  // No index fallback. The bare root is the document the engine writes, and
  // CreateLoaderAndStart answers it before asking this -- so an empty path
  // reaching here is a URL that resolved to the root some other way, and there
  // is no file it should mean.
  if (path.empty()) {
    return false;
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
  //
  // THE DOCUMENT REPORTS ITS OWN MODULE FAILING, and that is the one thing in
  // here that is not about laying a shell out. A module that 404s, will not
  // parse, or throws on its first line leaves this page blank and completely
  // silent: the engine served exactly what it was asked for, so it logs
  // nothing; the compositor is waiting for a page that will never say hello, so
  // it knows only that it is waiting; and the shell never ran, so it cannot
  // report either. A blank window with nothing anywhere was the symptom of four
  // separate startup bugs, and a day went into telling them apart by hand.
  //
  // Three listeners, because they are three different failures and none of them
  // reports the others: the element's own `error` for a module that did not load
  // (which covers a static import of a file that is not there, and a parse
  // error), `error` on the window for one that threw while it ran, and
  // `unhandledrejection` for one whose top-level await rejected.
  //
  // GATED ON `ran`, WHICH IS THE HALF THAT KEEPS THIS HARMLESS. The element's
  // `load` fires when the module has finished evaluating, so after that the page
  // belongs to the shell: a shell that throws an hour later is the shell's own
  // error to handle, and a full-screen report painted over a working desktop
  // would be worse than the blank window this exists to replace.
  //
  // Said on the screen as well as on the console. `--app` is the whole point of
  // the window, so there is no tab strip to open devtools from and nobody is
  // looking at a console. `textContent` rather than markup, because the text
  // has a filename and an exception message in it, both from outside.
  //
  // AND IT ADDS NO NAME TO THE DOCUMENT, WHICH IS NOT FASTIDIOUSNESS. The first
  // version of this found the module script by an id -- `domicile-shell` --
  // and `shell-manganese`'s `mountPoint` looks up that exact id to decide
  // whether it has already made its mount point. It picked the name for the
  // same obvious reason this did. So it found the script tag, React mounted the
  // whole desktop inside a <script>, and a <script> is `display: none`: the
  // shell connected, embedded its window and logged its diagnostics every five
  // seconds while not one pixel of it was laid out. This document is the one
  // thing every shell is written against, so every name in it is a name in the
  // shell's namespace. `document.currentScript` names nothing, and the element
  // takes itself back out afterwards so the body is the one `WRITING-A-SHELL.md`
  // describes: one script tag and nothing else.
  //
  // It must stay immediately after the module's tag for `previousElementSibling`
  // to be that tag.
  static constexpr char kReporter[] = R"js(
    <script>
      (() => {
        const here = document.currentScript;
        const shell = here.previousElementSibling;
        const say = (what) => {
          console.error("domicile: " + what);
          const said = document.createElement("pre");
          said.textContent = "domicile: " + what;
          said.setAttribute("style", "position:fixed;inset:0;margin:0;padding:16px;overflow:auto;white-space:pre-wrap;font:13px/1.5 monospace;background:#2b0b0b;color:#ffd7d7;z-index:2147483647");
          document.body.append(said);
        };
        let ran = false;
        shell.addEventListener("load", () => { ran = true; });
        shell.addEventListener("error", () => {
          say("the shell module at " + shell.src + " did not load. The engine serves it out of --domicile-shell-root under the name --domicile-shell-module gave; a module that imports a file which is not there fails here too.");
        });
        addEventListener("error", (failure) => {
          if (!ran) {
            say("the shell module threw before it finished loading: " + failure.message + " (" + failure.filename + ":" + failure.lineno + ")");
          }
        });
        addEventListener("unhandledrejection", (failure) => {
          if (!ran) {
            say("the shell module rejected before it finished loading: " + failure.reason);
          }
        });
        here.remove();
      })();
    </script>
)js";

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
      "\" type=\"module\"></script>\n",
      // After the module's own tag, not before it: the reporter attaches to
      // that element, so the element has to exist by the time this runs. It
      // still runs first -- a classic inline script runs while the parser is
      // here, and a module script is deferred until the document is parsed.
      kReporter,
      "  </body>\n"
      "</html>\n"});
}

void ShellURLLoaderFactory::ServeDocument(
    mojo::PendingRemote<network::mojom::URLLoaderClient> client) {
  mojo::Remote<network::mojom::URLLoaderClient> client_remote(
      std::move(client));

  // READ PER REQUEST, AND OUT OF THE SHELL SOURCE RATHER THAN THE COMMAND LINE.
  // Per request is what makes a reload able to serve a different shell than the
  // one this window loaded a moment ago, which is the whole of `domicile
  // load-shell` on this side: the module is whatever the source holds when the
  // document is asked for. The command line is still where it starts out --
  // ShellSource is seeded from it -- so an engine nobody has told anything
  // serves exactly what it was launched with.
  const std::string module = ShellSource::Get().Module();
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
