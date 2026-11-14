// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_protocol.h"

#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
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
         type == "destroy_window";
}

}  // namespace

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
      return ElectronOpenWindow{.window = *window, .url = std::move(*url)};
    } else {
      return ElectronLoadUrl{.window = *window, .url = std::move(*url)};
    }
  } else if (*type == "focus_window") {
    return ElectronFocusWindow{.window = *window};
  } else if (*type == "close_window") {
    return ElectronCloseWindow{.window = *window};
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

}  // namespace domicile
