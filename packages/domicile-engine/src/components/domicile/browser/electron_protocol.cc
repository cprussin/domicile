// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_protocol.h"

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/types/expected.h"
#include "base/values.h"
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
  } else if (!url.SchemeIsHTTPOrHTTPS()) {
    // Content refuses any other scheme in a guest (NavigationControllerImpl's
    // web-safe check), so a file: URL would open a window that never loads.
    // An app's own files come with its protocols.
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
      if (preload != nullptr && !preload->is_string()) {
        return Refuse("\"preload\" must be a string", *window);
      }
      return ElectronOpenWindow{
          .window = *window,
          .url = std::move(*url),
          .preload = preload ? preload->GetString() : std::string()};
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

std::string ElectronReady() {
  base::DictValue event;
  event.Set("type", "ready");
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

}  // namespace domicile
