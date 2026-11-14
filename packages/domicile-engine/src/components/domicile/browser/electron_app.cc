// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_app.h"

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "base/check.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/types/expected.h"

namespace domicile {

ElectronApp::ElectronApp(ElectronDesk& desk, Send send)
    : desk_(desk), send_(std::move(send)) {}

ElectronApp::~ElectronApp() {
  for (const auto& [number, window] : windows_) {
    desk_->Close(window.id);
  }
}

void ElectronApp::Take(std::string_view line) {
  const base::expected<ElectronRequest, ElectronRefusal> request =
      ParseElectronRequest(line);
  if (!request.has_value() && request.error().window.has_value()) {
    send_.Run(
        ElectronWindowRefused(*request.error().window, request.error().why));
  } else if (!request.has_value()) {
    send_.Run(ElectronRefused(request.error().why));
  } else if (const auto* hello = std::get_if<ElectronHello>(&*request)) {
    if (hello_.has_value()) {
      send_.Run(ElectronRefused("this app already said hello"));
    } else {
      hello_ = *hello;
      send_.Run(ElectronReady());
    }
  } else if (!hello_.has_value()) {
    send_.Run(ElectronRefused("an app says hello first"));
  } else if (const auto* open = std::get_if<ElectronOpenWindow>(&*request)) {
    Open(*open);
  } else if (const auto* load = std::get_if<ElectronLoadUrl>(&*request)) {
    if (const std::optional<std::string> id = IdOf(load->window)) {
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
  const std::optional<std::string> id = desk_->Open(open.url, *hello_);
  if (!id.has_value()) {
    send_.Run(
        ElectronWindowRefused(open.window, "there is no shell to open it in"));
  } else {
    windows_.emplace(open.window, Window{.id = *id, .title = std::string()});
    send_.Run(ElectronWindowOpened(open.window));
  }
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
