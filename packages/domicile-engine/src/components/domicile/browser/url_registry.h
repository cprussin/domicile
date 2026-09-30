// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_URL_REGISTRY_H_
#define COMPONENTS_DOMICILE_BROWSER_URL_REGISTRY_H_

#include <stdint.h>

#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"

namespace domicile {

// The shell pages an address from `domicile open-url` can be handed to.
//
// ONE PAGE IS TOLD, NOT EVERY ONE. Every page of a desk is the same shell, so
// an address told to each would open a browser window per monitor. The first
// page registered is the one told; which window it goes in, on which screen,
// is the shell's to decide -- `shell-manganese` hands it to the page that
// leads the desk.
//
// TWO SEQUENCES, WHICH IS WHY THERE IS A LOCK, for ShortcutRegistry's reason:
// a page registers from its ControlChannel on the IO thread, and an address
// arrives from the command socket on the UI thread. So a page's callback is
// expected to be `base::BindPostTask`-wrapped by whoever registers it, and is
// run outside the lock.
class UrlRegistry {
 public:
  using OpenCallback = base::RepeatingCallback<void(const std::string& url)>;

  // A registration's handle, for giving it back. Never zero.
  using PageId = uint64_t;

  // The process's registry. Tests build their own on the stack instead.
  static UrlRegistry& Get();

  UrlRegistry();
  UrlRegistry(const UrlRegistry&) = delete;
  UrlRegistry& operator=(const UrlRegistry&) = delete;
  ~UrlRegistry();

  // A page that can be handed an address. `on_open` may be run on any
  // sequence, so it is expected to be posted back to the caller's own.
  PageId AddPage(OpenCallback on_open);

  // Stop. `page` is the id AddPage returned.
  void RemovePage(PageId page);

  // Hand `url` to one page. Answers whether there was one.
  bool Open(const std::string& url);

 private:
  struct Page {
    PageId id;
    OpenCallback on_open;
  };

  base::Lock lock_;
  std::vector<Page> pages_ GUARDED_BY(lock_);
  PageId next_id_ GUARDED_BY(lock_) = 1;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_URL_REGISTRY_H_
