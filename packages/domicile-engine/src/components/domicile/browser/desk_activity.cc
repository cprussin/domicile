// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_activity.h"

#include <utility>
#include <vector>

#include "base/no_destructor.h"
#include "base/notreached.h"
#include "base/strings/strcat.h"

namespace domicile {

namespace {

// The same as ui::UserActivityDetector's.
constexpr base::TimeDelta kReportInterval = base::Milliseconds(200);

}  // namespace

std::string_view ActivityKindName(ActivityKind kind) {
  switch (kind) {
    case ActivityKind::kKey:
      return "key";
    case ActivityKind::kPointer:
      return "pointer";
    case ActivityKind::kPointerMotion:
      return "pointer_motion";
    case ActivityKind::kTouch:
      return "touch";
    case ActivityKind::kOther:
      return "other";
  }
  NOTREACHED();
}

// static
DeskActivity& DeskActivity::Get() {
  static base::NoDestructor<DeskActivity> activity;
  return *activity;
}

DeskActivity::DeskActivity() = default;
DeskActivity::~DeskActivity() = default;

DeskActivity::ListenerId DeskActivity::AddListener(Listener heard) {
  base::AutoLock held(lock_);
  const ListenerId id = next_id_++;
  listeners_.emplace_back(id, std::move(heard));
  return id;
}

void DeskActivity::RemoveListener(ListenerId listener) {
  base::AutoLock held(lock_);
  std::erase_if(listeners_, [listener](const auto& registered) {
    return registered.first == listener;
  });
}

void DeskActivity::Heard(const std::string& input, ActivityKind kind) {
  // Run outside the lock, since a callback may re-enter this.
  std::vector<Listener> tell;
  {
    base::AutoLock held(lock_);
    for (const auto& listener : listeners_) {
      tell.push_back(listener.second);
    }
  }
  for (const Listener& heard : tell) {
    heard.Run(input, kind);
  }
}

bool ActivityThrottle::ShouldReport(base::TimeTicks now) {
  if (!last_.is_null() && now - last_ < kReportInterval) {
    return false;
  }
  last_ = now;
  return true;
}

std::string DescribeInput(std::string_view event, std::string_view device) {
  if (device.empty()) {
    return std::string(event);
  }
  return base::StrCat({event, " from ", device});
}

}  // namespace domicile
