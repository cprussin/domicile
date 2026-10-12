// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/download_tally.h"

namespace domicile {

DownloadTally TallyDownloads(const std::vector<DownloadReading>& downloads) {
  DownloadTally tally;
  bool size_unknown = false;
  for (const DownloadReading& download : downloads) {
    if (!download.in_progress || !download.has_target) {
      continue;
    }
    ++tally.count;
    tally.received_bytes += download.received_bytes;
    tally.total_bytes += download.total_bytes;
    size_unknown |= download.total_bytes == 0;
  }
  if (size_unknown) {
    tally.total_bytes = 0;
  }
  return tally;
}

}  // namespace domicile
