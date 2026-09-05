// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/domicile/domicile_frame_sink_broker.h"

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "content/browser/compositor/surface_utils.h"
#include "content/public/browser/browser_thread.h"

namespace content {

domicile::FrameSinkBroker& GetDomicileFrameSinkBroker() {
  CHECK_CURRENTLY_ON(BrowserThread::UI);
  static base::NoDestructor<domicile::FrameSinkBroker> broker(
      GetHostFrameSinkManager(), base::BindRepeating(&AllocateFrameSinkId));
  return *broker;
}

}  // namespace content
