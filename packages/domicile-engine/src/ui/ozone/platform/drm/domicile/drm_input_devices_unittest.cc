// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <unistd.h>

#include <algorithm>
#include <map>
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

// A fake `stat` returning `mode` and `rdev`, since tests cannot `mknod`
// without root.
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

// A real descriptor standing in for a `ResumeDevice` one. `/dev/zero`, not
// `/dev/null`, so a successful read proves it is still open.
base::ScopedFD OpenZero() {
  base::ScopedFD fd(open("/dev/zero", O_RDONLY | O_CLOEXEC));
  CHECK(fd.is_valid());
  return fd;
}

// Reads one byte: returns 1 from `/dev/zero`, -1 from a closed descriptor.
ssize_t ReadOneByte(int descriptor) {
  char byte = 0;
  return read(descriptor, &byte, 1);
}

// One (id, path) the factory was asked to reopen.
struct Reopened {
  int id = 0;
  std::string path;

  friend bool operator==(const Reopened&, const Reopened&) = default;
};

// Fake `Session.ReleaseDevice`: records calls in order and fails for devices
// passed to `Refuse`.
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

// Fake factory reopen plus the `OpenDeviceFd` it runs. Like the real one, it
// re-enters `DrmTakenDevices` synchronously, so tests cover re-entrancy.
//
// A path is re-taken only after `Knows` gives its device number; otherwise
// the reopen only detaches, as for a removed node.
class RecordedReopen {
 public:
  ReopenDeviceCall Bind() {
    return base::BindRepeating(&RecordedReopen::Run, base::Unretained(this));
  }

  // Set after construction, as the real factory registers with its opener.
  void Watch(DrmTakenDevices* devices) { devices_ = devices; }

  // Sets what `NumberOfDevice` returns for `path`.
  void Knows(const std::string& path, DeviceNumber number) {
    numbers_[path] = number;
  }

  // Whether the session is active, which sets the liveness of new takes.
  void SessionIsActive(bool active) { active_ = active; }

  const std::vector<Reopened>& calls() const { return calls_; }

  // The descriptor the last reopen consumed.
  int descriptor() const { return consumed_.get(); }

 private:
  void Run(int id, const base::FilePath& path) {
    calls_.push_back(Reopened{id, path.value()});

    consumed_ = devices_->Resumed(path);
    if (consumed_.is_valid()) {
      return;
    }

    const auto number = numbers_.find(path.value());
    if (number == numbers_.end()) {
      return;
    }

    // As `OpenDeviceFd` does with nothing parked: release first, since a held
    // device cannot be re-taken, then take with the reply's liveness.
    devices_->GiveBack(number->second);
    devices_->Take(number->second, id, path,
                   active_ ? DeviceLiveness::kLive : DeviceLiveness::kRevoked);
  }

  raw_ptr<DrmTakenDevices> devices_ = nullptr;
  std::map<std::string, DeviceNumber> numbers_;
  bool active_ = true;
  std::vector<Reopened> calls_;
  base::ScopedFD consumed_;
};

TEST(DrmInputDevicesTest, TheNumberIsTheOneStatReportsForTheNode) {
  // `makedev(13, 64)` is `/dev/input/event0`: input major 13, evdev minors
  // from 64.
  const std::optional<DeviceNumber> number =
      NumberOfDevice(base::FilePath(kKeyboardPath),
                     StatAnswering(S_IFCHR | 0600, makedev(13, 64)));

  ASSERT_TRUE(number.has_value());
  EXPECT_EQ(*number, kKeyboard);
}

TEST(DrmInputDevicesTest, APathThatIsNotACharacterDeviceHasNoNumber) {
  // Other file types' numbers would name a different device to logind.
  EXPECT_FALSE(NumberOfDevice(base::FilePath("/dev/input"),
                              StatAnswering(S_IFDIR | 0755, 0))
                   .has_value());
  EXPECT_FALSE(NumberOfDevice(base::FilePath(kKeyboardPath),
                              StatAnswering(S_IFBLK | 0600, makedev(13, 64)))
                   .has_value());
}

TEST(DrmInputDevicesTest, APathThatCannotBeStattedHasNoNumber) {
  // For example, a node removed between udev's announcement and the open.
  EXPECT_FALSE(
      NumberOfDevice(base::FilePath(kKeyboardPath), StatRefusing()).has_value());
}

TEST(DrmInputDevicesTest, AResumedDeviceIsOpenedAgainWithTheDescriptorLogindSent) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "pause"), PauseAnswer::kCompleteIt);

  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));

  // Reopened through the factory, the only way to restart a stopped
  // converter.
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));

  // Same id, so downstream sees the same device. The reopen gets logind's
  // descriptor, since `TakeDevice` refuses a held device.
  EXPECT_EQ(ReadOneByte(reopen.descriptor()), 1);
}

TEST(DrmInputDevicesTest, OnlyAPauseWaitsToBeCompleted) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);

  // logind waits for `PauseDeviceComplete` only after "pause". "force" and
  // "gone" report what it already did.
  EXPECT_EQ(devices.Pause(kKeyboard, "pause"), PauseAnswer::kCompleteIt);
  EXPECT_EQ(devices.Pause(kMouse, "gone"), PauseAnswer::kNothingToSay);
}

TEST(DrmInputDevicesTest, AForcePauseTakesTheDeviceBackThroughTheFactory) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"), PauseAnswer::kDeviceIsRevoked);

  // The descriptor is already revoked, so the dead converter must be
  // replaced.
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));
}

TEST(DrmInputDevicesTest, APauseForADeviceNeverTakenIsStillCompleted) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  // Answered anyway, or the console switch waits for logind's timeout.
  EXPECT_EQ(devices.Pause(kKeyboard, "pause"), PauseAnswer::kCompleteIt);
}

TEST(DrmInputDevicesTest, ADeviceThatIsGoneIsNotReleasedAfterwards) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);

  EXPECT_EQ(devices.Pause(kMouse, "gone"), PauseAnswer::kNothingToSay);
  EXPECT_TRUE(devices.Release());

  // An unplugged device is no longer logind's to release.
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

TEST(DrmInputDevicesTest, AResumeForADeviceNeverTakenReopensNothing) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  // No id or path to reopen under, and the descriptor is not ours.
  EXPECT_FALSE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_TRUE(reopen.calls().empty());
}

TEST(DrmInputDevicesTest, AResumeForADeviceStillLiveIsTakenAnyway) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

  // logind resumes every device on activation, paused or not, and its
  // descriptor wins.
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));
}

TEST(DrmInputDevicesTest, OnlyAReopenAfterAResumeHasADescriptorWaiting) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

  // A first open or hotplug finds nothing parked and uses `TakeDevice`.
  EXPECT_FALSE(devices.Resumed(base::FilePath(kKeyboardPath)).is_valid());

  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  // Handed over once, so a later hotplug of the path goes to logind.
  EXPECT_FALSE(devices.Resumed(base::FilePath(kKeyboardPath)).is_valid());
}

TEST(DrmInputDevicesTest, AForcePausedDeviceIsStillOwedBackToLogind) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"), PauseAnswer::kDeviceIsRevoked);
  EXPECT_TRUE(devices.Release());

  // Unlike "gone", "force" leaves this session holding the device, so it
  // must still be released.
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

TEST(DrmInputDevicesTest, ASessionComingBackTakesEveryRevokedDeviceAgain) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);
  reopen.Knows(kMousePath, kMouse);
  reopen.Knows(kTouchpadPath, kTouchpad);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);
  devices.Take(kTouchpad, kTouchpadId, base::FilePath(kTouchpadPath),
               DeviceLiveness::kLive);

  // Console switched away: the force pauses' re-takes happen while inactive,
  // so both come back revoked.
  reopen.SessionIsActive(false);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"), PauseAnswer::kDeviceIsRevoked);
  EXPECT_EQ(devices.Pause(kTouchpad, "force"), PauseAnswer::kDeviceIsRevoked);

  // Session active again with no `ResumeDevice`, which logind may never send.
  reopen.SessionIsActive(true);
  EXPECT_EQ(devices.Reclaim(), 2u);

  // The live mouse is left alone.
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath},
                                   Reopened{kTouchpadId, kTouchpadPath},
                                   Reopened{kKeyboardId, kKeyboardPath},
                                   Reopened{kTouchpadId, kTouchpadPath}}));

  // All three are live now.
  EXPECT_EQ(devices.Reclaim(), 0u);
}

TEST(DrmInputDevicesTest, ADeviceTakenWhileTheSessionIsNotInFrontIsNotLive) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);

  // `TakeDevice` returns a revoked descriptor to an inactive session. The
  // next activation reclaims it.
  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kRevoked);

  EXPECT_EQ(devices.Reclaim(), 1u);
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));
  EXPECT_EQ(devices.Reclaim(), 0u);
}

TEST(DrmInputDevicesTest, AResumeMakesARevokedDeviceLiveAgain) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"), PauseAnswer::kDeviceIsRevoked);
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));

  // A resumed descriptor is live, so activation leaves it alone.
  EXPECT_EQ(devices.Reclaim(), 0u);
}

TEST(DrmInputDevicesTest, GivingADeviceBackIsWhatLetsItBeTakenAgain) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

  // `TakeDevice` refuses a held device ("Device is taken"), so a revoked one
  // must be released first.
  EXPECT_TRUE(devices.GiveBack(kKeyboard));
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));

  // No longer held, so shutdown doesn't release it again.
  EXPECT_TRUE(devices.Release());
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));

  // Nothing to release for a device never taken.
  EXPECT_FALSE(devices.GiveBack(kMouse));
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

TEST(DrmInputDevicesTest, ReleasesEveryDeviceItTookInOrder) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kTouchpad, kTouchpadId, base::FilePath(kTouchpadPath),
               DeviceLiveness::kLive);
  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);

  EXPECT_TRUE(devices.Release());
  // Ordered by device number, so failures report consistently.
  EXPECT_EQ(release.calls(),
            std::vector<DeviceNumber>({kKeyboard, kMouse, kTouchpad}));
}

TEST(DrmInputDevicesTest, ADeviceThatRefusesTheReleaseDoesNotStrandTheRest) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);
  devices.Take(kTouchpad, kTouchpadId, base::FilePath(kTouchpadPath),
               DeviceLiveness::kLive);
  release.Refuse(kMouse);

  EXPECT_FALSE(devices.Release());
  // Continues past a failure, so the touchpad isn't stranded.
  EXPECT_EQ(release.calls(),
            std::vector<DeviceNumber>({kKeyboard, kMouse, kTouchpad}));
}

TEST(DrmInputDevicesTest, ReleasingTwiceReleasesOnce) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

  EXPECT_TRUE(devices.Release());
  EXPECT_TRUE(devices.Release());
  // The destructor releases too, so a second pass must release nothing.
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

// On activation, `Reclaim` can re-take devices before logind's resumes are
// read. Those resumes carry descriptors the release revoked, so reopening on
// them would replace a live converter with a dead one.
TEST(DrmInputDevicesTest, AResumeSentBeforeTheDeviceWasGivenBackIsDropped) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kRevoked);
  ASSERT_EQ(devices.Reclaim(), 1u);
  ASSERT_EQ(reopen.calls().size(), 1u);

  // The release's "gone" hasn't arrived, so this resume predates it.
  EXPECT_FALSE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_EQ(reopen.calls().size(), 1u)
      << "reopening would close the converter Reclaim just built";
  EXPECT_FALSE(devices.Resumed(base::FilePath(kKeyboardPath)).is_valid());
  EXPECT_EQ(devices.Reclaim(), 0u) << "the device is still live";
}

TEST(DrmInputDevicesTest, ADeviceResumedAfterBeingGivenBackIsOwedBackAgain) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kRevoked);
  EXPECT_TRUE(devices.GiveBack(kKeyboard));
  // The release's echo, so the next resume is current.
  EXPECT_EQ(devices.Pause(kKeyboard, "gone"), PauseAnswer::kNothingToSay);
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));

  // A resume means logind holds the device for us again, so shutdown must
  // release it.
  EXPECT_TRUE(devices.Release());
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard, kKeyboard}));
}

TEST(DrmInputDevicesTest, AResumeForAGoneDeviceIsStillRefused) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "gone"), PauseAnswer::kNothingToSay);

  // A real unplug forgets the name too, so a later resume is refused.
  EXPECT_FALSE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_TRUE(reopen.calls().empty());
}

// A force pause's reopen releases and re-takes the device, and logind answers
// the release with "gone" after the re-take. Treating that as an unplug would
// lose all input after a console switch.
TEST(DrmInputDevicesTest, AGoneThatEchoesOurOwnReleaseIsNotTheNodeGoingAway) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);
  reopen.SessionIsActive(false);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"),
            PauseAnswer::kDeviceIsRevoked);
  ASSERT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));

  // The release's echo, arriving after the re-take.
  EXPECT_EQ(devices.Pause(kKeyboard, "gone"), PauseAnswer::kNothingToSay);

  // The device is still ours, so the activation's resume is accepted.
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_EQ(reopen.calls().back(), (Reopened{kKeyboardId, kKeyboardPath}));
}

// An echoed "gone" leaves the device held, so `Reclaim` still finds it.
TEST(DrmInputDevicesTest, ADeviceWhoseGoneWasAnEchoIsStillHeld) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);
  reopen.SessionIsActive(false);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Pause(kKeyboard, "force");
  devices.Pause(kKeyboard, "gone");

  EXPECT_EQ(devices.Reclaim(), 1u)
      << "the force pause left it revoked, so the activation must ask again";
}

// Each release expects one echo. A further "gone" is a real unplug.
TEST(DrmInputDevicesTest, OnlyOneGoneIsAnsweredForEachReleaseAsked) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);
  reopen.SessionIsActive(false);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Pause(kKeyboard, "force");

  EXPECT_EQ(devices.Pause(kKeyboard, "gone"), PauseAnswer::kNothingToSay);
  EXPECT_EQ(devices.Pause(kKeyboard, "gone"), PauseAnswer::kNothingToSay);

  EXPECT_FALSE(devices.Resume(kKeyboard, OpenZero()))
      << "the second gone is the node unplugged, so the name is forgotten";
}

}  // namespace
}  // namespace ui
