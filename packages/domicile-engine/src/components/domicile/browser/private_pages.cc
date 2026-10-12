// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/private_pages.h"

#include <utility>

#include "base/check_op.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/task/sequenced_task_runner.h"

namespace domicile {

PrivatePages::PrivatePages(base::RepeatingClosure end) : end_(std::move(end)) {}

PrivatePages::~PrivatePages() = default;

void PrivatePages::Opened() {
  ++open_;
}

void PrivatePages::Closed() {
  CHECK_GT(open_, 0);
  --open_;
  if (open_ == 0) {
    // Posted: the last page closes from inside its WebContents' destruction.
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&PrivatePages::EndIfNoneOpen,
                                  weak_factory_.GetWeakPtr()));
  }
}

void PrivatePages::EndIfNoneOpen() {
  if (open_ == 0) {
    end_.Run();
  }
}

}  // namespace domicile
