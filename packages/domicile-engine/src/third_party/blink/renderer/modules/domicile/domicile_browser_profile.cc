// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_browser_profile.h"

namespace blink {

DomicileBrowserProfile::DomicileBrowserProfile(const String& id,
                                               const String& name,
                                               const String& color,
                                               bool is_private,
                                               bool is_default,
                                               bool is_default_private)
    : id_(id),
      name_(name),
      color_(color),
      is_private_(is_private),
      is_default_(is_default),
      is_default_private_(is_default_private) {}

DomicileBrowserProfile::~DomicileBrowserProfile() = default;

void DomicileBrowserProfile::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
