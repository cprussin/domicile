// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_master.h"

#include <errno.h>
#include <fcntl.h>

#include <algorithm>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// `DrmMaster` owns the descriptors it is handed and closes them, so a test has
// to hand it real ones. /dev/null is the cheapest that always opens, and two
// opens of it are two distinct numbers -- which is what lets a case say the
// call reached the card it was recorded against and not another.
base::ScopedFD OpenScratchFd() {
  base::ScopedFD fd(open("/dev/null", O_RDONLY | O_CLOEXEC));
  CHECK(fd.is_valid());
  return fd;
}

// Stands in for `drmSetMaster` or `drmDropMaster`: records every descriptor it
// was called on, in order, and refuses the ones it was told to refuse.
class RecordedCall {
 public:
  DrmMasterCall Bind() {
    return base::BindRepeating(&RecordedCall::Run, base::Unretained(this));
  }

  void Refuse(int fd) { refused_.push_back(fd); }

  const std::vector<int>& calls() const { return calls_; }

 private:
  int Run(int fd) {
    calls_.push_back(fd);
    return std::find(refused_.begin(), refused_.end(), fd) == refused_.end()
               ? 0
               : -EACCES;
  }

  std::vector<int> calls_;
  std::vector<int> refused_;
};

// The sysfs paths `DrmDisplayHostManager` keys its devices by, which is what
// a device removal carries and therefore what `Forget` is given.
constexpr char kCard0[] = "/sys/class/drm/card0";
constexpr char kCard1[] = "/sys/class/drm/card1";
constexpr char kCard2[] = "/sys/class/drm/card2";

TEST(DrmMasterTest, DropsMasterOnEveryCardItHolds) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));

  EXPECT_TRUE(master.Drop());
  // The browser's own descriptors, which is the whole point: the GPU's copies
  // of them are the same `struct drm_file` and cannot be dropped from there.
  EXPECT_EQ(drop.calls(), std::vector<int>({first_fd, second_fd}));
  EXPECT_TRUE(set.calls().empty());
}

TEST(DrmMasterTest, TakesMasterBackOnEveryCardItHolds) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));

  EXPECT_TRUE(master.Take());
  EXPECT_EQ(set.calls(), std::vector<int>({first_fd, second_fd}));
  EXPECT_TRUE(drop.calls().empty());
}

TEST(DrmMasterTest, ACardThatRefusesFailsTheDropAndTheRestAreStillAsked) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  base::ScopedFD third = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  const int third_fd = third.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));
  master.Add(base::FilePath(kCard2), std::move(third));
  drop.Refuse(second_fd);

  EXPECT_FALSE(master.Drop());
  // NOT A SHORT CIRCUIT. Stopping at the refusal would leave card2 mastered
  // while card0 is not, which is a worse state than either end of the
  // operation and one nothing else knows how to unwind.
  EXPECT_EQ(drop.calls(), std::vector<int>({first_fd, second_fd, third_fd}));
}

TEST(DrmMasterTest, ACardThatWentAwayIsNotTouched) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));
  master.Forget(base::FilePath(kCard1));

  EXPECT_TRUE(master.Drop());
  EXPECT_EQ(drop.calls(), std::vector<int>({first_fd}));
}

TEST(DrmMasterTest, ADropWithNothingHeldIsARefusal) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  // Not a vacuous success. The browser opens the primary card before the GPU
  // process is handed anything, so the only way to arrive here empty is that
  // the card was never recorded -- and answering yes to that tells the VT
  // switcher a display was released that is still being scanned out on.
  EXPECT_FALSE(master.Drop());
  EXPECT_TRUE(drop.calls().empty());
}

}  // namespace
}  // namespace ui
