// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MASTER_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MASTER_H_

#include <map>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/callback.h"

namespace ui {

// `drmSetMaster` or `drmDropMaster` on one card: 0 when the kernel agreed, a
// negative errno when it did not. Injected because neither can be exercised in
// a unit test -- both need a real card that this process, and no other, opened.
using DrmMasterCall = base::RepeatingCallback<int(int fd)>;

// The browser's own descriptor on every card it opened for the GPU process,
// and the two calls that are legal on nothing else.
//
// ONLY THE PROCESS THAT OPENED THE CARD MAY DROP MASTER. That is a kernel
// invariant and not a sandbox, a capability or a machine: the browser opens
// the card in `DrmDisplayHostManager::OpenDrmDevice`, on a bare tty that open
// takes master, and `drm_set_master` then records `was_master = true`
// (`drivers/gpu/drm/drm_auth.c`). From that moment `drm_file_update_pid`
// refuses to refresh the pid recorded on the file
// (`drivers/gpu/drm/drm_file.c`), deliberately, so that
// `drm_master_check_perm` keeps working -- so the pid is frozen as the
// browser's, permanently. `SCM_RIGHTS` then hands the GPU process that same
// `struct drm_file` rather than a new one, frozen pid and all, which is why
// `drmDropMaster` there is -EACCES forever, and `drmSetMaster` with it: it
// runs the same permission check BEFORE its already-master early-out, so
// leaving it in place and hoping it no-ops does not work either.
//
// A `dup` shares that one `struct drm_file` too. So a drop through a
// descriptor kept here takes effect for the GPU process's copy as well, and
// the caller's tgid is the one the kernel recorded, so the check passes.
class DrmMaster {
 public:
  // The real `drmSetMaster` and `drmDropMaster`.
  DrmMaster();
  // Their stand-ins, for a test.
  DrmMaster(DrmMasterCall set_master, DrmMasterCall drop_master);

  DrmMaster(const DrmMaster&) = delete;
  DrmMaster& operator=(const DrmMaster&) = delete;

  ~DrmMaster();

  // Gains a card AND TAKES MASTER ON IT. `fd` must be a `dup` of the
  // descriptor handed to the GPU process, taken before the move that hands it
  // over; a fresh `open` would be a different `struct drm_file` and would not
  // be master at all.
  //
  // THE TAKE IS HERE BECAUSE THERE IS NOWHERE ELSE IT COULD BE, and its
  // absence is why a desktop drew nothing until the user had been to another
  // console and back. The browser's `open` takes master only if the card was
  // free (`drm_master_open` -> `drm_new_set_master`), and nothing ever checked:
  // `DrmWrapper::has_master_` is initialized `true` and
  // `DrmDisplayHostManager::display_externally_controlled_` `false`, so both
  // processes assert ownership that neither asked the kernel for. On ChromeOS
  // ash closes that gap -- `DisplayConfigurator::TakeControl` runs at startup
  // -- and this fork has no `DisplayConfigurator`, so the only `drmSetMaster`
  // in the tree sat behind `DrmVtSwitcher`'s take arm. A GPU process that is
  // not master gets `EACCES` from the first atomic commit, which is a screen
  // that stays dark while every log line says the displays are connected.
  //
  // A card arrives when the browser hands it to the GPU process, which is
  // before anything can commit on it, and the ask is idempotent -- the kernel
  // answers 0 for a file that is already the current master -- so a machine
  // where the `open` did take master pays one ioctl and no behavior.
  //
  // A CARD THAT ARRIVES ON SOMEBODY ELSE'S CONSOLE IS RECORDED AND NOT TAKEN.
  // A display plugged in while this session is in the background would
  // otherwise be mastered by a desktop nobody can see; the take on the way
  // back asks for every card held, including that one.
  void Add(const base::FilePath& device, base::ScopedFD fd);

  // Loses one, closing the descriptor with it. `device` is keyed the way
  // `DrmDisplayHostManager` keys its own device map, which is the sysfs path,
  // because that is what a removal carries.
  void Forget(const base::FilePath& device);

  // Takes master on every card held; answers whether every one of them agreed.
  bool Take();

  // Drops master on every card held; answers whether every one of them agreed.
  bool Drop();

 private:
  // EVERY CARD IS ASKED EVEN AFTER ONE REFUSES. Stopping at the first failure
  // would leave a second card in the opposite state from the first, which is
  // worse than either end of the operation and is a state nothing else knows
  // how to unwind. The caller's remedy is the answer, not a rollback: the VT
  // switcher refuses a switch it could not release for.
  //
  // Holding no card at all is a refusal rather than a vacuous yes, for the
  // same reason -- see `drm_master_unittest.cc`.
  bool ApplyToEveryCard(const DrmMasterCall& call, const char* verb);

  DrmMasterCall set_master_;
  DrmMasterCall drop_master_;

  // Whether the display belongs to this console, which is what decides
  // whether a card gained now is one to take master on. It follows the
  // INTENTION rather than the kernel: a drop that the kernel refused has still
  // handed the console over -- logind does not ask -- and a take that failed is
  // a display this console is owed and has to keep asking for.
  bool display_is_ours_ = true;

  // Ordered, so that a failure is reported against the same card every time.
  std::map<base::FilePath, base::ScopedFD> cards_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MASTER_H_
