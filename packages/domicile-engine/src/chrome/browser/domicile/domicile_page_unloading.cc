// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_page_unloading.h"

#include <utility>
#include <vector>

#include "base/barrier_closure.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "components/services/storage/public/mojom/local_storage_control.mojom.h"
#include "components/services/storage/public/mojom/storage_usage_info.mojom.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/storage_partition.h"

namespace domicile {
namespace {

// Added to the 10 s `EndSession` may wait for its own writes, it must stay
// under the launcher's 15 s (`TO_STOP`).
constexpr base::TimeDelta kLimit = base::Seconds(2);

std::vector<content::StoragePartition*> LoadedPartitions() {
  std::vector<content::StoragePartition*> partitions;
  for (Profile* profile :
       g_browser_process->profile_manager()->GetLoadedProfiles()) {
    profile->ForEachLoadedStoragePartition(
        [&partitions](content::StoragePartition* partition) {
          partitions.push_back(partition);
        });
  }
  return partitions;
}

class PageUnloading {
 public:
  explicit PageUnloading(base::OnceClosure done) : done_(std::move(done)) {}

  void Start() {
    limit_.Start(FROM_HERE, kLimit,
                 base::BindOnce(&PageUnloading::RunOutOfTime,
                                base::Unretained(this)));
    UnloadBrowserWindowsForExit(
        base::BindOnce(&PageUnloading::WriteStorage, base::Unretained(this)));
  }

 private:
  void WriteStorage() {
    const std::vector<content::StoragePartition*> partitions =
        LoadedPartitions();
    const base::RepeatingClosure written = base::BarrierClosure(
        partitions.size(),
        base::BindOnce(&PageUnloading::Finish, base::Unretained(this)));
    for (content::StoragePartition* partition : partitions) {
      partition->Flush();
      // `Flush` has no reply. The usage is read from the database behind the
      // writes, so its reply is theirs.
      partition->GetLocalStorageControl()->GetUsage(
          base::IgnoreArgs<std::vector<storage::mojom::StorageUsageInfoPtr>>(
              written));
    }
  }

  void RunOutOfTime() {
    VLOG(1) << "domicile: pages were still unloading at the exit's limit.";
    Finish();
  }

  void Finish() {
    limit_.Stop();
    if (done_) {
      std::move(done_).Run();
    }
  }

  base::OnceClosure done_;
  base::OneShotTimer limit_;
};

}  // namespace

void LetPagesUnload(base::OnceClosure done) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Lives for the rest of the browser.
  static base::NoDestructor<PageUnloading> unloading(std::move(done));
  unloading->Start();
}

}  // namespace domicile
