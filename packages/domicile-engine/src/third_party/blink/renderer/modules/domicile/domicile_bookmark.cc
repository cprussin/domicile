// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_bookmark.h"

namespace blink {

DomicileBookmark::DomicileBookmark(const String& name,
                                   const String& url,
                                   const String& icon)
    : name_(name), url_(url), icon_(icon) {}

DomicileBookmark::~DomicileBookmark() = default;

}  // namespace blink
