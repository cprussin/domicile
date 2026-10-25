// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/screen_choice.h"

#include <utility>

#include "base/check.h"
#include "base/check_op.h"
#include "base/functional/bind.h"
#include "base/notreached.h"
#include "base/task/sequenced_task_runner.h"
#include "components/domicile/browser/screen_capture.h"

namespace domicile {

ScreenChoice::ScreenChoice(std::unique_ptr<PortalPicker> picker,
                           bool audio,
                           Ask ask,
                           CaptureBrowserWindow capture_browser_window,
                           Answer answer)
    : picker_(std::move(picker)),
      audio_(audio),
      ask_(std::move(ask)),
      capture_browser_window_(std::move(capture_browser_window)),
      answer_(std::move(answer)) {
  webrtc::DelegatedSourceListController* const list =
      picker_->capturer().GetDelegatedSourceListController();
  CHECK(list);
  list->Observe(this);
  // webrtc's PipeWire capturer opens the portal as it starts.
  picker_->capturer().Start(this);
}

ScreenChoice::~ScreenChoice() = default;

void ScreenChoice::OnCaptureResult(
    webrtc::DesktopCapturer::Result result,
    std::unique_ptr<webrtc::DesktopFrame> frame) {
  NOTREACHED();
}

void ScreenChoice::OnSelection() {
  webrtc::DesktopCapturer::SourceList sources;
  CHECK(picker_->capturer().GetSourceList(&sources));
  CHECK_EQ(sources.size(), 1u);
  // The portal answers a request once.
  CHECK(ask_);
  std::move(ask_).Run(
      picker_->node(),
      base::BindOnce(&ScreenChoice::Told, weak_factory_.GetWeakPtr(),
                     sources[0].id));
}

void ScreenChoice::Told(webrtc::DesktopCapturer::SourceId source,
                        std::optional<PortalPick> pick) {
  if (pick.has_value() && !pick->browser_window.empty()) {
    blink::mojom::StreamDevicesSetPtr tab =
        std::move(capture_browser_window_).Run(pick->browser_window);
    if (tab) {
      Reply(std::move(tab), blink::mojom::MediaStreamRequestResult::OK);
      return;
    }
  }
  // A desktop that cannot say is answered as before it could: a monitor,
  // with no sound.
  Reply(PortalScreenCapture(source, pick.value_or(PortalPick()), audio_),
        blink::mojom::MediaStreamRequestResult::OK);
}

void ScreenChoice::OnCancelled() {
  Reply(blink::mojom::StreamDevicesSet::New(),
        blink::mojom::MediaStreamRequestResult::PERMISSION_DENIED_BY_USER);
}

void ScreenChoice::OnError() {
  Reply(blink::mojom::StreamDevicesSet::New(),
        blink::mojom::MediaStreamRequestResult::TRACK_START_FAILURE_VIDEO);
}

void ScreenChoice::Reply(blink::mojom::StreamDevicesSetPtr devices,
                         blink::mojom::MediaStreamRequestResult result) {
  // Posted: the portal calls from inside the capturer, which the answer's
  // owner destroys.
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&ScreenChoice::RunAnswer, weak_factory_.GetWeakPtr(),
                     std::move(devices), result));
}

void ScreenChoice::RunAnswer(blink::mojom::StreamDevicesSetPtr devices,
                             blink::mojom::MediaStreamRequestResult result) {
  // The portal answers a request once.
  CHECK(answer_);
  std::move(answer_).Run(std::move(devices), result);
}

}  // namespace domicile
