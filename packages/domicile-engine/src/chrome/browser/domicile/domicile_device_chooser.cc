// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_device_chooser.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/ui/dialogs/browser_dialogs.h"
#include "components/domicile/browser/device_choices.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/permissions/chooser_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"
#include "mojo/public/cpp/bindings/message.h"

namespace domicile {
namespace {

constexpr char kNotAnAnswer[] =
    "domicile: a <webview> answered a device request with devices it was not "
    "offered.";

// A chooser the shell draws, for one guest. Owned by the guest's WebContents,
// so a guest has at most one; it deletes itself when the chooser ends.
//
// Every answer is acted on in a later task. Acting deletes the controller, and
// an answer can arrive while the controller is still making this chooser: a
// closed pipe answers as soon as it is asked.
class ShellDeviceChooser
    : public content::WebContentsUserData<ShellDeviceChooser>,
      public permissions::ChooserController::View {
 public:
  ShellDeviceChooser(const ShellDeviceChooser&) = delete;
  ShellDeviceChooser& operator=(const ShellDeviceChooser&) = delete;

  ~ShellDeviceChooser() override {
    // Null once Release has handed the controller back.
    if (controller_) {
      controller_->set_view(nullptr);
    }
  }

  // Asks the shell. Returns the closure Chrome closes the chooser with.
  base::OnceClosure Ask() {
    guest_->AskForDevice(base::UTF16ToUTF8(controller_->GetTitle()),
                         controller_->AllowMultipleSelection(),
                         base::BindOnce(&ShellDeviceChooser::Answered,
                                        weak_factory_.GetWeakPtr()));
    return base::BindOnce(&ShellDeviceChooser::Withdraw,
                          weak_factory_.GetWeakPtr());
  }

  // Ends the chooser unanswered and tells the shell. Deletes this.
  void Withdraw() {
    // Gone only while its WebContents is destroyed, which destroys the page
    // waiting on this chooser too.
    if (guest_) {
      guest_->WithdrawDeviceRequest();
    }
    Release()->Close();
  }

  // permissions::ChooserController::View:
  void OnOptionsInitialized() override { Relist(); }
  void OnOptionAdded(size_t index) override {
    choices_.Added(index);
    Offer();
  }
  void OnOptionRemoved(size_t index) override {
    choices_.Removed(index);
    Offer();
  }
  void OnOptionUpdated(size_t index) override { Offer(); }
  // A Bluetooth adapter turning off or losing permission clears the devices
  // without OnOptionRemoved, and Web Serial's wireless ports report it in
  // place of OnOptionsInitialized. Either way the list is read afresh.
  void OnAdapterEnabledChanged(bool enabled) override { Relist(); }
  void OnAdapterAuthorizationChanged(bool authorized) override { Relist(); }
  // No rescan is offered.
  void OnRefreshStateChanged(bool refreshing) override {}

 private:
  friend class content::WebContentsUserData<ShellDeviceChooser>;

  ShellDeviceChooser(content::WebContents* contents,
                     WebViewGuest& guest,
                     std::unique_ptr<permissions::ChooserController> controller)
      : content::WebContentsUserData<ShellDeviceChooser>(*contents),
        guest_(guest.GetWeakPtr()),
        controller_(std::move(controller)) {
    controller_->set_view(this);
  }

  // Reads every device afresh, as listed.
  void Relist() {
    listed_ = true;
    choices_.Listed(controller_->NumOptions());
    Offer();
  }

  // Sends the shell the devices, by id, once listed.
  void Offer() {
    // Web Serial adds devices as they appear, before its list. Guest: see
    // Withdraw.
    if (!listed_ || !guest_) {
      return;
    }
    std::vector<mojom::WebViewDevicePtr> devices;
    for (size_t i = 0; i < choices_.ids().size(); ++i) {
      devices.push_back(mojom::WebViewDevice::New(
          choices_.ids()[i], base::UTF16ToUTF8(controller_->GetOption(i))));
    }
    guest_->OfferDevices(std::move(devices));
  }

  // Runs as the shell's answer arrives, so a bad one is reported against the
  // message that carried it.
  void Answered(const std::optional<std::vector<int32_t>>& chosen) {
    std::optional<std::vector<size_t>> indices;
    if (chosen.has_value()) {
      indices =
          choices_.IndicesOf(*chosen, controller_->AllowMultipleSelection());
      if (!indices.has_value()) {
        mojo::ReportBadMessage(kNotAnAnswer);
      }
    }
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ShellDeviceChooser::Decide,
                                  weak_factory_.GetWeakPtr(), indices));
  }

  // Picks `indices`, or cancels for nothing or none: a device picked as it
  // was unplugged leaves none. Deletes this.
  void Decide(const std::optional<std::vector<size_t>>& indices) {
    const bool chosen = indices.has_value() && !indices->empty();
    LOG(INFO) << "domicile: a <webview>'s device request was answered with "
              << (chosen ? indices->size() : 0) << " device(s).";
    std::unique_ptr<permissions::ChooserController> controller = Release();
    if (chosen) {
      controller->Select(*indices);
    } else {
      controller->Cancel();
    }
  }

  // Deletes this and returns the controller, for one last call.
  //
  // Weak pointers go first: the controller's last call answers the page, and
  // Chrome then runs the closure Ask returned.
  std::unique_ptr<permissions::ChooserController> Release() {
    weak_factory_.InvalidateWeakPtrs();
    controller_->set_view(nullptr);
    std::unique_ptr<permissions::ChooserController> controller =
        std::move(controller_);
    GetWebContents().RemoveUserData(UserDataKey());
    return controller;
  }

  const base::WeakPtr<WebViewGuest> guest_;
  std::unique_ptr<permissions::ChooserController> controller_;
  DeviceChoices choices_;
  // Whether the controller has listed its devices.
  bool listed_ = false;
  base::WeakPtrFactory<ShellDeviceChooser> weak_factory_{this};

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(ShellDeviceChooser);

// Chrome's DeviceChooserOverride.
base::OnceClosure ShowDeviceChooser(
    content::RenderFrameHost* owner,
    std::unique_ptr<permissions::ChooserController> controller) {
  content::WebContents* contents =
      content::WebContents::FromRenderFrameHost(owner);
  WebViewGuest* guest = WebViewGuest::FromWebContents(contents);
  // Web Bluetooth's scanning prompt asks to allow scanning, with no device to
  // pick, so it is no chooser. Refused, as before.
  if (controller->TableViewAlwaysDisabled()) {
    LOG(WARNING) << "domicile: a page asked to scan for Bluetooth devices; it "
                    "is refused.";
    return base::DoNothing();
  }
  if (!guest) {
    LOG(WARNING) << "domicile: a page outside any <webview> asked for a "
                    "device; it gets none.";
    return base::DoNothing();
  }
  if (ShellDeviceChooser* older =
          ShellDeviceChooser::FromWebContents(contents)) {
    older->Withdraw();
  }
  ShellDeviceChooser::CreateForWebContents(contents, *guest,
                                           std::move(controller));
  return ShellDeviceChooser::FromWebContents(contents)->Ask();
}

}  // namespace

void UseTheShellForDeviceChoosers() {
  chrome::SetDeviceChooserOverride(&ShowDeviceChooser);
}

}  // namespace domicile
