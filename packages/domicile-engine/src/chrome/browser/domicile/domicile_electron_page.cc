// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_electron_page.h"

#include <algorithm>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/electron_protocol.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"

namespace domicile {
namespace {

// An ElectronAnswer that answers the page: true and the result as JSON, or
// false and why it failed.
ElectronAnswer Answering(
    base::OnceCallback<void(bool, const std::string&)> callback) {
  return base::BindOnce(
      [](base::OnceCallback<void(bool, const std::string&)> callback,
         base::expected<base::Value, std::string> answer) {
        if (!answer.has_value()) {
          std::move(callback).Run(false, answer.error());
          return;
        }
        std::optional<std::string> json = base::WriteJson(*answer);
        // Parsed from the app's JSON, so it writes.
        CHECK(json.has_value());
        std::move(callback).Run(true, *json);
      },
      std::move(callback));
}

}  // namespace

ElectronPage::ElectronPage(content::WebContents* contents,
                           std::string preload,
                           ElectronPageCalls calls,
                           base::WeakPtr<ElectronSession> session)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<ElectronPage>(*contents),
      preload_(std::move(preload)),
      calls_(std::move(calls)),
      session_(std::move(session)) {}

ElectronPage::~ElectronPage() = default;

// static
void ElectronPage::Attach(content::WebContents& contents,
                          std::string preload,
                          ElectronPageCalls calls,
                          base::WeakPtr<ElectronSession> session) {
  CHECK(!FromWebContents(&contents));
  CreateForWebContents(&contents, std::move(preload), std::move(calls),
                       std::move(session));
}

// static
base::WeakPtr<ElectronSession> ElectronPage::SessionOf(
    content::WebContents& contents) {
  ElectronPage* page = FromWebContents(&contents);
  if (page == nullptr) {
    return nullptr;
  }
  return page->session_;
}

void ElectronPage::Deliver(const std::string& channel,
                           const std::string& args_json) {
  // Without a preload there is no ipcRenderer to hear it, as in Electron.
  if (frame_.is_bound()) {
    frame_->Deliver(channel, args_json);
  }
}

void ElectronPage::DeliverPost(const std::string& channel,
                               const std::string& message_json,
                               const std::vector<std::string>& ports) {
  if (frame_.is_bound()) {
    frame_->DeliverPost(channel, message_json, ports);
  }
}

void ElectronPage::DeliverToPort(const std::string& port,
                                 const std::string& data_json) {
  if (frame_.is_bound()) {
    frame_->DeliverToPort(port, data_json);
  }
}

void ElectronPage::ClosePort(const std::string& port) {
  if (frame_.is_bound()) {
    frame_->ClosePort(port);
  }
}

void ElectronPage::ReadyToCommitNavigation(
    content::NavigationHandle* navigation) {
  if (preload_.empty() || !navigation->IsInPrimaryMainFrame() ||
      navigation->IsSameDocument() || navigation->IsErrorPage()) {
    return;
  }
  // The document going took its ports and listeners: the app forgets them
  // before the new one's can arrive.
  if (frame_.is_bound()) {
    calls_.gone.Run();
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
                     Answering(mojo::WrapCallbackWithDefaultInvokeIfNotRun(
                         std::move(callback), false,
                         std::string("the app's main process is gone"))));
}

void ElectronPage::SendSync(const std::string& channel,
                            const std::string& args_json,
                            SendSyncCallback callback) {
  std::optional<base::ListValue> args = ArgsFrom(args_json);
  if (!args.has_value()) {
    return;
  }
  // The page waits on this, so an app that goes must still answer it.
  calls_.sent_sync.Run(channel, std::move(*args),
                       Answering(mojo::WrapCallbackWithDefaultInvokeIfNotRun(
                           std::move(callback), false,
                           std::string("the app's main process is gone"))));
}

void ElectronPage::Post(const std::string& channel,
                        const std::string& message_json,
                        const std::vector<std::string>& ports) {
  std::optional<base::Value> message = JsonFrom(message_json);
  if (!message.has_value()) {
    return;
  }
  for (auto port = ports.begin(); port != ports.end(); ++port) {
    if (!IsPagePort(*port)) {
      return;
    } else if (std::find(ports.begin(), port, *port) != port) {
      receiver_.ReportBadMessage("ElectronFrameHost: a port posted twice");
      return;
    }
  }
  calls_.posted.Run(channel, std::move(*message), ports);
}

void ElectronPage::PostToPort(const std::string& port,
                              const std::string& data_json) {
  if (!IsPort(port)) {
    return;
  }
  std::optional<base::Value> data = JsonFrom(data_json);
  if (data.has_value()) {
    calls_.port_posted.Run(port, std::move(*data));
  }
}

void ElectronPage::PortClosed(const std::string& port) {
  if (IsPort(port)) {
    calls_.port_closed.Run(port);
  }
}

std::optional<base::Value> ElectronPage::JsonFrom(const std::string& json) {
  std::optional<base::Value> value =
      base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  if (!value.has_value()) {
    // The preload's bootstrap sends JSON.stringify's, always.
    receiver_.ReportBadMessage("ElectronFrameHost: a message not JSON");
  }
  return value;
}

bool ElectronPage::IsPort(const std::string& port) {
  if (!IsElectronPortName(port)) {
    receiver_.ReportBadMessage("ElectronFrameHost: not a port's name");
    return false;
  }
  return true;
}

bool ElectronPage::IsPagePort(const std::string& port) {
  if (!IsPort(port)) {
    return false;
  } else if (port[0] != 'r') {
    // The page posts the ports it made; the app's are the app's already.
    receiver_.ReportBadMessage("ElectronFrameHost: posted the app's port");
    return false;
  }
  return true;
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(ElectronPage);

}  // namespace domicile
