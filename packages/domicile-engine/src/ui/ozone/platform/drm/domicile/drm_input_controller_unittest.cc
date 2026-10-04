// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Tests the evdev input controller as this platform uses it: owned by the UI
// thread, told about device removals from the evdev thread.
//
// Lives here, not in `events_unittests`, because CI runs only this suite
// (`scripts/engine-drm-unit-tests.sh`). On DRM, every console switch removes
// and re-adds every input device (see `drm_input_devices.h`).

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
  // The controller's sequence: the browser's UI thread.
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

  // Receives the controller's settings pushes. Held, not run, so a test can
  // check whether a push was posted.
  scoped_refptr<base::TestSimpleTaskRunner> factory_runner_ =
      base::MakeRefCounted<base::TestSimpleTaskRunner>();
  InputDeviceFactoryEvdevProxy factory_{
      factory_runner_, base::WeakPtr<InputDeviceFactoryEvdev>()};
};

// `OnInputDeviceRemoved` is called on the evdev thread. A task posted there
// with the controller's WeakPtr, which is bound to the UI sequence, makes the
// evdev queue DCHECK in `WorkQueue::RemoveCancelledTasks`. The settings push
// must wait for the controller's own sequence.
TEST_F(DrmInputControllerTest,
       ARemovalFromTheEvdevThreadIsHandledOnTheControllersSequence) {
  controller_.SetInputDeviceFactory(&factory_);
  factory_runner_->ClearPendingTasks();

  base::Thread evdev("evdev");
  ASSERT_TRUE(evdev.Start());

  RunOn(evdev, base::BindOnce(&InputControllerEvdev::OnInputDeviceRemoved,
                              base::Unretained(&controller_), 7));
  // Run anything the removal posted to the evdev thread.
  RunOn(evdev, base::DoNothing());

  EXPECT_FALSE(factory_runner_->HasPendingTask());

  task_environment_.RunUntilIdle();

  EXPECT_TRUE(factory_runner_->HasPendingTask());
}

}  // namespace
}  // namespace ui
