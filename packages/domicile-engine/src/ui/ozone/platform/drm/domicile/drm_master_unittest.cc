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
  // The two arrivals, and nothing else: taking master on a card as it arrives
  // is the only reason a set ever runs before a console switch.
  EXPECT_EQ(set.calls(), std::vector<int>({first_fd, second_fd}));
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
  // The two arrivals and then the retake: a card is mastered when it arrives
  // and every card held is asked again on the way back from a console switch.
  EXPECT_EQ(set.calls(),
            std::vector<int>({first_fd, second_fd, first_fd, second_fd}));
  EXPECT_TRUE(drop.calls().empty());
}

TEST(DrmMasterTest, ACardIsMasteredAsItArrives) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD arrived = OpenScratchFd();
  const int arrived_fd = arrived.get();
  master.Add(base::FilePath(kCard0), std::move(arrived));

  // THE SCREEN THAT LIT ONLY AFTER A TRIP TO ANOTHER CONSOLE AND BACK. The
  // browser's `open` of a card takes master only if the card was free, and
  // nothing checked: off ChromeOS there is no `DisplayConfigurator` and so no
  // `TakeDisplayControl` before the first modeset, and the only `drmSetMaster`
  // in the tree sat behind a VT switch. A first atomic commit that the kernel
  // answers `EACCES` is what that looks like from the GPU process.
  EXPECT_EQ(set.calls(), std::vector<int>({arrived_fd}));
  EXPECT_TRUE(drop.calls().empty());
}

TEST(DrmMasterTest, ACardThatArrivesOnSomebodyElsesConsoleIsNotMastered) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD held = OpenScratchFd();
  const int held_fd = held.get();
  master.Add(base::FilePath(kCard0), std::move(held));
  ASSERT_TRUE(master.Drop());

  base::ScopedFD arrived = OpenScratchFd();
  const int arrived_fd = arrived.get();
  master.Add(base::FilePath(kCard1), std::move(arrived));

  // THE TWO-OWNER BUG BY THE THIRD DOOR. A display plugged in while the user
  // is on another console would otherwise be mastered by a desktop nobody can
  // see, on a console this process handed over.
  EXPECT_EQ(set.calls(), std::vector<int>({held_fd}));

  // And it is not forgotten either: the console coming back asks for every
  // card, including the one that arrived while it was away.
  EXPECT_TRUE(master.Take());
  EXPECT_EQ(set.calls(), std::vector<int>({held_fd, held_fd, arrived_fd}));
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
