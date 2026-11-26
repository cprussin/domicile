// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_FRAME_DOMICILE_DEVICE_DETAILS_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_FRAME_DOMICILE_DEVICE_DETAILS_H_

#include <cstdint>
#include <optional>

#include "base/containers/span.h"
#include "base/memory/scoped_refptr.h"
#include "third_party/blink/renderer/core/core_export.h"

namespace blink {

class ExecutionContext;
class ImageData;
class StaticBitmapImage;

// Domicile's engine fork. What a page that hides the device's details reads
// of it, farbled with its window's seed (LocalDOMWindow::
// SetDomicileDeviceDetailsSeed, which the browser sends before each
// navigation commits) by components/domicile/common/device_details.h. A
// context with no seed, a worker's or a page that keeps the truth, gets the
// truth. See docs/architecture/AD-BLOCKING.md.

// `context`'s seed: its window's, or else the nearest same-process parent
// frame's, so an `about:blank` frame a page makes reads as the page does.
CORE_EXPORT std::optional<uint64_t> DomicileDeviceDetailsSeed(
    const ExecutionContext* context);

// `navigator.hardwareConcurrency`, from the truth.
CORE_EXPORT unsigned DomicileHardwareConcurrency(
    const ExecutionContext* context,
    unsigned real);

// Audio a page rendered (OfflineAudioContext) or analyzed (AnalyserNode),
// in place.
CORE_EXPORT void DomicileFarbleAudio(const ExecutionContext* context,
                                     base::span<float> samples);

// A canvas's pixels a page reads back with getImageData, in place.
CORE_EXPORT void DomicileFarbleImageData(const ExecutionContext* context,
                                         ImageData& image_data);

// A canvas's picture a page exports with toDataURL or toBlob: a farbled
// copy, or `image` itself for a context that keeps the truth.
CORE_EXPORT scoped_refptr<StaticBitmapImage> DomicileFarbledImage(
    const ExecutionContext* context,
    scoped_refptr<StaticBitmapImage> image);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_FRAME_DOMICILE_DEVICE_DETAILS_H_
