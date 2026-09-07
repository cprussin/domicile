// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/graphics/external_surface_embedder.h"

#include <map>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "components/viz/common/surfaces/parent_local_surface_id_allocator.h"
#include "third_party/blink/public/common/thread_safe_browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/platform.h"

namespace blink {
namespace {

// One external surface per app, shared by every element that names that app.
//
// Sharing within an app is what lets a page put several <app> elements side by
// side against a single producer, which is how the CSS measurement compares
// each property against an ordinary element beside it. Not sharing *across*
// apps is what a desktop is: a shell has many windows and each element shows
// the one it names.
//
// Keying it is not a nicety. A LocalSurfaceId carries an embed_token, and viz
// keys SurfaceAllocationGroup on that token alone — SurfaceManager's
// GetOrCreateAllocationGroupForSurfaceId refuses a second FrameSinkId under a
// token another sink already owns, "Cannot reuse embed token across frame
// sinks", and the surface is never created. One allocator for the whole
// renderer gives every app the same token, so the second window's surface does
// not exist and the element embedding it resolves through the first window's
// allocation group instead: two <app> elements, both showing window one. That
// is what spike-two-windows.sh measured.
//
// The second reason is resizing. kReconfigure bumps the parent sequence
// number, and one allocator would bump it for every app at once — resizing one
// window would hand every other window's producer a surface id it was never
// told about.
//
// What does not change is who allocates: the embedder, because the embed_token
// is the capability the producer needs in order to submit at all.
viz::ParentLocalSurfaceIdAllocator& AllocatorForApp(const String& app_id) {
  static base::NoDestructor<
      std::map<std::string, viz::ParentLocalSurfaceIdAllocator>>
      allocators;
  return (*allocators)[app_id.Utf8()];
}

}  // namespace

ExternalSurfaceEmbedder::ExternalSurfaceEmbedder() = default;

ExternalSurfaceEmbedder::~ExternalSurfaceEmbedder() = default;

void ExternalSurfaceEmbedder::Embed(
    const String& app_id,
    const viz::FrameSinkId& parent_frame_sink_id,
    const gfx::Size& size,
    Allocation allocation,
    EmbeddedCallback callback) {
  if (!provider_) {
    Platform::Current()->GetBrowserInterfaceBroker()->GetInterface(
        provider_.BindNewPipeAndPassReceiver());
  }

  // Resolved before the round trip rather than after it: this half of the
  // SurfaceId is ours, and the browser needs it in order to hand it to the
  // producer, which cannot invent one.
  viz::ParentLocalSurfaceIdAllocator& allocator = AllocatorForApp(app_id);
  if (allocation == Allocation::kReconfigure ||
      !allocator.HasValidLocalSurfaceId()) {
    allocator.GenerateId();
  }
  const viz::LocalSurfaceId local_surface_id =
      allocator.GetCurrentLocalSurfaceId();

  // THROWAWAY, with the rest of the spike. Which surface each element asked
  // for and which one it got are the two facts a page showing the wrong
  // window turns on, and until this line existed neither was written down
  // anywhere: the browser knows the FrameSinkId and the page knows the
  // element, and only here are both in one place.
  LOG(INFO) << "domicile: embedding \"" << app_id.Utf8() << "\" at "
            << local_surface_id.ToString() << " under "
            << parent_frame_sink_id.ToString() << ", " << size.ToString();

  provider_->Embed(
      app_id, parent_frame_sink_id, local_surface_id, size,
      base::BindOnce(&ExternalSurfaceEmbedder::OnEmbedded,
                     base::Unretained(this), std::move(callback), app_id,
                     local_surface_id));
}

void ExternalSurfaceEmbedder::OnEmbedded(
    EmbeddedCallback callback,
    const String& app_id,
    const viz::LocalSurfaceId& local_surface_id,
    const std::optional<viz::FrameSinkId>& frame_sink_id) {
  if (!frame_sink_id) {
    LOG(INFO) << "domicile: no surface for \"" << app_id.Utf8() << "\"";
    std::move(callback).Run(std::nullopt);
    return;
  }
  const viz::SurfaceId surface_id(*frame_sink_id, local_surface_id);
  LOG(INFO) << "domicile: embedded \"" << app_id.Utf8() << "\" as "
            << surface_id.ToString();
  std::move(callback).Run(surface_id);
}

}  // namespace blink
