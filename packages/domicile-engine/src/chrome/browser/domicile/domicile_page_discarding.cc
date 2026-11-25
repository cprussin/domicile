// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_page_discarding.h"

#include <algorithm>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/byte_size.h"
#include "base/feature_list.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/metrics/field_trial_params.h"
#include "base/system/sys_info.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "components/domicile/browser/memory_stall.h"
#include "components/performance_manager/public/decorators/page_live_state_decorator.h"
#include "components/performance_manager/public/graph/page_node.h"
#include "components/performance_manager/public/performance_manager.h"
#include "content/public/browser/web_contents.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using performance_manager::PageLiveStateDecorator;
using performance_manager::PageNode;
using performance_manager::PerformanceManager;

BASE_FEATURE(kDomicilePageDiscarding,
             "DomicilePageDiscarding",
             base::FEATURE_ENABLED_BY_DEFAULT);
// Chrome's own, which it has for Windows alone
// (kSustainedPMUrgentDiscarding_PercentAvailableMemory).
const base::FeatureParam<int> kAvailablePercent{&kDomicilePageDiscarding,
                                                "available_percent", 15};
// Or this share of the last ten seconds with a task waiting on memory.
const base::FeatureParam<double> kStalledPercent{&kDomicilePageDiscarding,
                                                 "stalled_percent", 10};
// As DiscardEligibilityPolicy: how long a page stays after it is hidden, and
// after it was last heard.
const base::FeatureParam<base::TimeDelta> kHiddenFor{
    &kDomicilePageDiscarding, "hidden_for", base::Minutes(10)};
constexpr base::TimeDelta kSilentFor = base::Minutes(1);
// UrgentPageDiscardingPolicy's.
constexpr base::TimeDelta kInterval = base::Seconds(5);

bool IsShortOfMemory() {
  const base::ByteSize total = base::SysInfo::AmountOfTotalPhysicalMemory();
  const base::ByteSize available =
      base::SysInfo::AmountOfAvailablePhysicalMemory();
  if (available.InBytesF() * 100 < total.InBytesF() * kAvailablePercent.Get()) {
    return true;
  }
  // A kernel without pressure accounting has no such file.
  std::string pressure;
  if (!base::ReadFileToString(base::FilePath("/proc/pressure/memory"),
                              &pressure)) {
    return false;
  }
  const std::optional<double> stalled = StalledPercent(pressure);
  return stalled.has_value() && *stalled >= kStalledPercent.Get();
}

// Whether `page` may go without the user missing anything: the rules of
// DiscardEligibilityPolicy for an urgent discard. Its PageType rule is why
// that policy itself cannot be asked.
bool MayDiscard(content::WebContents& page, const PageNode& node) {
  const base::TimeTicks now = base::TimeTicks::Now();
  const PageNode::VisibilityState visibility = node.GetVisibilityState();
  if (visibility.is_visible ||
      now - visibility.last_change_time < kHiddenFor.Get() ||
      page.IsBeingCaptured()) {
    return false;
  }
  const PageNode::AudibleState audible = node.GetAudibleState();
  if (audible.is_audible || (audible.last_change_time.has_value() &&
                             now - *audible.last_change_time < kSilentFor)) {
    return false;
  }
  if (node.HasPictureInPicture() || node.HadFormInteraction() ||
      node.HadUserEdits() ||
      // A PDF's form is not kept, nor where it was scrolled to.
      node.GetContentsMimeType() == "application/pdf" ||
      !node.GetMainFrameUrl().SchemeIsHTTPOrHTTPS()) {
    return false;
  }
  const PageLiveStateDecorator::Data* live =
      PageLiveStateDecorator::Data::FromPageNode(&node);
  return live == nullptr ||
         (live->IsAutoDiscardable() && !live->IsCapturingVideo() &&
          !live->IsCapturingAudio() && !live->IsBeingMirrored() &&
          !live->IsCapturingWindow() && !live->IsCapturingDisplay() &&
          !live->IsConnectedToBluetoothDevice() &&
          !live->IsConnectedToUSBDevice() && !live->IsConnectedToHidDevice() &&
          !live->IsConnectedToSerialPort() && !live->IsDevToolsOpen());
}

}  // namespace

PageDiscarding::PageDiscarding(Candidates candidates, Ask ask, Discard discard)
    : candidates_(std::move(candidates)),
      ask_(std::move(ask)),
      discard_(std::move(discard)) {
  if (base::FeatureList::IsEnabled(kDomicilePageDiscarding)) {
    timer_.Start(FROM_HERE, kInterval,
                 base::BindRepeating(&PageDiscarding::Check,
                                     base::Unretained(this)));
  }
}

PageDiscarding::~PageDiscarding() = default;

void PageDiscarding::Check() {
  if (candidates_.Run().empty()) {
    return;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce(&IsShortOfMemory),
      base::BindOnce(&PageDiscarding::OnChecked, weak_factory_.GetWeakPtr()));
}

void PageDiscarding::OnChecked(bool is_short) {
  if (!is_short || !PerformanceManager::IsAvailable()) {
    return;
  }
  const std::vector<std::string> ids = Discardable();
  if (ids.empty()) {
    return;
  }
  LOG(WARNING) << "domicile: short of memory.";
  // A shell that did not answer since the last check decides nothing.
  if (asking_.HasWeakPtrs()) {
    asking_.InvalidateWeakPtrs();
    discard_.Run(ids.front());
    return;
  }
  ask_.Run(ids,
           base::BindOnce(&PageDiscarding::OnAsked, asking_.GetWeakPtr()));
}

void PageDiscarding::OnAsked(bool handled) {
  asking_.InvalidateWeakPtrs();
  if (handled) {
    LOG(INFO) << "domicile: the shell decides which pages to unload.";
    return;
  }
  // Again, as pages may have been shown or used while it was asked.
  const std::vector<std::string> ids = Discardable();
  if (!ids.empty()) {
    discard_.Run(ids.front());
  }
}

std::vector<std::string> PageDiscarding::Discardable() {
  std::vector<std::pair<base::TimeTicks, std::string>> hidden;
  for (const Candidate& candidate : candidates_.Run()) {
    const base::WeakPtr<PageNode> node =
        PerformanceManager::GetPrimaryPageNodeForWebContents(&*candidate.page);
    if (!node || !MayDiscard(*candidate.page, *node)) {
      continue;
    }
    hidden.emplace_back(node->GetVisibilityState().last_change_time,
                        candidate.id);
  }
  std::ranges::sort(hidden);
  std::vector<std::string> ids;
  for (auto& [since, id] : hidden) {
    ids.push_back(std::move(id));
  }
  return ids;
}

}  // namespace domicile
