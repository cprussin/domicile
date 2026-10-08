// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_permissions.h"

#include <memory>
#include <optional>
#include <utility>
#include <variant>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "components/domicile/browser/site_permissions.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/permissions/permission_prompt.h"
#include "components/permissions/permission_request.h"
#include "components/permissions/permission_request_manager.h"
#include "components/permissions/permission_uma_constants.h"
#include "components/permissions/resolvers/permission_prompt_options.h"
#include "content/public/browser/media_stream_request.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "url/origin.h"

namespace domicile {
namespace {

// A prompt the shell answers. Lives while PermissionRequestManager shows it.
//
// Every answer is acted on in a later task. Acting deletes this prompt, and an
// answer can arrive while the manager is still making it: a closed pipe
// answers as soon as it is asked.
class ShellPermissionPrompt : public permissions::PermissionPrompt {
 public:
  // Asks `guest` for `permissions`, or, given nothing, ignores the request
  // without asking.
  ShellPermissionPrompt(
      WebViewGuest& guest,
      Delegate& delegate,
      std::optional<std::vector<mojom::WebViewPermission>> permissions)
      : guest_(guest.GetWeakPtr()), delegate_(&delegate) {
    if (!permissions.has_value()) {
      LOG(WARNING) << "domicile: a <webview>'s page asked for a permission "
                      "the shell is not asked about; it is ignored.";
      Answered(std::nullopt);
      return;
    }
    asking_ = true;
    guest.AskPermission(delegate.GetRequestingOrigin(),
                        std::move(*permissions),
                        base::BindOnce(&ShellPermissionPrompt::Answered,
                                       weak_factory_.GetWeakPtr()));
  }

  ShellPermissionPrompt(const ShellPermissionPrompt&) = delete;
  ShellPermissionPrompt& operator=(const ShellPermissionPrompt&) = delete;

  // The manager drops a prompt for a navigation, a hidden tab or a decision.
  // Only the first two leave the shell holding a request.
  ~ShellPermissionPrompt() override {
    if (asking_ && guest_) {
      guest_->WithdrawPermissionRequest();
    }
  }

  // permissions::PermissionPrompt:
  bool UpdateAnchor() override { return true; }
  // Hidden with the guest, and asked again when it shows: a window on another
  // workspace waits for the user to see it.
  TabSwitchingBehavior GetTabSwitchingBehavior() override {
    return kDestroyPromptButKeepRequestPending;
  }
  permissions::PermissionPromptDisposition GetPromptDisposition()
      const override {
    return permissions::PermissionPromptDisposition::ANCHORED_BUBBLE;
  }
  bool IsAskPrompt() const override { return true; }
  std::optional<gfx::Rect> GetViewBoundsInScreen() const override {
    return std::nullopt;
  }
  std::vector<permissions::ElementAnchoredBubbleVariant> GetPromptVariants()
      const override {
    return {};
  }
  std::optional<permissions::feature_params::PermissionElementPromptPosition>
  GetPromptPosition() const override {
    return std::nullopt;
  }

 private:
  void Answered(std::optional<mojom::WebViewPermissionAnswer> answer) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ShellPermissionPrompt::Decide,
                                  weak_factory_.GetWeakPtr(), answer));
  }

  // Deletes this prompt.
  void Decide(std::optional<mojom::WebViewPermissionAnswer> answer) {
    asking_ = false;
    const PromptOptions options = std::monostate();
    if (!answer.has_value()) {
      delegate_->Ignore(options);
      return;
    }
    switch (*answer) {
      case mojom::WebViewPermissionAnswer::kAllow:
        delegate_->Accept(options);
        return;
      case mojom::WebViewPermissionAnswer::kDeny:
        delegate_->Deny(options);
        return;
      case mojom::WebViewPermissionAnswer::kDismiss:
        delegate_->Dismiss(options);
        return;
    }
  }

  const base::WeakPtr<WebViewGuest> guest_;
  // Owns this prompt.
  const raw_ptr<Delegate> delegate_;
  // Whether the shell holds the request.
  bool asking_ = false;
  base::WeakPtrFactory<ShellPermissionPrompt> weak_factory_{this};
};

// The kinds `delegate`'s requests ask for, or nothing if any has no kind.
std::optional<std::vector<mojom::WebViewPermission>> PermissionsAsked(
    const permissions::PermissionPrompt::Delegate& delegate) {
  std::vector<mojom::WebViewPermission> asked;
  for (const std::unique_ptr<permissions::PermissionRequest>& request :
       delegate.Requests()) {
    const std::optional<mojom::WebViewPermission> permission =
        PermissionForRequest(request->request_type());
    if (!permission.has_value()) {
      return std::nullopt;
    }
    asked.push_back(*permission);
  }
  return asked;
}

std::unique_ptr<permissions::PermissionPrompt> MakePrompt(
    content::WebContents* contents,
    permissions::PermissionPrompt::Delegate* delegate) {
  // AttachPermissionPrompts gives a manager only to guests.
  WebViewGuest* guest = WebViewGuest::FromWebContents(contents);
  CHECK(guest);
  return std::make_unique<ShellPermissionPrompt>(*guest, *delegate,
                                                 PermissionsAsked(*delegate));
}

class ChromeMediaAccess : public MediaAccess {
 public:
  // No extension: a guest's page is a site, and an extension popup's
  // microphone goes through the prompt like any other page's.
  void Request(content::WebContents& contents,
               const content::MediaStreamRequest& request,
               content::MediaResponseCallback callback) override {
    MediaCaptureDevicesDispatcher::GetInstance()->ProcessMediaAccessRequest(
        &contents, request, std::move(callback), /*extension=*/nullptr);
  }

  bool Check(content::RenderFrameHost& frame,
             const url::Origin& origin,
             blink::mojom::MediaStreamType type) override {
    return MediaCaptureDevicesDispatcher::GetInstance()
        ->CheckMediaAccessPermission(&frame, origin, type);
  }
};

}  // namespace

void AttachPermissionPrompts(content::WebContents& guest) {
  permissions::PermissionRequestManager::CreateForWebContents(&guest);
  // Patch 0103 adds the setter.
  permissions::PermissionRequestManager::FromWebContents(&guest)
      ->set_view_factory(base::BindRepeating(&MakePrompt));
}

void UseChromeForGuestMedia() {
  static base::NoDestructor<ChromeMediaAccess> access;
  WebViewGuest::SetMediaAccess(access.get());
}

}  // namespace domicile
