// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SCREEN_CHOICE_H_
#define COMPONENTS_DOMICILE_BROWSER_SCREEN_CHOICE_H_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "components/domicile/browser/portal_picker.h"
#include "components/domicile/browser/screen_capture.h"
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
//
// The answer is the surface the user picked, with its sound when the page
// asks for audio, as the compositor tells of the pick's node. A browser
// window is captured as a tab instead.
class ScreenChoice : public webrtc::DesktopCapturer::Callback,
                     public webrtc::DelegatedSourceListController::Observer {
 public:
  // The page's answer: its devices, empty unless `result` is OK.
  using Answer =
      base::OnceCallback<void(blink::mojom::StreamDevicesSetPtr,
                              blink::mojom::MediaStreamRequestResult)>;

  // Asks the desktop what node `node`'s stream shows. See
  // AskWhatThePortalPicked.
  using Ask =
      base::OnceCallback<void(uint32_t node, ToldWhatThePortalPicked told)>;

  // The answer for browser window `window`'s page as a tab (see TabCapture),
  // or null once it has closed.
  using CaptureBrowserWindow =
      base::OnceCallback<blink::mojom::StreamDevicesSetPtr(
          const std::string& window)>;

  // Opens the portal through `picker`. `audio` is whether the page asks for
  // sound. `answer` runs once, from a posted task, so it may destroy this;
  // that ends the picker's own portal session.
  ScreenChoice(std::unique_ptr<PortalPicker> picker,
               bool audio,
               Ask ask,
               CaptureBrowserWindow capture_browser_window,
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

  // The desktop told what pick `source` shows.
  void Told(webrtc::DesktopCapturer::SourceId source,
            std::optional<PortalPick> pick);

  // Runs `answer_` with `devices` and `result` from a posted task, unless this
  // is destroyed first.
  void Reply(blink::mojom::StreamDevicesSetPtr devices,
             blink::mojom::MediaStreamRequestResult result);
  void RunAnswer(blink::mojom::StreamDevicesSetPtr devices,
                 blink::mojom::MediaStreamRequestResult result);

  std::unique_ptr<PortalPicker> picker_;
  const bool audio_;
  Ask ask_;
  CaptureBrowserWindow capture_browser_window_;
  Answer answer_;
  base::WeakPtrFactory<ScreenChoice> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SCREEN_CHOICE_H_
