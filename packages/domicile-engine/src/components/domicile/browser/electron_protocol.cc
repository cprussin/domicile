// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_protocol.h"

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/check.h"
#include "base/check_op.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "net/http/http_util.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace domicile {
namespace {

std::string Line(base::DictValue event) {
  std::string line;
  // Events hold only strings and small integers, so a write failure is a bug.
  CHECK(base::JSONWriter::Write(event, &line));
  line.push_back('\n');
  return line;
}

base::DictValue Event(std::string_view type, ElectronWindow window) {
  base::DictValue event;
  event.Set("type", type);
  event.Set("window", window);
  return event;
}

base::expected<ElectronWindow, std::string> WindowIn(
    const base::DictValue& request) {
  const std::optional<int> window = request.FindInt("window");
  if (!window.has_value() || *window < 1) {
    return base::unexpected("\"window\" must be a whole number from 1");
  } else {
    return *window;
  }
}

base::expected<GURL, std::string> UrlIn(const base::DictValue& request) {
  const std::string* text = request.FindString("url");
  if (text == nullptr) {
    return base::unexpected("\"url\" must be a string");
  }
  GURL url(*text);
  if (!url.is_valid()) {
    return base::unexpected(base::StrCat({*text, " is not a URL"}));
  } else if (!IsElectronHandleableScheme(url.scheme())) {
    // Whether the app's session serves the scheme is the app's to say; a
    // scheme no app may handle never opens.
    return base::unexpected(
        base::StrCat({url.scheme(), ": URLs do not open in an app window"}));
  } else {
    return url;
  }
}

base::expected<ElectronRequest, ElectronRefusal> Refuse(
    std::string why,
    std::optional<ElectronWindow> window = std::nullopt) {
  return base::unexpected(
      ElectronRefusal{.why = std::move(why), .window = window});
}

base::expected<ElectronRequest, ElectronRefusal> RefuseRequest(std::string why,
                                                               int request) {
  return base::unexpected(
      ElectronRefusal{.why = std::move(why), .request = request});
}

// The "session" a request names: "" when it names none and may leave it out.
base::expected<std::string, std::string> SessionIn(
    const base::DictValue& request,
    bool optional) {
  const base::Value* session = request.Find("session");
  if (session == nullptr && optional) {
    return base::ok(std::string());
  } else if (session == nullptr || !session->is_string()) {
    return base::unexpected("\"session\" must be a string");
  } else {
    return base::ok(session->GetString());
  }
}

base::expected<ElectronRequest, ElectronRefusal> ParseHandleProtocol(
    const base::DictValue& request,
    bool handle) {
  base::expected<std::string, std::string> session =
      SessionIn(request, /*optional=*/false);
  const std::string* scheme = request.FindString("scheme");
  if (!session.has_value()) {
    return Refuse(std::move(session.error()));
  } else if (scheme == nullptr) {
    return Refuse("\"scheme\" must be a string");
  } else if (!IsElectronHandleableScheme(*scheme)) {
    return Refuse(base::StrCat({"an app cannot handle ", *scheme, ":"}));
  }
  return ElectronHandleProtocol{
      .session = std::move(*session), .scheme = *scheme, .handle = handle};
}

base::expected<std::string, std::string> Base64In(
    const base::DictValue& request,
    std::string_view key) {
  const std::string* text = request.FindString(key);
  std::string bytes;
  if (text == nullptr || !base::Base64Decode(*text, &bytes)) {
    return base::unexpected(base::StrCat({"\"", key, "\" must be base64"}));
  }
  return base::ok(std::move(bytes));
}

base::expected<ElectronHeaders, std::string> HeadersIn(
    const base::DictValue& response) {
  const base::ListValue* list = response.FindList("headers");
  if (list == nullptr) {
    return base::unexpected("\"headers\" must be an array");
  }
  ElectronHeaders headers;
  for (const base::Value& pair : *list) {
    const base::ListValue* entry = pair.GetIfList();
    if (entry == nullptr || entry->size() != 2 || !(*entry)[0].is_string() ||
        !(*entry)[1].is_string()) {
      return base::unexpected(
          "each header must be a [name, value] pair of strings");
    }
    const std::string& name = (*entry)[0].GetString();
    const std::string& value = (*entry)[1].GetString();
    if (!net::HttpUtil::IsValidHeaderName(name)) {
      return base::unexpected(
          base::StrCat({"\"", name, "\" is not a header name"}));
    } else if (!net::HttpUtil::IsValidHeaderValue(value)) {
      return base::unexpected(base::StrCat(
          {"header ", name, " has a value no response can carry"}));
    }
    headers.emplace_back(name, value);
  }
  return base::ok(std::move(headers));
}

base::expected<ElectronResponse, std::string> ResponseIn(
    const base::DictValue& request) {
  const std::optional<int> status = request.FindInt("status");
  if (!status.has_value() || *status < 100 || *status > 599) {
    return base::unexpected("\"status\" must be from 100 to 599");
  }
  base::expected<ElectronHeaders, std::string> headers = HeadersIn(request);
  if (!headers.has_value()) {
    return base::unexpected(std::move(headers.error()));
  }
  const int bodies = request.contains("body") + request.contains("file") +
                     request.contains("stream");
  if (bodies != 1) {
    return base::unexpected(
        "a response has one of \"body\", \"file\" and \"stream\"");
  }
  ElectronResponse response{.status = *status,
                            .headers = std::move(*headers),
                            .body = ElectronStreamedBody()};
  if (request.contains("body")) {
    base::expected<std::string, std::string> body = Base64In(request, "body");
    if (!body.has_value()) {
      return base::unexpected(std::move(body.error()));
    }
    response.body = std::move(*body);
  } else if (request.contains("file")) {
    const std::string* file = request.FindString("file");
    if (file == nullptr || !base::FilePath(*file).IsAbsolute()) {
      return base::unexpected("\"file\" must be an absolute path");
    }
    response.body = base::FilePath(*file);
  } else if (request.FindBool("stream") != true) {
    return base::unexpected("\"stream\" must be true");
  }
  return base::ok(std::move(response));
}

// The protocol request a line answers, or why it names none.
base::expected<int, std::string> ProtocolRequestIn(
    const base::DictValue& request) {
  const std::optional<int> number = request.FindInt("request");
  if (!number.has_value() || *number < 1) {
    return base::unexpected("\"request\" must be a whole number from 1");
  }
  return base::ok(*number);
}

base::expected<ElectronRequest, ElectronRefusal> ParseProtocolAnswer(
    std::string_view type,
    const base::DictValue& request) {
  const base::expected<int, std::string> number = ProtocolRequestIn(request);
  if (!number.has_value()) {
    return Refuse(number.error());
  } else if (type == "protocol_response") {
    if (const base::Value* error = request.Find("error")) {
      if (!error->is_string()) {
        return RefuseRequest("\"error\" must be a string", *number);
      }
      return ElectronProtocolResponse{
          .request = *number, .response = base::unexpected(error->GetString())};
    }
    base::expected<ElectronResponse, std::string> response =
        ResponseIn(request);
    if (!response.has_value()) {
      return RefuseRequest(std::move(response.error()), *number);
    }
    return ElectronProtocolResponse{.request = *number,
                                    .response = std::move(*response)};
  } else if (type == "protocol_data") {
    base::expected<std::string, std::string> data = Base64In(request, "data");
    if (!data.has_value()) {
      return RefuseRequest(std::move(data.error()), *number);
    }
    return ElectronProtocolData{.request = *number, .bytes = std::move(*data)};
  } else {
    CHECK_EQ(type, "protocol_end");
    const base::Value* error = request.Find("error");
    if (error != nullptr && !error->is_string()) {
      return RefuseRequest("\"error\" must be a string", *number);
    }
    return ElectronProtocolEnd{
        .request = *number,
        .error = error ? std::optional(error->GetString()) : std::nullopt};
  }
}

base::ListValue HeadersList(const ElectronHeaders& headers) {
  base::ListValue list;
  for (const auto& [name, value] : headers) {
    base::ListValue pair;
    pair.Append(name);
    pair.Append(value);
    list.Append(std::move(pair));
  }
  return list;
}

base::expected<ElectronRequest, std::string> ParseHello(
    const base::DictValue& request) {
  const std::optional<int> version = request.FindInt("version");
  const std::string* app_id = request.FindString("app_id");
  const std::string* partition = request.FindString("partition");
  if (version != kElectronProtocolVersion) {
    return base::unexpected(
        base::StrCat({"this engine speaks version ",
                      base::NumberToString(kElectronProtocolVersion)}));
  } else if (app_id == nullptr || app_id->empty()) {
    return base::unexpected("\"app_id\" must be a string that is not empty");
  } else if (partition == nullptr) {
    return base::unexpected("\"partition\" must be a string");
  }
  base::expected<std::optional<WebViewPartition>, std::string> parsed =
      ParseWebViewPartition(*partition);
  if (!parsed.has_value()) {
    return base::unexpected(parsed.error());
  } else if (!parsed->has_value()) {
    return base::unexpected("an app cannot use the profile's own partition");
  } else {
    return ElectronHello{.app_id = *app_id, .partition = std::move(**parsed)};
  }
}

bool IsWindowRequest(std::string_view type) {
  return type == "open_window" || type == "load_url" ||
         type == "focus_window" || type == "close_window" ||
         type == "destroy_window" || type == "ipc_send" || type == "ipc_post" ||
         type == "port_post" || type == "port_close";
}

// The "port" a port request names, or why it names none.
base::expected<std::string, std::string> PortIn(
    const base::DictValue& request) {
  const std::string* port = request.FindString("port");
  if (port == nullptr || !IsElectronPortName(*port)) {
    return base::unexpected(
        "\"port\" must name a port: \"m\" or \"r\", then a number");
  }
  return base::ok(*port);
}

base::expected<ElectronRequest, ElectronRefusal> ParsePostToPage(
    base::DictValue& request,
    ElectronWindow window) {
  const std::string* channel = request.FindString("channel");
  const base::ListValue* ports = request.FindList("ports");
  if (channel == nullptr) {
    return Refuse("\"channel\" must be a string", window);
  } else if (!request.contains("message")) {
    return Refuse("\"message\" is missing", window);
  }
  std::vector<std::string> names;
  if (ports != nullptr) {
    for (const base::Value& port : *ports) {
      // The main process posts only ports it made: the page's own are
      // already the page's.
      if (!port.is_string() || !IsElectronPortName(port.GetString()) ||
          port.GetString()[0] != 'm') {
        return Refuse(
            "\"ports\" must name the main process's own ports: \"m\", then "
            "a number",
            window);
      } else if (std::ranges::find(names, port.GetString()) != names.end()) {
        return Refuse("a port is posted once", window);
      }
      names.push_back(port.GetString());
    }
  } else if (request.contains("ports")) {
    return Refuse("\"ports\" must be an array", window);
  }
  return ElectronPostToPage{.window = window,
                            .channel = *channel,
                            .message = *request.Extract("message"),
                            .ports = std::move(names)};
}

base::expected<ElectronRequest, ElectronRefusal> ParsePortPost(
    base::DictValue& request,
    ElectronWindow window) {
  base::expected<std::string, std::string> port = PortIn(request);
  if (!port.has_value()) {
    return Refuse(std::move(port.error()), window);
  } else if (!request.contains("data")) {
    return Refuse("\"data\" is missing", window);
  }
  return ElectronPortPost{.window = window,
                          .port = std::move(*port),
                          .data = *request.Extract("data")};
}

base::expected<ElectronRequest, ElectronRefusal> ParseReply(
    base::DictValue& request) {
  const std::optional<int> invoke = request.FindInt("invoke");
  if (!invoke.has_value() || *invoke < 1) {
    return Refuse("\"invoke\" must be a whole number from 1");
  }
  if (const base::Value* error = request.Find("error")) {
    if (!error->is_string()) {
      return Refuse("\"error\" must be a string");
    } else if (request.contains("result")) {
      return Refuse("a reply has a \"result\" or an \"error\", not both");
    }
    return ElectronReply{.invoke = *invoke,
                         .answer = base::unexpected(error->GetString())};
  }
  // A handler that returns nothing answers null, as JSON has no undefined.
  std::optional<base::Value> result = request.Extract("result");
  return ElectronReply{
      .invoke = *invoke,
      .answer = result.has_value() ? std::move(*result) : base::Value()};
}

base::expected<ElectronRequest, ElectronRefusal> ParseSendToPage(
    base::DictValue& request,
    ElectronWindow window) {
  const std::string* channel = request.FindString("channel");
  base::ListValue* args = request.FindList("args");
  if (channel == nullptr) {
    return Refuse("\"channel\" must be a string", window);
  } else if (args == nullptr) {
    return Refuse("\"args\" must be an array", window);
  }
  return ElectronSendToPage{
      .window = window, .channel = *channel, .args = std::move(*args)};
}

std::string WithChannel(base::DictValue event,
                        std::string_view channel,
                        const base::ListValue& args) {
  event.Set("channel", channel);
  event.Set("args", args.Clone());
  std::string line;
  // From a page's JSON.stringify, so it writes.
  CHECK(base::JSONWriter::Write(event, &line));
  line.push_back('\n');
  return line;
}

std::string Written(base::DictValue event) {
  std::string line;
  // Its values came from JSON, the page's or the app's, so it writes.
  CHECK(base::JSONWriter::Write(event, &line));
  line.push_back('\n');
  return line;
}

}  // namespace

base::expected<WebViewPartition, std::string> ElectronSessionPartition(
    const WebViewPartition& app,
    std::string_view session) {
  base::expected<std::optional<WebViewPartition>, std::string> parsed =
      ParseWebViewPartition(session);
  if (!parsed.has_value()) {
    return base::unexpected(std::move(parsed.error()));
  } else if (!parsed->has_value()) {
    return app;
  }
  // ":" keeps a session's name apart from the app's own and from any other
  // app's, whose names never hold one.
  return WebViewPartition{
      .name = base::StrCat({app.name, ":", (*parsed)->name}),
      .persist = (*parsed)->persist};
}

bool IsElectronPortName(std::string_view name) {
  // Short enough that no count reaches it, and a name is never a number
  // that overflows anything that reads it.
  return name.size() >= 2 && name.size() <= 16 &&
         (name[0] == 'm' || name[0] == 'r') &&
         std::ranges::all_of(name.substr(1), base::IsAsciiDigit<char>);
}

base::expected<ElectronRequest, ElectronRefusal> ParseElectronRequest(
    std::string_view line) {
  std::optional<base::DictValue> request =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!request.has_value()) {
    return Refuse("a request must be a JSON object");
  }
  const std::string* type = request->FindString("type");
  if (type == nullptr) {
    return Refuse("a request must have a \"type\"");
  } else if (*type == "hello") {
    return ParseHello(*request).transform_error(
        [](std::string why) { return ElectronRefusal{.why = std::move(why)}; });
  } else if (*type == "ipc_reply") {
    return ParseReply(*request);
  } else if (*type == "handle_protocol" || *type == "unhandle_protocol") {
    return ParseHandleProtocol(*request, *type == "handle_protocol");
  } else if (*type == "protocol_response" || *type == "protocol_data" ||
             *type == "protocol_end") {
    return ParseProtocolAnswer(*type, *request);
  } else if (!IsWindowRequest(*type)) {
    return Refuse(base::StrCat({"no request is named ", *type}));
  }
  const base::expected<ElectronWindow, std::string> window = WindowIn(*request);
  if (!window.has_value()) {
    return Refuse(window.error());
  } else if (*type == "open_window" || *type == "load_url") {
    base::expected<GURL, std::string> url = UrlIn(*request);
    if (!url.has_value()) {
      return Refuse(std::move(url.error()), *window);
    } else if (*type == "open_window") {
      const base::Value* preload = request->Find("preload");
      base::expected<std::string, std::string> session =
          SessionIn(*request, /*optional=*/true);
      if (preload != nullptr && !preload->is_string()) {
        return Refuse("\"preload\" must be a string", *window);
      } else if (!session.has_value()) {
        return Refuse(std::move(session.error()), *window);
      }
      return ElectronOpenWindow{
          .window = *window,
          .url = std::move(*url),
          .preload = preload ? preload->GetString() : std::string(),
          .session = std::move(*session)};
    } else {
      return ElectronLoadUrl{.window = *window, .url = std::move(*url)};
    }
  } else if (*type == "focus_window") {
    return ElectronFocusWindow{.window = *window};
  } else if (*type == "close_window") {
    return ElectronCloseWindow{.window = *window};
  } else if (*type == "ipc_send") {
    return ParseSendToPage(*request, *window);
  } else if (*type == "ipc_post") {
    return ParsePostToPage(*request, *window);
  } else if (*type == "port_post") {
    return ParsePortPost(*request, *window);
  } else if (*type == "port_close") {
    base::expected<std::string, std::string> port = PortIn(*request);
    if (!port.has_value()) {
      return Refuse(std::move(port.error()), *window);
    }
    return ElectronPortClose{.window = *window, .port = std::move(*port)};
  } else {
    CHECK_EQ(*type, "destroy_window");
    return ElectronDestroyWindow{.window = *window};
  }
}

std::string ElectronReady(const std::vector<ElectronScheme>& schemes) {
  base::ListValue registered;
  for (const ElectronScheme& scheme : schemes) {
    base::ListValue privileges;
    for (std::string& privilege : ElectronSchemePrivileges(scheme)) {
      privileges.Append(std::move(privilege));
    }
    registered.Append(base::DictValue()
                          .Set("scheme", scheme.scheme)
                          .Set("privileges", std::move(privileges)));
  }
  base::DictValue event;
  event.Set("type", "ready");
  event.Set("schemes", std::move(registered));
  return Line(std::move(event));
}

std::string ElectronRefused(std::string_view why) {
  base::DictValue event;
  event.Set("type", "refused");
  event.Set("why", why);
  return Line(std::move(event));
}

std::string ElectronWindowOpened(ElectronWindow window) {
  return Line(Event("window_opened", window));
}

std::string ElectronWindowRefused(ElectronWindow window, std::string_view why) {
  base::DictValue event = Event("window_refused", window);
  event.Set("why", why);
  return Line(std::move(event));
}

std::string ElectronWindowLoaded(ElectronWindow window) {
  return Line(Event("window_loaded", window));
}

std::string ElectronTitleChanged(ElectronWindow window,
                                 std::string_view title) {
  base::DictValue event = Event("title_changed", window);
  event.Set("title", title);
  return Line(std::move(event));
}

std::string ElectronWindowClosed(ElectronWindow window) {
  return Line(Event("window_closed", window));
}

std::string ElectronIpcMessage(ElectronWindow window,
                               std::string_view channel,
                               const base::ListValue& args) {
  return WithChannel(Event("ipc_message", window), channel, args);
}

std::string ElectronIpcInvoke(ElectronWindow window,
                              int invoke,
                              std::string_view channel,
                              const base::ListValue& args) {
  base::DictValue event = Event("ipc_invoke", window);
  event.Set("invoke", invoke);
  return WithChannel(std::move(event), channel, args);
}

std::string ElectronIpcSendSync(ElectronWindow window,
                                int invoke,
                                std::string_view channel,
                                const base::ListValue& args) {
  base::DictValue event = Event("ipc_send_sync", window);
  event.Set("invoke", invoke);
  return WithChannel(std::move(event), channel, args);
}

std::string ElectronIpcPost(ElectronWindow window,
                            std::string_view channel,
                            const base::Value& message,
                            const std::vector<std::string>& ports) {
  base::DictValue event = Event("ipc_post", window);
  event.Set("channel", channel);
  event.Set("message", message.Clone());
  base::ListValue names;
  for (const std::string& port : ports) {
    names.Append(port);
  }
  event.Set("ports", std::move(names));
  return Written(std::move(event));
}

std::string ElectronPortMessage(ElectronWindow window,
                                std::string_view port,
                                const base::Value& data) {
  base::DictValue event = Event("port_message", window);
  event.Set("port", port);
  event.Set("data", data.Clone());
  return Written(std::move(event));
}

std::string ElectronPortClosed(ElectronWindow window, std::string_view port) {
  base::DictValue event = Event("port_closed", window);
  event.Set("port", port);
  return Line(std::move(event));
}

std::string ElectronPageGone(ElectronWindow window) {
  return Line(Event("page_gone", window));
}

std::string ElectronProtocolRequest(int request,
                                    std::string_view session,
                                    const ElectronFetch& fetch) {
  base::DictValue event;
  event.Set("type", "protocol_request");
  event.Set("request", request);
  event.Set("session", session);
  event.Set("url", fetch.url.spec());
  event.Set("method", fetch.method);
  event.Set("headers", HeadersList(fetch.headers));
  if (fetch.body.has_value()) {
    event.Set("body", base::Base64Encode(*fetch.body));
  }
  // Strings throughout, so it writes; header bytes that are not UTF-8 were
  // refused by the page's own fetch.
  return Written(std::move(event));
}

}  // namespace domicile
