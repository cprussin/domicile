// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_DESK_INPUT_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_DESK_INPUT_H_

#include "ui/ozone/public/ozone_platform.h"

namespace ui {

class SystemInputInjector;

// Sends emulated input (EIS) through `injector`, the evdev pipeline's own, so
// the desk hears it as it hears a real pointer and keyboard: the shell sees it
// first, and its lock screen takes it. See
// docs/architecture/A-HEADLESS-DESKTOP.md in the Domicile repository.
//
// - A pointer point is in desk pixels, as `DrmCursor` takes a screen point.
// - One wheel detent is 15 pixels, as on a headless desk.
// - A button or key with no evdev meaning is dropped.
// - No key repeats: a held key is pressed once, as on a headless desk.
void InjectDeskInput(SystemInputInjector& injector,
                     const DomicileDeskInput& input);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_DESK_INPUT_H_
