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

ScreenChoice::ScreenChoice(std::unique_ptr<webrtc::DesktopCapturer> capturer,
                           Answer answer)
    : capturer_(std::move(capturer)), answer_(std::move(answer)) {
  webrtc::DelegatedSourceListController* const list =
      capturer_->GetDelegatedSourceListController();
  CHECK(list);
  list->Observe(this);
  // webrtc's PipeWire capturer opens the portal as it starts.
  capturer_->Start(this);
}

ScreenChoice::~ScreenChoice() = default;

void ScreenChoice::OnCaptureResult(
    webrtc::DesktopCapturer::Result result,
    std::unique_ptr<webrtc::DesktopFrame> frame) {
  NOTREACHED();
}

void ScreenChoice::OnSelection() {
  webrtc::DesktopCapturer::SourceList sources;
  CHECK(capturer_->GetSourceList(&sources));
  CHECK_EQ(sources.size(), 1u);
  Reply(PortalScreenCapture(sources[0].id),
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
