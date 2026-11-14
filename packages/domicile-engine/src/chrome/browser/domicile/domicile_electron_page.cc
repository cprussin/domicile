// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_electron_page.h"

#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"

namespace domicile {

ElectronPage::ElectronPage(content::WebContents* contents,
                           std::string preload,
                           ElectronPageCalls calls)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<ElectronPage>(*contents),
      preload_(std::move(preload)),
      calls_(std::move(calls)) {}

ElectronPage::~ElectronPage() = default;

// static
void ElectronPage::Attach(content::WebContents& contents,
                          std::string preload,
                          ElectronPageCalls calls) {
  CHECK(!FromWebContents(&contents));
  CreateForWebContents(&contents, std::move(preload), std::move(calls));
}

// static
void ElectronPage::SendTo(content::WebContents& contents,
                          const std::string& channel,
                          const std::string& args_json) {
  ElectronPage* page = FromWebContents(&contents);
  // Without a preload there is no ipcRenderer to hear it, as in Electron.
  if (page != nullptr && page->frame_.is_bound()) {
    page->frame_->Deliver(channel, args_json);
  }
}

void ElectronPage::ReadyToCommitNavigation(
    content::NavigationHandle* navigation) {
  if (preload_.empty() || !navigation->IsInPrimaryMainFrame() ||
      navigation->IsSameDocument() || navigation->IsErrorPage()) {
    return;
  }
  // Associated with the frame's channel, as the commit is, so the preload
  // arrives first and the next Deliver after.
  frame_.reset();
  receiver_.reset();
  navigation->GetRenderFrameHost()
      ->GetRemoteAssociatedInterfaces()
      ->GetInterface(&frame_);
  frame_->Preload(preload_, receiver_.BindNewEndpointAndPassRemote());
}

std::optional<base::ListValue> ElectronPage::ArgsFrom(
    const std::string& args_json) {
  std::optional<base::Value> args =
      base::JSONReader::Read(args_json, base::JSON_PARSE_RFC);
  if (!args.has_value() || !args->is_list()) {
    // The preload's bootstrap sends JSON.stringify of an array, always.
    receiver_.ReportBadMessage("ElectronFrameHost: arguments not a JSON array");
    return std::nullopt;
  }
  return std::move(*args).TakeList();
}

void ElectronPage::Send(const std::string& channel,
                        const std::string& args_json) {
  std::optional<base::ListValue> args = ArgsFrom(args_json);
  if (args.has_value()) {
    calls_.sent.Run(channel, std::move(*args));
  }
}

void ElectronPage::Invoke(const std::string& channel,
                          const std::string& args_json,
                          InvokeCallback callback) {
  std::optional<base::ListValue> args = ArgsFrom(args_json);
  if (!args.has_value()) {
    return;
  }
  // An app that goes before it answers drops the answer; the page's promise
  // rejects instead of waiting forever.
  calls_.invoked.Run(channel, std::move(*args),
                     base::BindOnce(
                         [](InvokeCallback callback,
                            base::expected<base::Value, std::string> answer) {
                           if (!answer.has_value()) {
                             std::move(callback).Run(false, answer.error());
                             return;
                           }
                           std::optional<std::string> json =
                               base::WriteJson(*answer);
                           // Parsed from the app's JSON, so it writes.
                           CHECK(json.has_value());
                           std::move(callback).Run(true, *json);
                         },
                         mojo::WrapCallbackWithDefaultInvokeIfNotRun(
                             std::move(callback), false,
                             std::string("the app's main process is gone"))));
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(ElectronPage);

}  // namespace domicile
