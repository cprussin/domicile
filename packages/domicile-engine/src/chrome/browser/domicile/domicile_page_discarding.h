// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_PAGE_DISCARDING_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_PAGE_DISCARDING_H_

#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ref.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"

namespace content {
class WebContents;
}

namespace domicile {

// Unloads pages while the computer is short of memory, as Chrome's Memory
// Saver policies do for tabs. Those ask for a tab strip, which a desk's pages
// are in none of, so this is PageDiscardingHelper's urgent discard over its
// candidates: the one hidden longest that DiscardEligibilityPolicy would let
// go, again every few seconds until the shortage ends.
class PageDiscarding {
 public:
  // A page it may unload, and its window's id.
  struct Candidate {
    std::string id;
    raw_ref<content::WebContents> page;
  };
  using Candidates = base::RepeatingCallback<std::vector<Candidate>()>;
  using Discard = base::RepeatingCallback<void(const std::string& id)>;

  PageDiscarding(Candidates candidates, Discard discard);
  PageDiscarding(const PageDiscarding&) = delete;
  PageDiscarding& operator=(const PageDiscarding&) = delete;
  ~PageDiscarding();

 private:
  void Check();
  void OnChecked(bool is_short);

  const Candidates candidates_;
  const Discard discard_;
  base::RepeatingTimer timer_;
  base::WeakPtrFactory<PageDiscarding> weak_factory_{this};
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_PAGE_DISCARDING_H_
