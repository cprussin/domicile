// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// The evdev input controller as this platform drives it: owned by the UI
// thread, told about device removals by a factory on the evdev thread.
//
// HERE, AND NOT IN `events_unittests`, because this is the one suite CI builds
// and runs (`scripts/engine-drm-unit-tests.sh`), and because the DRM platform
// is what makes a removal routine: logind revokes every input device on a
// console switch, and each one comes back through `RemoveInputDevice` and
// `AddInputDevice` on the evdev thread (see `drm_input_devices.h`).

#include "ui/events/ozone/evdev/input_controller_evdev.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"
#include "base/location.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/synchronization/waitable_event.h"
#include "base/test/task_environment.h"
#include "base/test/test_simple_task_runner.h"
#include "base/threading/thread.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event_modifiers.h"
#include "ui/events/ozone/evdev/input_device_factory_evdev.h"
#include "ui/events/ozone/evdev/input_device_factory_evdev_proxy.h"
#include "ui/events/ozone/evdev/keyboard_evdev.h"
#include "ui/events/ozone/evdev/mouse_button_map_evdev.h"
#include "ui/events/ozone/layout/stub/stub_keyboard_layout_engine.h"

namespace ui {
namespace {

// Runs `task` on `thread` and returns once it has run.
void RunOn(base::Thread& thread, base::OnceClosure task) {
  base::WaitableEvent done;
  thread.task_runner()->PostTask(
      FROM_HERE, std::move(task).Then(base::BindOnce(
                     &base::WaitableEvent::Signal, base::Unretained(&done))));
  done.Wait();
}

class DrmInputControllerTest : public testing::Test {
 protected:
  // The controller's own sequence: the browser's UI thread.
  base::test::SingleThreadTaskEnvironment task_environment_{
      base::test::TaskEnvironment::MainThreadType::UI};

  EventModifiers modifiers_;
  StubKeyboardLayoutEngine layout_;
  KeyboardEvdev keyboard_{&modifiers_, &layout_, base::DoNothing(),
                          base::DoNothing()};
  MouseButtonMapEvdev mouse_button_map_;
  MouseButtonMapEvdev pointing_stick_button_map_;
  InputControllerEvdev controller_{&keyboard_, &mouse_button_map_,
                                   &pointing_stick_button_map_};

  // Where the controller's settings pushes land. Held rather than run, so a
  // case can ask whether a push was made; which thread made it is what the
  // case controls by what it has run.
  scoped_refptr<base::TestSimpleTaskRunner> factory_runner_ =
      base::MakeRefCounted<base::TestSimpleTaskRunner>();
  InputDeviceFactoryEvdevProxy factory_{
      factory_runner_, base::WeakPtr<InputDeviceFactoryEvdev>()};
};

// THE CRASH THIS PINS. `InputDeviceFactoryEvdev::DetachInputDevice` runs on
// the evdev thread and calls `OnInputDeviceRemoved`, whose
// `ScheduleUpdateDeviceSettings` posted a task bound to the controller's
// WeakPtr to the CURRENT thread -- the evdev one. A console switch removes
// every device at once, and the evdev thread's task queue then checked that
// WeakPtr off the UI sequence it is bound to: `DCHECK failed:
// checker.CalledOnValidSequence(&bound_at)` in `WorkQueue::
// RemoveCancelledTasks`, and the browser gone.
//
// So the removal must not touch the controller on the evdev thread at all:
// nothing reaches the factory until the controller's own sequence runs, and
// then the settings push does.
TEST_F(DrmInputControllerTest,
       ARemovalFromTheEvdevThreadIsHandledOnTheControllersSequence) {
  controller_.SetInputDeviceFactory(&factory_);
  factory_runner_->ClearPendingTasks();

  base::Thread evdev("evdev");
  ASSERT_TRUE(evdev.Start());

  RunOn(evdev, base::BindOnce(&InputControllerEvdev::OnInputDeviceRemoved,
                              base::Unretained(&controller_), 7));
  // And anything the removal posted to the evdev thread, run there.
  RunOn(evdev, base::DoNothing());

  EXPECT_FALSE(factory_runner_->HasPendingTask());

  task_environment_.RunUntilIdle();

  EXPECT_TRUE(factory_runner_->HasPendingTask());
}

}  // namespace
}  // namespace ui
