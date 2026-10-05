// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PLACEHOLDER_STAGE_H_
#define COMPONENTS_DOMICILE_BROWSER_PLACEHOLDER_STAGE_H_

class GURL;

namespace domicile {

// How far the browser has heard of the frame a <webview> asks a guest for.
//
// The element creates its frame on about:blank, and Blink commits that page
// synchronously (crbug.com/778318). The renderer reports the frame and then the
// commit over the frame's channel, but asks for the guest over a pipe of its
// own, so the request can reach the browser before either.
enum class PlaceholderStage {
  // The browser has no frame by that token yet.
  kAbsent,
  // The browser has the frame, but not its about:blank commit. Attaching now
  // turns the frame into an outer delegate before the commit arrives. The
  // commit then lands in a frame its WebContents no longer counts as loading,
  // and PageLoadMetricsWebContentsObserver DCHECKs on it.
  kCommitting,
  // The commit has arrived. The frame can take a guest.
  kReady,
};

// The stage of a frame the browser has (`frame_exists`) with
// `last_committed_url`, which is empty until the frame's first commit.
PlaceholderStage StageOf(bool frame_exists, const GURL& last_committed_url);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PLACEHOLDER_STAGE_H_
