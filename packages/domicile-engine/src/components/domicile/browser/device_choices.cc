// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/device_choices.h"

#include <algorithm>
#include <set>

#include "base/check_op.h"

namespace domicile {

DeviceChoices::DeviceChoices() = default;

DeviceChoices::~DeviceChoices() = default;

void DeviceChoices::Listed(size_t count) {
  ids_.clear();
  for (size_t i = 0; i < count; ++i) {
    ids_.push_back(next_id_++);
  }
}

void DeviceChoices::Added(size_t index) {
  CHECK_LE(index, ids_.size());
  ids_.insert(ids_.begin() + index, next_id_++);
}

void DeviceChoices::Removed(size_t index) {
  CHECK_LT(index, ids_.size());
  ids_.erase(ids_.begin() + index);
}

std::optional<std::vector<size_t>> DeviceChoices::IndicesOf(
    const std::vector<int32_t>& chosen,
    bool multiple) const {
  const std::set<int32_t> distinct(chosen.begin(), chosen.end());
  const bool fits = !chosen.empty() && (multiple || chosen.size() == 1) &&
                    distinct.size() == chosen.size() &&
                    std::ranges::all_of(chosen, [this](int32_t id) {
                      return id >= 1 && id < next_id_;
                    });
  if (!fits) {
    return std::nullopt;
  }
  std::vector<size_t> indices;
  for (size_t i = 0; i < ids_.size(); ++i) {
    if (distinct.contains(ids_[i])) {
      indices.push_back(i);
    }
  }
  return indices;
}

}  // namespace domicile
