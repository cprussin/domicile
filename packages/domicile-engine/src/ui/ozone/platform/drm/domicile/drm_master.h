// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MASTER_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MASTER_H_

#include <map>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/callback.h"

namespace ui {

// `drmSetMaster` or `drmDropMaster` on one card. Returns 0 on success or a
// negative errno. Injected so tests can run without a real card.
using DrmMasterCall = base::RepeatingCallback<int(int fd)>;

// Holds the browser's own descriptor on each card it opened for the GPU
// process, and sets or drops DRM master through them.
//
// Only the process that opened a card may drop master on it. The GPU process
// receives the browser's `struct drm_file`, whose recorded pid stays the
// browser's, so its own `drmDropMaster` and `drmSetMaster` fail with -EACCES.
// A `dup` kept here shares that `struct drm_file`, so a call through it
// applies to the GPU process's copy too. See
// docs/TTY-SESSION.md#only-the-opening-process-may-drop-it.
class DrmMaster {
 public:
  // Uses the real `drmSetMaster` and `drmDropMaster`.
  DrmMaster();
  // Uses the given calls, for tests.
  DrmMaster(DrmMasterCall set_master, DrmMasterCall drop_master);

  DrmMaster(const DrmMaster&) = delete;
  DrmMaster& operator=(const DrmMaster&) = delete;

  ~DrmMaster();

  // Adds a card and takes master on it. `fd` must be a `dup` of the
  // descriptor handed to the GPU process, made before that descriptor is
  // moved. A fresh `open` would be a different `struct drm_file`.
  //
  // The browser's `open` takes master only if the card had none, and nothing
  // else in this fork calls `drmSetMaster` at startup. Without this take the
  // GPU process gets EACCES on its first commit and the screen stays dark.
  // The call is idempotent, so a card that is already master costs one ioctl.
  //
  // A card added while another console is active is recorded but not taken.
  // `Take` on the way back takes it.
  void Add(const base::FilePath& device, base::ScopedFD fd);

  // Removes a card and closes its descriptor. `device` is the sysfs path,
  // which is how `DrmDisplayHostManager` keys its devices and what a removal
  // carries.
  void Forget(const base::FilePath& device);

  // Removes every card, after the GPU process dies. The descriptors here
  // still hold master. The new GPU process gets a fresh `open`, which takes
  // master only if no other descriptor holds it, and `drmSetMaster` cannot
  // override that without CAP_SYS_ADMIN. Call this before reopening a card.
  void ForgetEvery();

  // Takes master on every card. Returns whether every card succeeded.
  bool Take();

  // Drops master on every card. Returns whether every card succeeded.
  bool Drop();

 private:
  // Calls `call` on every card, even after one fails, so the cards do not end
  // up in different states. The caller handles a failure: the VT switcher
  // refuses the switch. Holding no cards counts as a failure; see
  // `drm_master_unittest.cc`.
  bool ApplyToEveryCard(const DrmMasterCall& call, const char* verb);

  DrmMasterCall set_master_;
  DrmMasterCall drop_master_;

  // Whether this console owns the display, which decides whether a newly
  // added card is taken. It tracks the intended state, not the kernel's: a
  // refused drop still hands the console over, and a failed take must be
  // retried.
  bool display_is_ours_ = true;

  // Ordered so failures are reported in a stable card order.
  std::map<base::FilePath, base::ScopedFD> cards_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MASTER_H_
