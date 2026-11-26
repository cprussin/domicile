// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "content/public/browser/domicile_code_cache.h"

#include "base/check.h"
#include "base/files/file_path.h"
#include "content/browser/code_cache/generated_code_cache_context.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/storage_partition.h"

namespace content {

void SetDomicileCodeCachePath(StoragePartition& partition,
                              const base::FilePath& path) {
  DCHECK_CURRENTLY_ON(BrowserThread::UI);
  GeneratedCodeCacheContext* context =
      partition.GetGeneratedCodeCacheContext();
  // Every partition the browser makes has one.
  CHECK(context);
  // Initialized as the partition was made, so the caches move, with a size
  // disk_cache chooses as the partition's did.
  context->DomicileMoveTo(path, /*max_bytes=*/0);
}

}  // namespace content
