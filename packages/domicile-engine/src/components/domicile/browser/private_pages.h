// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_PRIVATE_PAGES_H_
#define COMPONENTS_DOMICILE_BROWSER_PRIVATE_PAGES_H_

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"

namespace domicile {

// Counts one profile's open private pages, so its off-the-record profile ends
// with the last one.
class PrivatePages {
 public:
  // `end` runs on a later task once the last open page closes, unless another
  // opens first.
  explicit PrivatePages(base::RepeatingClosure end);
  PrivatePages(const PrivatePages&) = delete;
  PrivatePages& operator=(const PrivatePages&) = delete;
  ~PrivatePages();

  void Opened();
  void Closed();

 private:
  void EndIfNoneOpen();

  int open_ = 0;
  base::RepeatingClosure end_;
  base::WeakPtrFactory<PrivatePages> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_PRIVATE_PAGES_H_
