// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <unistd.h>

#include <algorithm>
#include <optional>
#include <string>
#include <vector>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// A `stat` that answers whatever the case wants. Injected rather than made:
// a unit test cannot `mknod` a character device, and a test that ran only as
// root would not run.
StatCall StatAnswering(mode_t mode, dev_t rdev) {
  return base::BindRepeating(
      [](mode_t node_mode, dev_t node_rdev, const base::FilePath&,
         struct stat* out) {
        *out = {};
        out->st_mode = node_mode;
        out->st_rdev = node_rdev;
        return 0;
      },
      mode, rdev);
}

StatCall StatRefusing() {
  return base::BindRepeating(
      [](const base::FilePath&, struct stat*) { return -1; });
}

// A real descriptor to stand in for the one a `ResumeDevice` carries.
// `/dev/zero` rather than `/dev/null` because a byte read off it says the
// descriptor that came out the far end is this one and not some other.
base::ScopedFD OpenZero() {
  base::ScopedFD fd(open("/dev/zero", O_RDONLY | O_CLOEXEC));
  CHECK(fd.is_valid());
  return fd;
}

// Reads one byte, and answers how many came back: 1 from `/dev/zero`, -1 from
// a descriptor that is not open.
ssize_t ReadOneByte(int descriptor) {
  char byte = 0;
  return read(descriptor, &byte, 1);
}

// One (id, path) the factory was asked to close and open again.
struct Reopened {
  int id = 0;
  std::string path;

  friend bool operator==(const Reopened&, const Reopened&) = default;
};

// Stands in for `Session.ReleaseDevice`: records every device it was asked
// about, in order, and refuses the ones it was told to refuse.
class RecordedRelease {
 public:
  ReleaseDeviceCall Bind() {
    return base::BindRepeating(&RecordedRelease::Run, base::Unretained(this));
  }

  void Refuse(DeviceNumber number) { refused_.push_back(number); }

  const std::vector<DeviceNumber>& calls() const { return calls_; }

 private:
  bool Run(DeviceNumber number) {
    calls_.push_back(number);
    return std::find(refused_.begin(), refused_.end(), number) ==
           refused_.end();
  }

  std::vector<DeviceNumber> calls_;
  std::vector<DeviceNumber> refused_;
};

constexpr DeviceNumber kKeyboard{13, 64};
constexpr DeviceNumber kMouse{13, 65};
constexpr DeviceNumber kTouchpad{13, 66};

constexpr int kKeyboardId = 7;
constexpr int kMouseId = 8;
constexpr int kTouchpadId = 9;

constexpr char kKeyboardPath[] = "/dev/input/event0";
constexpr char kMousePath[] = "/dev/input/event1";
constexpr char kTouchpadPath[] = "/dev/input/event2";

// Stands in for `InputDeviceFactoryEvdev` closing a device and opening it
// again. It does what the factory does -- reach back into the opener for the
// descriptor -- so that a case exercises the re-entrancy as well as the call:
// the reopen runs while `Resume` is still on the stack.
class RecordedReopen {
 public:
  ReopenDeviceCall Bind() {
    return base::BindRepeating(&RecordedReopen::Run, base::Unretained(this));
  }

  // Set once the devices object exists, the way the real factory hands itself
  // to the opener it already owns.
  void Watch(DrmTakenDevices* devices) { devices_ = devices; }

  const std::vector<Reopened>& calls() const { return calls_; }

  // The descriptor the reopened device was given, as the factory would have
  // handed it to a new converter.
  int descriptor() const { return consumed_.get(); }

 private:
  void Run(int id, const base::FilePath& path) {
    calls_.push_back(Reopened{id, path.value()});
    consumed_ = devices_->Resumed(path);
  }

  raw_ptr<DrmTakenDevices> devices_ = nullptr;
  std::vector<Reopened> calls_;
  base::ScopedFD consumed_;
};

TEST(DrmInputDevicesTest, TheNumberIsTheOneStatReportsForTheNode) {
  // `makedev(13, 64)` is `/dev/input/event0` on every Linux: 13 is the input
  // major and evdev nodes start at minor 64. logind is addressed by these two
  // numbers and not by the path, so getting them out of the node is the whole
  // of the lookup.
  const std::optional<DeviceNumber> number =
      NumberOfDevice(base::FilePath(kKeyboardPath),
                     StatAnswering(S_IFCHR | 0600, makedev(13, 64)));

  ASSERT_TRUE(number.has_value());
  EXPECT_EQ(*number, kKeyboard);
}

TEST(DrmInputDevicesTest, APathThatIsNotACharacterDeviceHasNoNumber) {
  // NOT A PEDANTRY. `TakeDevice` is addressed by (major, minor) with no
  // notion of which node they came from, and block devices carry the same
  // numbers in a different space -- so handing logind the numbers of a
  // regular file or a directory asks it for a device that is not the one on
  // the path, if it is anything at all.
  EXPECT_FALSE(NumberOfDevice(base::FilePath("/dev/input"),
                              StatAnswering(S_IFDIR | 0755, 0))
                   .has_value());
  EXPECT_FALSE(NumberOfDevice(base::FilePath(kKeyboardPath),
                              StatAnswering(S_IFBLK | 0600, makedev(13, 64)))
                   .has_value());
}

TEST(DrmInputDevicesTest, APathThatCannotBeStattedHasNoNumber) {
  // A node udev announced and the kernel removed between the announcement and
  // the open. Ordinary, and the answer is that there is no device here rather
  // than a number made up from an uninitialised `struct stat`.
  EXPECT_FALSE(
      NumberOfDevice(base::FilePath(kKeyboardPath), StatRefusing()).has_value());
}

TEST(DrmInputDevicesTest, AResumedDeviceIsOpenedAgainWithTheDescriptorLogindSent) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));
  EXPECT_EQ(devices.Pause(kKeyboard, "pause"), PauseAnswer::kCompleteIt);

  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));

  // CLOSED AND OPENED AGAIN, NOT PATCHED UP IN PLACE. logind `EVIOCREVOKE`s
  // the descriptor it paused, so the converter's next read is `ENODEV` and it
  // answers that by stopping its watch -- and no `dup2` can re-arm that, since
  // the kernel drops an epoll registration when the description behind the
  // number is closed. `InputDeviceFactoryEvdev::AttachInputDevice` is the only
  // caller of `Start()`, so going back through the factory is the way back.
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));

  // ...on the SAME id, because it is the same device coming back, and minting
  // a new one would present it to everything downstream as a different one.
  //
  // AND THE REOPEN GETS LOGIND'S DESCRIPTOR, which is not a nicety:
  // `TakeDevice` for a device the session already holds is refused, so the one
  // the signal carried is the only one there will be. A byte read off it says
  // so -- `/dev/zero` answers one, and a closed descriptor answers -1.
  EXPECT_EQ(ReadOneByte(reopen.descriptor()), 1);
}

TEST(DrmInputDevicesTest, OnlyAPauseWaitsToBeCompleted) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath));

  // logind blocks the console switch until every `PauseDevice` of type
  // "pause" has been answered with `PauseDeviceComplete`, and gives up only
  // after its own timeout. "force" and "gone" are it telling us what it has
  // already done, and answering those is not part of the protocol.
  EXPECT_EQ(devices.Pause(kKeyboard, "pause"), PauseAnswer::kCompleteIt);
  EXPECT_EQ(devices.Pause(kMouse, "force"), PauseAnswer::kNothingToSay);
}

TEST(DrmInputDevicesTest, APauseForADeviceNeverTakenIsStillCompleted) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  // logind only pauses what it handed over, so arriving here is an invariant
  // violation and says so in the log. It is still answered: staying silent
  // would leave the console wedged for logind's timeout, which is a worse
  // outcome than a wrong answer about a device nobody holds.
  EXPECT_EQ(devices.Pause(kKeyboard, "pause"), PauseAnswer::kCompleteIt);
}

TEST(DrmInputDevicesTest, ADeviceThatIsGoneIsNotReleasedAfterwards) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath));

  EXPECT_EQ(devices.Pause(kMouse, "gone"), PauseAnswer::kNothingToSay);
  EXPECT_TRUE(devices.Release());

  // "gone" is the device unplugged. Releasing it would name a device logind
  // no longer has, and udev's own removal is what takes the converter down.
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

TEST(DrmInputDevicesTest, AResumeForADeviceNeverTakenReopensNothing) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  // There is no path or id to reopen under, and asking the factory to open a
  // device this session was never given is how a desktop ends up with a
  // converter on a descriptor nobody owns.
  EXPECT_FALSE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_TRUE(reopen.calls().empty());
}

TEST(DrmInputDevicesTest, AResumeForADeviceStillLiveIsTakenAnyway) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));

  // NOT AN ERROR. logind resumes every device on session activation whether
  // or not it paused that one first, and the descriptor it sends is the
  // authoritative one -- so refusing it here would leave the converter on a
  // descriptor logind has stopped backing, and logging it would be a false
  // alarm on every console switch back.
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));
}

TEST(DrmInputDevicesTest, OnlyAReopenAfterAResumeHasADescriptorWaiting) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));

  // AN ORDINARY OPEN HAS NOTHING WAITING, and that is what sends it to
  // `TakeDevice`. A first plug-in and a hotplug both arrive this way.
  EXPECT_FALSE(devices.Resumed(base::FilePath(kKeyboardPath)).is_valid());

  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  // ONCE, AND ONCE ONLY. `TakeDevice` for a device the session already holds
  // is refused, so the resume's descriptor is the only one there will be --
  // and a second open of the same path, months later on a real hotplug, must
  // go to logind rather than be handed a descriptor from a console switch.
  EXPECT_FALSE(devices.Resumed(base::FilePath(kKeyboardPath)).is_valid());
}

TEST(DrmInputDevicesTest, ReleasesEveryDeviceItTookInOrder) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kTouchpad, kTouchpadId, base::FilePath(kTouchpadPath));
  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath));

  EXPECT_TRUE(devices.Release());
  // Ordered by device number rather than by the order they were taken, so a
  // failure is reported against the same device every time.
  EXPECT_EQ(release.calls(),
            std::vector<DeviceNumber>({kKeyboard, kMouse, kTouchpad}));
}

TEST(DrmInputDevicesTest, ADeviceThatRefusesTheReleaseDoesNotStrandTheRest) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath));
  devices.Take(kTouchpad, kTouchpadId, base::FilePath(kTouchpadPath));
  release.Refuse(kMouse);

  EXPECT_FALSE(devices.Release());
  // NOT A SHORT CIRCUIT. Stopping at the refusal would leave the touchpad
  // held by a session that is on its way out, and logind hands a device back
  // to the next session only once every holder has let go of it.
  EXPECT_EQ(release.calls(),
            std::vector<DeviceNumber>({kKeyboard, kMouse, kTouchpad}));
}

TEST(DrmInputDevicesTest, ReleasingTwiceReleasesOnce) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath));

  EXPECT_TRUE(devices.Release());
  EXPECT_TRUE(devices.Release());
  // The destructor releases too, and a shutdown that releases explicitly is
  // the ordinary path -- so the second pass has to name nothing rather than
  // hand logind a device this session no longer holds.
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

}  // namespace
}  // namespace ui
