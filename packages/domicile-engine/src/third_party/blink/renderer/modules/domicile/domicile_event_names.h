// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_EVENT_NAMES_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_EVENT_NAMES_H_

#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"

// The events navigator.domicile dispatches, one line each: the name a page
// listens for, and the function that names it here.
//
// NOT IN core/events/event_type_names.json5, which is where Blink keeps its
// own and where these were. That file generates a header nearly all of Blink
// includes, so adding a name there recompiled most of Blink: engine run
// 36179223074 added one and built for 79 minutes at 4.5% compiler-cache hits.
// Only this directory includes this file.
//
// Nothing about the events changes by living here. A page hears the same
// type, dispatch compares AtomicStrings by pointer wherever they were made,
// and each is made once, on the main thread, the first time it is used.
// scripts/test-engine-event-names.sh keeps this list, the IDL's on<name>
// handlers and the list guard-control-arrival fires in a real engine the
// same set.
#define DOMICILE_EVENT_NAMES(X)          \
  X(apptitled, Apptitled)                \
  X(appappeared, Appappeared)            \
  X(appresized, Appresized)              \
  X(appclosed, Appclosed)                \
  X(appcursor, Appcursor)                \
  X(shortcut, Shortcut)                  \
  X(modifiers, Modifiers)                \
  X(files, Files)                        \
  X(filepreview, Filepreview)            \
  X(battery, Battery)                    \
  X(clipboard, Clipboard)                \
  X(theme, Theme)                        \
  X(idle, Idle)                          \
  X(focuschanged, Focuschanged)          \
  X(focusrequested, Focusrequested)      \
  X(displayschanged, Displayschanged)    \
  X(locked, Locked)

namespace blink::domicile_event_names {

#define DOMICILE_DECLARE_EVENT_NAME(lower_name, function_name) \
  const AtomicString& function_name();
DOMICILE_EVENT_NAMES(DOMICILE_DECLARE_EVENT_NAME)
#undef DOMICILE_DECLARE_EVENT_NAME

}  // namespace blink::domicile_event_names

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_EVENT_NAMES_H_
