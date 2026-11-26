// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_agent_devtools.h"

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/memory/scoped_refptr.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_view_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "base/types/expected.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "components/domicile/browser/file_choice.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_client.h"
#include "content/public/browser/web_contents.h"

namespace domicile {
namespace {

// The window an agent names to reach the shell's own page: its bars, panels
// and dialogs.
constexpr char kShellWindow[] = "shell";

// What an agent may not send the shell's page: it reads and clicks the shell,
// and never takes the desk away from it.
constexpr std::string_view kShellKeeps[] = {
    "Page.navigate", "Page.navigateToHistoryEntry", "Page.reload"};

// The id of the one method a client sends.
constexpr int kMethodId = 1;

// How long a page has to answer. The command socket serves one request at a
// time, so a page that never answers must not hold it.
constexpr base::TimeDelta kPatience = base::Seconds(10);

// A DevTools client that sends one method, answers with its result, then
// detaches and deletes itself.
class OneMethod : public content::DevToolsAgentHostClient {
 public:
  OneMethod(scoped_refptr<content::DevToolsAgentHost> host,
            DevToolsAnswered answered)
      : host_(std::move(host)), answered_(std::move(answered)) {}

  OneMethod(const OneMethod&) = delete;
  OneMethod& operator=(const OneMethod&) = delete;

  ~OneMethod() override = default;

  void Send(const std::string& method, base::DictValue params) {
    if (!host_->AttachClient(this)) {
      Finish(base::unexpected(
          "DevTools could not attach to the window's page"));
      return;
    }
    attached_ = true;
    base::DictValue message;
    message.Set("id", kMethodId);
    message.Set("method", method);
    message.Set("params", std::move(params));
    std::string json;
    // The message holds only what a JSON line parsed into, so a write failure
    // is a bug.
    CHECK(base::JSONWriter::Write(message, &json));
    timeout_.Start(FROM_HERE, kPatience,
                   base::BindOnce(&OneMethod::TimedOut, base::Unretained(this),
                                  method));
    host_->DispatchProtocolMessage(this, base::as_byte_span(json));
  }

  // content::DevToolsAgentHostClient:
  void DispatchProtocolMessage(content::DevToolsAgentHost* host,
                               base::span<const uint8_t> message) override {
    const std::string_view text = base::as_string_view(message);
    std::optional<base::DictValue> parsed =
        base::JSONReader::ReadDict(text, base::JSON_PARSE_RFC);
    if (!parsed) {
      Finish(base::unexpected(base::StrCat(
          {"DevTools sent a message that is not a JSON object: ", text})));
      return;
    }
    if (parsed->FindInt("id") != kMethodId) {
      // An event the method set off; only its answer matters.
      return;
    }
    if (const base::DictValue* error = parsed->FindDict("error")) {
      const std::string* why = error->FindString("message");
      Finish(base::unexpected(
          why != nullptr ? *why : std::string("the method failed")));
      return;
    }
    base::DictValue* result = parsed->FindDict("result");
    Finish(base::ok(result != nullptr ? std::move(*result)
                                      : base::DictValue()));
  }

  void AgentHostClosed(content::DevToolsAgentHost* host) override {
    attached_ = false;
    Finish(base::unexpected("the window's page closed before it answered"));
  }

  // An agent drives the page and nothing past it.
  bool MayReadLocalFiles() override { return false; }
  bool MayWriteLocalFiles() override { return false; }
  bool IsTrusted() override { return false; }
  bool AllowUnsafeOperations() override { return false; }

 private:
  void TimedOut(const std::string& method) {
    Finish(base::unexpected(base::StrCat(
        {"the page did not answer ", method, " within ",
         base::NumberToString(kPatience.InSeconds()), " seconds"})));
  }

  void Finish(base::expected<base::DictValue, std::string> answer) {
    if (answered_.is_null()) {
      return;
    }
    timeout_.Stop();
    std::move(answered_).Run(std::move(answer));
    // Not now: the host may be dispatching to this client.
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&OneMethod::DetachAndDelete, base::Unretained(this)));
  }

  void DetachAndDelete() {
    if (attached_) {
      host_->DetachClient(this);
    }
    delete this;
  }

  const scoped_refptr<content::DevToolsAgentHost> host_;
  DevToolsAnswered answered_;
  bool attached_ = false;
  base::OneShotTimer timeout_;
};

// The file chooser mode as agents and shells name it: the
// `domicile-file-chooser` event's `mode`.
std::string_view ModeName(mojom::WebViewFileChooserMode mode) {
  switch (mode) {
    case mojom::WebViewFileChooserMode::kOpen:
      return "open";
    case mojom::WebViewFileChooserMode::kOpenMultiple:
      return "open-multiple";
    case mojom::WebViewFileChooserMode::kOpenFolder:
      return "open-folder";
    case mojom::WebViewFileChooserMode::kSave:
      return "save";
  }
}

// Whether `method` with `params` presses or keys in a page, which gives it
// user activation: what lets a page open a file chooser.
bool PressesOrKeys(const std::string& method, const base::DictValue& params) {
  const std::string* type = params.FindString("type");
  if (type == nullptr) {
    return false;
  }
  return (method == "Input.dispatchMouseEvent" && *type == "mousePressed") ||
         (method == "Input.dispatchKeyEvent" &&
          (*type == "keyDown" || *type == "rawKeyDown"));
}

// Answers Domicile.fileChooser: the file request `guest`'s page holds for the
// agent, under `chooser`, or no `chooser` when none waits.
base::DictValue FileChooserOf(const WebViewGuest& guest) {
  base::DictValue answer;
  std::optional<WebViewGuest::AgentFileRequest> request =
      guest.agent_file_request();
  if (!request.has_value()) {
    return answer;
  }
  base::ListValue accept;
  for (const std::string& extension : request->accept) {
    accept.Append(extension);
  }
  base::DictValue chooser;
  chooser.Set("mode", ModeName(request->mode));
  chooser.Set("accept", std::move(accept));
  chooser.Set("suggestedName", request->suggested_name);
  chooser.Set("folder", request->folder);
  answer.Set("chooser", std::move(chooser));
  return answer;
}

// Why `paths` can't answer a request in `mode`, if they can't: a file an open
// names that is not there, or a save into no folder. Blocking; run on the
// thread pool.
std::optional<std::string> MissingFrom(mojom::WebViewFileChooserMode mode,
                                       const std::vector<std::string>& paths) {
  const base::FilePath home = base::GetHomeDir();
  for (const std::string& said : paths) {
    std::optional<base::FilePath> path = ResolvedPath(home, said);
    if (!path.has_value()) {
      // AnswerAgentFileRequest refuses it, saying why.
      continue;
    }
    switch (mode) {
      case mojom::WebViewFileChooserMode::kOpen:
      case mojom::WebViewFileChooserMode::kOpenMultiple:
        if (!base::PathExists(*path) || base::DirectoryExists(*path)) {
          return base::StrCat({"there is no file ", path->value()});
        }
        break;
      case mojom::WebViewFileChooserMode::kOpenFolder:
        if (!base::DirectoryExists(*path)) {
          return base::StrCat({"there is no folder ", path->value()});
        }
        break;
      case mojom::WebViewFileChooserMode::kSave:
        if (!base::DirectoryExists(path->DirName())) {
          return base::StrCat(
              {"there is no folder ", path->DirName().value(), " to save in"});
        }
        break;
    }
  }
  return std::nullopt;
}

// Carries out Domicile.chooseFiles on browser window `window`: answers its
// held file request with `params`' `files`, or cancels it with `cancel`.
void ChooseFiles(const std::string& window,
                 const base::DictValue& params,
                 DevToolsAnswered answered) {
  content::WebContents* page = BrowserWindowContents(window);
  WebViewGuest* guest =
      page == nullptr ? nullptr : WebViewGuest::FromWebContents(page);
  if (guest == nullptr) {
    std::move(answered).Run(base::unexpected(
        base::StrCat({"browser window ", window, " closed"})));
    return;
  }
  const base::ListValue* files = params.FindList("files");
  const bool cancel = params.FindBool("cancel").value_or(false);
  if ((files == nullptr) == !cancel) {
    std::move(answered).Run(base::unexpected(
        "Domicile.chooseFiles takes \"files\", a list of paths, or "
        "\"cancel\": true"));
    return;
  }
  if (cancel) {
    base::expected<void, std::string> done =
        guest->AnswerAgentFileRequest(std::nullopt);
    std::move(answered).Run(done.transform([] { return base::DictValue(); }));
    return;
  }
  std::vector<std::string> paths;
  for (const base::Value& file : *files) {
    if (!file.is_string()) {
      std::move(answered).Run(base::unexpected(
          "Domicile.chooseFiles's \"files\" are paths, as strings"));
      return;
    }
    paths.push_back(file.GetString());
  }
  std::optional<WebViewGuest::AgentFileRequest> request =
      guest->agent_file_request();
  if (!request.has_value()) {
    // AnswerAgentFileRequest says why.
    std::move(answered).Run(guest->AnswerAgentFileRequest(std::move(paths))
                                .transform([] { return base::DictValue(); }));
    return;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock()},
      base::BindOnce(&MissingFrom, request->mode, paths),
      base::BindOnce(
          [](const std::string& window, std::vector<std::string> paths,
             DevToolsAnswered answered, std::optional<std::string> missing) {
            if (missing.has_value()) {
              std::move(answered).Run(base::unexpected(*missing));
              return;
            }
            content::WebContents* page = BrowserWindowContents(window);
            WebViewGuest* guest = page == nullptr
                                      ? nullptr
                                      : WebViewGuest::FromWebContents(page);
            if (guest == nullptr) {
              std::move(answered).Run(base::unexpected(
                  base::StrCat({"browser window ", window, " closed"})));
              return;
            }
            std::move(answered).Run(
                guest->AnswerAgentFileRequest(std::move(paths)).transform([] {
                  return base::DictValue();
                }));
          },
          window, std::move(paths), std::move(answered)));
}

}  // namespace

void SendDevToolsToBrowserWindow(const std::string& window,
                                 const std::string& method,
                                 base::DictValue params,
                                 DevToolsAnswered answered) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  content::WebContents* page = window == kShellWindow
                                   ? DeskShellContents()
                                   : BrowserWindowContents(window);
  if (page == nullptr) {
    std::move(answered).Run(base::unexpected(
        base::StrCat({"no browser window ", window, " is open"})));
    return;
  }
  if (window == kShellWindow && std::ranges::contains(kShellKeeps, method)) {
    std::move(answered).Run(base::unexpected(
        base::StrCat({method, " is refused on the shell's page"})));
    return;
  }
  if (page->GetBrowserContext()->IsOffTheRecord()) {
    std::move(answered).Run(base::unexpected(base::StrCat(
        {"browser window ", window,
         " is private, and agents do not drive private windows"})));
    return;
  }
  // Domicile's own methods: a page's file request, held for the agent whose
  // input set it off. See WebViewGuest::AskForFiles.
  if (method == kFileChooserMethod || method == kChooseFilesMethod) {
    WebViewGuest* guest = window == kShellWindow
                              ? nullptr
                              : WebViewGuest::FromWebContents(page);
    if (guest == nullptr) {
      std::move(answered).Run(base::unexpected(base::StrCat(
          {method, " is for a browser window's page; the shell's own page "
                   "asks the desktop's file chooser portal"})));
      return;
    }
    if (method == kFileChooserMethod) {
      std::move(answered).Run(base::ok(FileChooserOf(*guest)));
      return;
    }
    ChooseFiles(window, params, std::move(answered));
    return;
  }
  if (window != kShellWindow && PressesOrKeys(method, params)) {
    // A file chooser this sets off is the agent's. Upstream's DevTools has
    // the same for its own clients: Page.setInterceptFileChooserDialog.
    if (WebViewGuest* guest = WebViewGuest::FromWebContents(page)) {
      guest->NoteAgentInput();
    }
  }
  // Owns itself until answered.
  (new OneMethod(content::DevToolsAgentHost::GetOrCreateFor(page),
                 std::move(answered)))
      ->Send(method, std::move(params));
}

}  // namespace domicile
