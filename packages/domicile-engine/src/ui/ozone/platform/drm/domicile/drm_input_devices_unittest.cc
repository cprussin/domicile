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
// again, and for the `OpenDeviceFd` that open runs. It does what the factory
// does -- reach back into the opener while the call that asked for the reopen
// is still on the stack -- so that a case exercises the re-entrancy as well
// as the call.
//
// A path is only taken again once `Knows` has said which device number the
// node carries, because that is what a real open stats out of it; a case that
// says nothing gets the detach half and no take, which is what a device whose
// node has gone looks like.
class RecordedReopen {
 public:
  ReopenDeviceCall Bind() {
    return base::BindRepeating(&RecordedReopen::Run, base::Unretained(this));
  }

  // Set once the devices object exists, the way the real factory hands itself
  // to the opener it already owns.
  void Watch(DrmTakenDevices* devices) { devices_ = devices; }

  // What `NumberOfDevice` would answer for this path.
  void Knows(const std::string& path, DeviceNumber number) {
    numbers_[path] = number;
  }

  // Whether the session is the one in front of the user, which is what
  // decides the liveness `TakeDevice`'s reply reports.
  void SessionIsActive(bool active) { active_ = active; }

  const std::vector<Reopened>& calls() const { return calls_; }

  // The descriptor the reopened device was given, as the factory would have
  // handed it to a new converter.
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

    // WHAT `OpenDeviceFd` DOES WHEN NOTHING IS PARKED: a device the session
    // still holds cannot be taken again, so it is given back first, and the
    // liveness comes out of the reply rather than out of hope.
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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);

  // logind blocks the console switch until every `PauseDevice` of type
  // "pause" has been answered with `PauseDeviceComplete`, and gives up only
  // after its own timeout. "force" and "gone" are it telling us what it has
  // already done, and answering those is not part of the protocol.
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

  // "force" is logind saying what it has ALREADY done: `session_device_stop`
  // has `EVIOCREVOKE`d this descriptor before the signal was sent, and no ack
  // is expected. Treating it as a no-op leaves a converter watching a
  // descriptor whose every read is `ENODEV` -- the keyboard and the trackpad
  // dying in the same instant, with nothing in the log.
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));
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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);

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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

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

TEST(DrmInputDevicesTest, AForcePausedDeviceIsStillOwedBackToLogind) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"), PauseAnswer::kDeviceIsRevoked);
  EXPECT_TRUE(devices.Release());

  // "force" REVOKES THE DESCRIPTOR AND KEEPS THE DEVICE, which is what makes
  // it different from "gone". `session_device_stop` does not touch
  // `s->devices`, so logind still has this session down as the holder and
  // still wants it back on the way out -- and a session that forgot it here
  // would strand the device for whoever logs in next.
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

  // The console goes away. The take each force pause asks for lands while
  // this session is still in the background, so logind hands back a
  // descriptor it has already revoked and both devices stay dead.
  reopen.SessionIsActive(false);
  EXPECT_EQ(devices.Pause(kKeyboard, "force"), PauseAnswer::kDeviceIsRevoked);
  EXPECT_EQ(devices.Pause(kTouchpad, "force"), PauseAnswer::kDeviceIsRevoked);

  // And it comes back with no `ResumeDevice` behind it, which is the case
  // that cost a reboot: `session_device_resume_all` runs only from
  // `seat_set_active`, while `session_leave_vt` force-pauses on the kernel's
  // release signal, so a relinquish with no seat transition behind it leaves
  // every descriptor revoked and no resume ever comes.
  reopen.SessionIsActive(true);
  EXPECT_EQ(devices.Reclaim(), 2u);

  // The mouse was never revoked, so it is not given back and taken again for
  // nothing -- a live converter would be stopped and rebuilt on every
  // activation.
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath},
                                   Reopened{kTouchpadId, kTouchpadPath},
                                   Reopened{kKeyboardId, kKeyboardPath},
                                   Reopened{kTouchpadId, kTouchpadPath}}));

  // ...and all three are live now, so a second activation asks for nothing.
  EXPECT_EQ(devices.Reclaim(), 0u);
}

TEST(DrmInputDevicesTest, ADeviceTakenWhileTheSessionIsNotInFrontIsNotLive) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);

  // THE STARTUP HALF OF THE SAME GAP. `TakeDevice` answers `(h fd, b
  // inactive)`, and `session_device_new` revokes the descriptor before
  // returning it when the session is not the one in front of the user -- so a
  // scan that runs during that moment gets a set of dead descriptors and
  // nothing ever says so. Recorded as revoked, the next activation is what
  // fixes it.
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

  // logind's polite half still happens on a seat that has no VTs, and the
  // descriptor a `ResumeDevice` carries is a live one -- so the activation
  // that follows it must not give the device back and take it again for
  // nothing.
  EXPECT_EQ(devices.Reclaim(), 0u);
}

TEST(DrmInputDevicesTest, GivingADeviceBackIsWhatLetsItBeTakenAgain) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

  // THE ONLY WAY BACK TO A LIVE DESCRIPTOR WHEN NO RESUME IS COMING.
  // `TakeDevice` for a device the session still holds is refused with
  // `Device is taken` (systemd `logind-session-dbus.c`), so a revoked
  // descriptor can be replaced only by giving the device back first.
  EXPECT_TRUE(devices.GiveBack(kKeyboard));
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));

  // ...and it is not held any more, so the release on the way out must not
  // name it a second time.
  EXPECT_TRUE(devices.Release());
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));

  // An ordinary open holds nothing yet, and asking logind to take back a
  // device it never handed over is a message about a device nobody has.
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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);
  devices.Take(kMouse, kMouseId, base::FilePath(kMousePath),
               DeviceLiveness::kLive);
  devices.Take(kTouchpad, kTouchpadId, base::FilePath(kTouchpadPath),
               DeviceLiveness::kLive);
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

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kLive);

  EXPECT_TRUE(devices.Release());
  EXPECT_TRUE(devices.Release());
  // The destructor releases too, and a shutdown that releases explicitly is
  // the ordinary path -- so the second pass has to name nothing rather than
  // hand logind a device this session no longer holds.
  EXPECT_EQ(release.calls(), std::vector<DeviceNumber>({kKeyboard}));
}

TEST(DrmInputDevicesTest, AResumeForADeviceGivenBackAMomentAgoIsStillTaken) {
  RecordedRelease release;
  RecordedReopen reopen;
  DrmTakenDevices devices(release.Bind(), reopen.Bind());
  reopen.Watch(&devices);
  reopen.Knows(kKeyboardPath, kKeyboard);

  devices.Take(kKeyboard, kKeyboardId, base::FilePath(kKeyboardPath),
               DeviceLiveness::kRevoked);

  // THE WINDOW A MEASURED DESKTOP DIED IN. `GiveBack` is on the way into
  // every re-take, so a device is not held for as long as it takes to give it
  // back and ask for it again -- and logind still has it down as this
  // session's for the whole of that window, so a `ResumeDevice` can land in
  // it. Answering that from the held table refuses a live descriptor and
  // leaves the device dead for the rest of the run.
  EXPECT_TRUE(devices.GiveBack(kKeyboard));

  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_EQ(reopen.calls(),
            std::vector<Reopened>({Reopened{kKeyboardId, kKeyboardPath}}));
  // The descriptor logind sent is the one the reopened device got, rather
  // than one taken again from a session that is not in front of the user.
  EXPECT_EQ(ReadOneByte(reopen.descriptor()), 1);
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
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));

  // A resume does not just hand a descriptor over, it says logind is holding
  // this device for this session again -- so the shutdown owes it back. A
  // resume that parked the descriptor without recording the hold would strand
  // the device with a session that has exited.
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

  // THE ONE PAUSE THAT MEANS THE NODE IS NOT COMING BACK, so it is the one
  // that forgets the name as well as the hold. Everything else that empties
  // the held table is a step on the way to taking the device again, and a
  // resume in that window is answered rather than refused.
  EXPECT_FALSE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_TRUE(reopen.calls().empty());
}

// THE ONE THAT COST A DESKTOP ITS KEYBOARD, READ OFF A REAL CONSOLE SWITCH.
// A force pause reopens the device, the reopen gives it back and takes it
// again, and logind answers the `ReleaseDevice` half by telling this session
// the device is "gone" -- because from logind's side it is: the
// `SessionDevice` this session asked it to free really has been freed. That
// signal arrives AFTER the `TakeDevice` that replaced it, so it names a
// device this session is holding on a newer take, and forgetting the name
// there is the desktop losing every input device for the rest of the run.
//
// Measured: thirteen devices force-paused at 21:31:25.68, thirteen "gone"
// pauses in the 141 microseconds after it, `reclaimed 0 of 0` on the way
// back, and thirteen `logind resumed device N, which this session never
// took` -- keyboard and trackpad among them, with no way left to leave the
// console.
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

  // logind's answer to that release, arriving after the take that replaced
  // the device it names.
  EXPECT_EQ(devices.Pause(kKeyboard, "gone"), PauseAnswer::kNothingToSay);

  // The device is still this session's, so the activation's resume lands.
  EXPECT_TRUE(devices.Resume(kKeyboard, OpenZero()));
  EXPECT_EQ(reopen.calls().back(), (Reopened{kKeyboardId, kKeyboardPath}));
}

// AND THE SESSION STILL OWES IT BACK. A "gone" that was only the echo of a
// release changes nothing about the hold, so the device is one `Reclaim` can
// find and one the shutdown has to give back -- which is what tells this
// apart from a node that really went away.
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

// ONE ECHO PER RELEASE AND NOT ONE FOREVER, which is the half that would put
// the original bug back the moment a node really was unplugged. The second
// "gone" is nobody's echo: there was one release and it has been accounted
// for, so this one is the node going away and the name goes with it.
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
