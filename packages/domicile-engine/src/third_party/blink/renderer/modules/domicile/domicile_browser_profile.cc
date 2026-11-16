// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_browser_profile.h"

#include "third_party/blink/renderer/platform/heap/garbage_collected.h"

namespace blink {

DomicileBrowserProfile::DomicileBrowserProfile(
    const String& id,
    const String& name,
    const String& color,
    bool is_private,
    bool is_default,
    bool is_default_private,
    const Vector<String>& pinned_sites,
    const Vector<String>& config_sites)
    : id_(id),
      name_(name),
      color_(color),
      is_private_(is_private),
      is_default_(is_default),
      is_default_private_(is_default_private),
      pinned_sites_(MakeGarbageCollected<FrozenArray<IDLString>>(
          Vector<String>(pinned_sites))),
      config_sites_(MakeGarbageCollected<FrozenArray<IDLString>>(
          Vector<String>(config_sites))) {}

DomicileBrowserProfile::~DomicileBrowserProfile() = default;

void DomicileBrowserProfile::Trace(Visitor* visitor) const {
  visitor->Trace(pinned_sites_);
  visitor->Trace(config_sites_);
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
