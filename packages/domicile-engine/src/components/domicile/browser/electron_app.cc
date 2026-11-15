// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_app.h"

#include <algorithm>
#include <iterator>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/types/expected.h"
#include "url/url_constants.h"

namespace domicile {
namespace {

std::string Json(const base::Value& value) {
  std::string json;
  // Parsed from the app's JSON, so it writes.
  CHECK(base::JSONWriter::Write(value, &json));
  return json;
}

// The schemes whose requests go to the network unless the app handles them.
bool IsNetworkScheme(std::string_view scheme) {
  return scheme == url::kHttpScheme || scheme == url::kHttpsScheme;
}

}  // namespace

ElectronSession::ElectronSession(ElectronApp& app, std::string name)
    : app_(app), name_(std::move(name)) {}

ElectronSession::~ElectronSession() = default;

bool ElectronSession::Handles(std::string_view scheme) const {
  return schemes_.contains(std::string(scheme));
}

std::vector<std::string> ElectronSession::LocalSchemes() const {
  std::vector<std::string> local;
  std::ranges::copy_if(
      schemes_, std::back_inserter(local),
      [](const std::string& scheme) { return !IsNetworkScheme(scheme); });
  return local;
}

void ElectronSession::Fetch(ElectronFetch fetch,
                            std::unique_ptr<ElectronResponder> responder) {
  app_->StartFetch(name_, std::move(fetch), std::move(responder));
}

bool ElectronSession::ListensFor(ElectronWebRequestEvent event) const {
  return web_request_events_.contains(event);
}

void ElectronSession::AskWebRequest(ElectronWebRequestEvent event,
                                    const std::optional<std::string>& window,
                                    ElectronWebRequestDetails details,
                                    ElectronWebRequestAnswered answered) {
  CHECK(IsBlockingElectronWebRequestEvent(event));
  app_->StartAsk(name_, event, window, details, std::move(answered));
}

void ElectronSession::TellWebRequest(ElectronWebRequestEvent event,
                                     const std::optional<std::string>& window,
                                     ElectronWebRequestDetails details) {
  CHECK(!IsBlockingElectronWebRequestEvent(event));
  app_->SendWebRequest(name_, event, std::nullopt, window, details);
}

ElectronApp::ElectronApp(ElectronDesk& desk,
                         Send send,
                         std::vector<ElectronScheme> schemes)
    : desk_(desk), send_(std::move(send)), schemes_(std::move(schemes)) {}

ElectronApp::~ElectronApp() {
  for (const auto& [number, window] : windows_) {
    desk_->Close(window.id);
  }
  // A request the app's listener never answered does not go ahead as if it
  // had said nothing.
  for (auto& [number, ask] : std::exchange(asks_, {})) {
    std::move(ask.answered)
        .Run(ElectronWebRequestAnswer{.ask = number, .cancel = true});
  }
}

void ElectronApp::Take(std::string_view line) {
  base::expected<ElectronRequest, ElectronRefusal> request =
      ParseElectronRequest(line);
  if (!request.has_value() && request.error().window.has_value()) {
    send_.Run(
        ElectronWindowRefused(*request.error().window, request.error().why));
  } else if (!request.has_value() && request.error().request.has_value()) {
    FailRequest(*request.error().request, request.error().why);
  } else if (!request.has_value()) {
    send_.Run(ElectronRefused(request.error().why));
  } else if (const auto* hello = std::get_if<ElectronHello>(&*request)) {
    if (hello_.has_value()) {
      send_.Run(ElectronRefused("this app already said hello"));
    } else {
      hello_ = *hello;
      send_.Run(ElectronReady(schemes_));
    }
  } else if (!hello_.has_value()) {
    send_.Run(ElectronRefused("an app says hello first"));
  } else if (const auto* open = std::get_if<ElectronOpenWindow>(&*request)) {
    Open(*open);
  } else if (const auto* load = std::get_if<ElectronLoadUrl>(&*request)) {
    if (const std::optional<std::string> id = IdOf(load->window);
        id.has_value() &&
        Opens(load->window, windows_.at(load->window).session, load->url)) {
      desk_->Load(*id, load->url);
    }
  } else if (const auto* focus = std::get_if<ElectronFocusWindow>(&*request)) {
    if (const std::optional<std::string> id = IdOf(focus->window)) {
      desk_->Focus(*id);
    }
  } else if (const auto* close = std::get_if<ElectronCloseWindow>(&*request)) {
    if (const std::optional<std::string> id = IdOf(close->window)) {
      desk_->AskToClose(*id);
    }
  } else if (auto* send = std::get_if<ElectronSendToPage>(&*request)) {
    if (const std::optional<std::string> id = IdOf(send->window)) {
      desk_->SendToPage(*id, send->channel,
                        Json(base::Value(send->args.Clone())));
    }
  } else if (auto* post = std::get_if<ElectronPostToPage>(&*request)) {
    if (const std::optional<std::string> id = IdOf(post->window)) {
      desk_->PostToPage(*id, post->channel, Json(post->message), post->ports);
    }
  } else if (auto* port = std::get_if<ElectronPortPost>(&*request)) {
    if (const std::optional<std::string> id = IdOf(port->window)) {
      desk_->PostToPort(*id, port->port, Json(port->data));
    }
  } else if (auto* close_port = std::get_if<ElectronPortClose>(&*request)) {
    if (const std::optional<std::string> id = IdOf(close_port->window)) {
      desk_->ClosePort(*id, close_port->port);
    }
  } else if (auto* reply = std::get_if<ElectronReply>(&*request)) {
    Reply(std::move(*reply));
  } else if (auto* handle = std::get_if<ElectronHandleProtocol>(&*request)) {
    HandleProtocol(*handle);
  } else if (auto* response =
                 std::get_if<ElectronProtocolResponse>(&*request)) {
    Respond(std::move(*response));
  } else if (auto* data = std::get_if<ElectronProtocolData>(&*request)) {
    ReceiveData(std::move(*data));
  } else if (auto* end = std::get_if<ElectronProtocolEnd>(&*request)) {
    EndBody(*end);
  } else if (auto* listen = std::get_if<ElectronWebRequestListen>(&*request)) {
    ListenForWebRequests(std::move(*listen));
  } else if (auto* answer = std::get_if<ElectronWebRequestAnswer>(&*request)) {
    Answer(std::move(*answer));
  } else {
    const auto& destroy = std::get<ElectronDestroyWindow>(*request);
    if (const std::optional<std::string> id = IdOf(destroy.window)) {
      // Reported closed when the desk's list drops it, as any other close.
      desk_->Close(*id);
    }
  }
}

void ElectronApp::Listed(const std::vector<ListedBrowserWindow>& listing) {
  std::vector<ElectronWindow> closed;
  for (auto& [number, window] : windows_) {
    auto listed =
        std::ranges::find(listing, window.id, &ListedBrowserWindow::id);
    if (listed == listing.end()) {
      closed.push_back(number);
    } else if (listed->title != window.title) {
      window.title = listed->title;
      send_.Run(ElectronTitleChanged(number, window.title));
    }
  }
  for (ElectronWindow number : closed) {
    windows_.erase(number);
    send_.Run(ElectronWindowClosed(number));
  }
}

void ElectronApp::Loaded(const std::string& id) {
  auto found = std::ranges::find_if(
      windows_, [&id](const auto& entry) { return entry.second.id == id; });
  if (found != windows_.end()) {
    send_.Run(ElectronWindowLoaded(found->first));
  }
}

void ElectronApp::Open(const ElectronOpenWindow& open) {
  CHECK(hello_.has_value());
  if (windows_.contains(open.window)) {
    send_.Run(ElectronWindowRefused(
        open.window, base::StrCat({"window ", base::NumberToString(open.window),
                                   " is already open"})));
    return;
  }
  base::expected<WebViewPartition, std::string> partition =
      ElectronSessionPartition(hello_->partition, open.session);
  if (!partition.has_value()) {
    send_.Run(ElectronWindowRefused(open.window, partition.error()));
    return;
  } else if (!Opens(open.window, open.session, open.url)) {
    return;
  }
  ElectronPageCalls calls{
      .sent = base::BindRepeating(&ElectronApp::PageSent,
                                  weak_factory_.GetWeakPtr(), open.window),
      .invoked =
          base::BindRepeating(&ElectronApp::PageInvoked,
                              weak_factory_.GetWeakPtr(), open.window, false),
      .sent_sync =
          base::BindRepeating(&ElectronApp::PageInvoked,
                              weak_factory_.GetWeakPtr(), open.window, true),
      .posted = base::BindRepeating(&ElectronApp::PagePosted,
                                    weak_factory_.GetWeakPtr(), open.window),
      .port_posted =
          base::BindRepeating(&ElectronApp::PagePortPosted,
                              weak_factory_.GetWeakPtr(), open.window),
      .port_closed =
          base::BindRepeating(&ElectronApp::PagePortClosed,
                              weak_factory_.GetWeakPtr(), open.window),
      .gone = base::BindRepeating(&ElectronApp::PageGone,
                                  weak_factory_.GetWeakPtr(), open.window),
  };
  const std::optional<std::string> id =
      desk_->Open(open.url, hello_->app_id, *partition, open.preload,
                  std::move(calls), SessionNamed(open.session).GetWeakPtr());
  if (!id.has_value()) {
    send_.Run(
        ElectronWindowRefused(open.window, "there is no shell to open it in"));
  } else {
    windows_.emplace(
        open.window,
        Window{.id = *id, .title = std::string(), .session = open.session});
    send_.Run(ElectronWindowOpened(open.window));
  }
}

void ElectronApp::Reply(ElectronReply reply) {
  auto waiting = invokes_.find(reply.invoke);
  if (waiting == invokes_.end()) {
    send_.Run(ElectronRefused(base::StrCat(
        {"no invoke ", base::NumberToString(reply.invoke), " is waiting"})));
    return;
  }
  ElectronAnswer answer = std::move(waiting->second);
  invokes_.erase(waiting);
  std::move(answer).Run(std::move(reply.answer));
}

void ElectronApp::PageSent(ElectronWindow number,
                           std::string channel,
                           base::ListValue args) {
  // A window the app closed may still have its page for a moment.
  if (windows_.contains(number)) {
    send_.Run(ElectronIpcMessage(number, channel, args));
  }
}

void ElectronApp::PageInvoked(ElectronWindow number,
                              bool sync,
                              std::string channel,
                              base::ListValue args,
                              ElectronAnswer answer) {
  if (!windows_.contains(number)) {
    std::move(answer).Run(base::unexpected("the window is closed"));
    return;
  }
  const int invoke = next_invoke_++;
  invokes_.emplace(invoke, std::move(answer));
  send_.Run(sync ? ElectronIpcSendSync(number, invoke, channel, args)
                 : ElectronIpcInvoke(number, invoke, channel, args));
}

void ElectronApp::PagePosted(ElectronWindow number,
                             std::string channel,
                             base::Value message,
                             std::vector<std::string> ports) {
  if (windows_.contains(number)) {
    send_.Run(ElectronIpcPost(number, channel, message, ports));
  }
}

void ElectronApp::PagePortPosted(ElectronWindow number,
                                 std::string port,
                                 base::Value data) {
  if (windows_.contains(number)) {
    send_.Run(ElectronPortMessage(number, port, data));
  }
}

void ElectronApp::PagePortClosed(ElectronWindow number, std::string port) {
  if (windows_.contains(number)) {
    send_.Run(ElectronPortClosed(number, port));
  }
}

void ElectronApp::PageGone(ElectronWindow number) {
  if (windows_.contains(number)) {
    send_.Run(ElectronPageGone(number));
  }
}

ElectronSession& ElectronApp::SessionNamed(const std::string& name) {
  std::unique_ptr<ElectronSession>& session = sessions_[name];
  if (!session) {
    session = std::make_unique<ElectronSession>(*this, name);
  }
  return *session;
}

void ElectronApp::ListenForWebRequests(ElectronWebRequestListen listen) {
  // Checked as handle_protocol's session is.
  base::expected<WebViewPartition, std::string> partition =
      ElectronSessionPartition(hello_->partition, listen.session);
  if (!partition.has_value()) {
    send_.Run(ElectronRefused(partition.error()));
    return;
  }
  SessionNamed(listen.session).web_request_events_ = std::move(listen.events);
}

void ElectronApp::SendWebRequest(const std::string& session,
                                 ElectronWebRequestEvent event,
                                 std::optional<int> ask,
                                 const std::optional<std::string>& window,
                                 const ElectronWebRequestDetails& details) {
  std::optional<ElectronWindow> number;
  if (window.has_value()) {
    const auto found = std::ranges::find(
        windows_, *window, [](const auto& entry) -> const std::string& {
          return entry.second.id;
        });
    if (found != windows_.end()) {
      number = found->first;
    }
  }
  send_.Run(ElectronWebRequest(event, ask, number, session, details));
}

void ElectronApp::StartAsk(const std::string& session,
                           ElectronWebRequestEvent event,
                           const std::optional<std::string>& window,
                           const ElectronWebRequestDetails& details,
                           ElectronWebRequestAnswered answered) {
  const int number = next_ask_++;
  asks_.emplace(number, Ask{.event = event, .answered = std::move(answered)});
  SendWebRequest(session, event, number, window, details);
}

void ElectronApp::Answer(ElectronWebRequestAnswer answer) {
  auto found = asks_.find(answer.ask);
  if (found == asks_.end()) {
    send_.Run(
        ElectronRefused(base::StrCat({"no web request is waiting for answer ",
                                      base::NumberToString(answer.ask)})));
    return;
  }
  Ask ask = std::move(found->second);
  asks_.erase(found);
  // What each listener's answer may change, as in Electron.
  const char* stray = nullptr;
  if (answer.redirect_url.has_value() &&
      ask.event != ElectronWebRequestEvent::kBeforeRequest) {
    stray = "redirect_url";
  } else if (answer.request_headers.has_value() &&
             ask.event != ElectronWebRequestEvent::kBeforeSendHeaders) {
    stray = "request_headers";
  } else if (answer.response_headers.has_value() &&
             ask.event != ElectronWebRequestEvent::kHeadersReceived) {
    stray = "response_headers";
  } else if (answer.status_line.has_value() &&
             ask.event != ElectronWebRequestEvent::kHeadersReceived) {
    stray = "status_line";
  }
  if (stray != nullptr) {
    // The app's bug fails the request, rather than letting it through as if
    // the app had not asked for a change.
    send_.Run(ElectronRefused(
        base::StrCat({"an answer to ", ElectronWebRequestEventName(ask.event),
                      " cannot set ", stray})));
    std::move(ask.answered)
        .Run(ElectronWebRequestAnswer{.ask = answer.ask, .cancel = true});
    return;
  }
  std::move(ask.answered).Run(std::move(answer));
}

void ElectronApp::HandleProtocol(const ElectronHandleProtocol& handle) {
  // A session's partition is checked here too, so a handler never waits on
  // a session no window can open in.
  base::expected<WebViewPartition, std::string> partition =
      ElectronSessionPartition(hello_->partition, handle.session);
  if (!partition.has_value()) {
    send_.Run(ElectronRefused(partition.error()));
    return;
  }
  std::set<std::string>& schemes = SessionNamed(handle.session).schemes_;
  if (handle.handle) {
    schemes.insert(handle.scheme);
  } else {
    schemes.erase(handle.scheme);
  }
}

bool ElectronApp::Opens(ElectronWindow number,
                        const std::string& session,
                        const GURL& url) {
  if (IsNetworkScheme(url.scheme()) ||
      SessionNamed(session).Handles(url.scheme())) {
    return true;
  }
  send_.Run(ElectronWindowRefused(
      number, base::StrCat({url.scheme(), ": URLs open once the app handles ",
                            url.scheme(), ":"})));
  return false;
}

void ElectronApp::StartFetch(const std::string& session,
                             ElectronFetch fetch,
                             std::unique_ptr<ElectronResponder> responder) {
  const int request = next_fetch_++;
  fetches_.emplace(request, Pending{.responder = std::move(responder)});
  send_.Run(ElectronProtocolRequest(request, session, fetch));
}

void ElectronApp::Respond(ElectronProtocolResponse response) {
  auto pending = fetches_.find(response.request);
  if (pending == fetches_.end()) {
    send_.Run(ElectronRefused(
        base::StrCat({"no protocol request ",
                      base::NumberToString(response.request), " is waiting"})));
    return;
  } else if (pending->second.streaming) {
    FailRequest(response.request, "a protocol request has one response");
    return;
  }
  if (!response.response.has_value()) {
    pending->second.responder->Fail(response.response.error());
    fetches_.erase(pending);
  } else if (std::holds_alternative<ElectronStreamedBody>(
                 response.response->body)) {
    pending->second.streaming = true;
    pending->second.responder->Respond(std::move(*response.response));
  } else {
    pending->second.responder->Respond(std::move(*response.response));
    fetches_.erase(pending);
  }
}

void ElectronApp::ReceiveData(ElectronProtocolData data) {
  auto pending = fetches_.find(data.request);
  if (pending == fetches_.end()) {
    send_.Run(ElectronRefused(
        base::StrCat({"no protocol request ",
                      base::NumberToString(data.request), " is waiting"})));
  } else if (!pending->second.streaming) {
    FailRequest(data.request,
                "the app sent a body's piece before a streamed response");
  } else {
    pending->second.responder->Data(std::move(data.bytes));
  }
}

void ElectronApp::EndBody(const ElectronProtocolEnd& end) {
  auto pending = fetches_.find(end.request);
  if (pending == fetches_.end()) {
    send_.Run(ElectronRefused(
        base::StrCat({"no protocol request ", base::NumberToString(end.request),
                      " is waiting"})));
  } else if (!pending->second.streaming) {
    FailRequest(end.request, "the app ended a body before a streamed response");
  } else {
    pending->second.responder->End(end.error);
    fetches_.erase(pending);
  }
}

void ElectronApp::FailRequest(int request, const std::string& why) {
  send_.Run(ElectronRefused(why));
  auto pending = fetches_.find(request);
  if (pending == fetches_.end()) {
    return;
  }
  // A streamed body that broke off ends with the error; one that never
  // started fails.
  if (pending->second.streaming) {
    pending->second.responder->End(why);
  } else {
    pending->second.responder->Fail(why);
  }
  fetches_.erase(pending);
}

std::optional<std::string> ElectronApp::IdOf(ElectronWindow number) {
  auto found = windows_.find(number);
  if (found == windows_.end()) {
    send_.Run(ElectronWindowRefused(
        number, base::StrCat({"window ", base::NumberToString(number),
                              " is not open"})));
    return std::nullopt;
  } else {
    return found->second.id;
  }
}

}  // namespace domicile
