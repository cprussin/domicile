// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/download_tally.h"

namespace domicile {

DownloadTally TallyDownloads(const std::vector<DownloadReading>& downloads) {
  DownloadTally tally;
  bool size_unknown = false;
  for (const DownloadReading& download : downloads) {
    switch (download.stage) {
      case DownloadStage::kInProgress:
        if (download.has_target) {
          ++tally.count;
          tally.received_bytes += download.received_bytes;
          tally.total_bytes += download.total_bytes;
          size_unknown |= download.total_bytes == 0;
        }
        break;
      case DownloadStage::kComplete:
        ++tally.completed;
        break;
      case DownloadStage::kStopped:
        break;
    }
  }
  if (size_unknown) {
    tally.total_bytes = 0;
  }
  return tally;
}

}  // namespace domicile
