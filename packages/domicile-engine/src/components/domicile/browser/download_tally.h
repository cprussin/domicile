// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DOWNLOAD_TALLY_H_
#define COMPONENTS_DOMICILE_BROWSER_DOWNLOAD_TALLY_H_

#include <cstdint>
#include <vector>

namespace domicile {

// Where a download is, from its DownloadItem's state.
enum class DownloadStage {
  kInProgress,
  kComplete,
  // Canceled or interrupted.
  kStopped,
};

// One download from a <webview>'s page, as WebViewGuest reads it off its
// DownloadItem.
struct DownloadReading {
  DownloadStage stage;
  // Whether the shell has said where it goes. Until then the shell's picker is
  // open.
  bool has_target;
  int64_t received_bytes;
  // 0 when the server sent no size.
  int64_t total_bytes;
};

// A <webview>'s downloads, as the element reports them. See DownloadsChanged
// in components/domicile/mojom/web_view_guest.mojom.
struct DownloadTally {
  int32_t count = 0;
  int64_t received_bytes = 0;
  // 0 when any counted download's size is unknown.
  int64_t total_bytes = 0;
  // Downloads that finished, until the shell clears them.
  int32_t completed = 0;

  friend bool operator==(const DownloadTally&, const DownloadTally&) = default;
};

// Adds up the downloads in progress that the shell has placed, and counts the
// finished ones.
DownloadTally TallyDownloads(const std::vector<DownloadReading>& downloads);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DOWNLOAD_TALLY_H_
