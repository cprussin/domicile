// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SCREEN_CHOICE_H_
#define COMPONENTS_DOMICILE_BROWSER_SCREEN_CHOICE_H_

#include <memory>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "third_party/blink/public/mojom/mediastream/media_stream.mojom.h"
#include "third_party/webrtc/modules/desktop_capture/delegated_source_list_controller.h"
#include "third_party/webrtc/modules/desktop_capture/desktop_capturer.h"

namespace domicile {

// Asks the desktop's ScreenCast portal what a page's `getDisplayMedia()`
// shares, before the page is answered, so a cancel in the shell's picker
// refuses it. Answered after capture starts instead, a cancel ended a share the
// page had already been given, and Meet asked again.
//
// The picker is webrtc's PipeWire capturer's delegated source list. A pick
// leaves the portal's restore token under the capturer's source id, which the
// answer names; see PortalScreenCapture. Chrome's own picker does the same on
// Wayland (NativeDesktopMediaList).
class ScreenChoice : public webrtc::DesktopCapturer::Callback,
                     public webrtc::DelegatedSourceListController::Observer {
 public:
  // The page's answer: its devices, empty unless `result` is OK.
  using Answer =
      base::OnceCallback<void(blink::mojom::StreamDevicesSetPtr,
                              blink::mojom::MediaStreamRequestResult)>;

  // Opens the portal through `capturer`, which has a delegated source list.
  // `answer` runs once, from a posted task, so it may destroy this; that ends
  // the picker's own portal session.
  ScreenChoice(std::unique_ptr<webrtc::DesktopCapturer> capturer,
               Answer answer);

  ScreenChoice(const ScreenChoice&) = delete;
  ScreenChoice& operator=(const ScreenChoice&) = delete;

  ~ScreenChoice() override;

 private:
  // webrtc::DesktopCapturer::Callback. Nothing asks the picker for frames.
  void OnCaptureResult(webrtc::DesktopCapturer::Result result,
                       std::unique_ptr<webrtc::DesktopFrame> frame) override;

  // webrtc::DelegatedSourceListController::Observer.
  void OnSelection() override;
  void OnCancelled() override;
  void OnError() override;

  // Runs `answer_` with `devices` and `result` from a posted task, unless this
  // is destroyed first.
  void Reply(blink::mojom::StreamDevicesSetPtr devices,
             blink::mojom::MediaStreamRequestResult result);
  void RunAnswer(blink::mojom::StreamDevicesSetPtr devices,
                 blink::mojom::MediaStreamRequestResult result);

  std::unique_ptr<webrtc::DesktopCapturer> capturer_;
  Answer answer_;
  base::WeakPtrFactory<ScreenChoice> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SCREEN_CHOICE_H_
