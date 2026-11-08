// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_SURFACE_HOLDS_H_
#define COMPONENTS_DOMICILE_ENGINE_SURFACE_HOLDS_H_

#include <cstdint>

#include "base/containers/flat_map.h"
#include "base/containers/flat_set.h"

namespace domicile {

// Counts viz's holds on a surface's buffers, so a buffer its client destroys
// stays imported until viz is done drawing it.
class SurfaceHolds {
 public:
  // What to do with a buffer viz returned.
  enum class Return {
    // The client still has it: send wl_buffer.release.
    kRelease,
    // The client destroyed it and viz holds none: drop the import.
    kDestroy,
    // The client destroyed it, but viz still holds it from a later frame.
    kKeep,
  };

  SurfaceHolds();
  SurfaceHolds(const SurfaceHolds&) = delete;
  SurfaceHolds& operator=(const SurfaceHolds&) = delete;
  ~SurfaceHolds();

  // A frame showing `buffer` went to viz.
  void Sent(uint64_t buffer);

  // Viz returned `count` holds on `buffer`.
  Return Returned(uint64_t buffer, int count);

  // The client destroyed `buffer`. True when viz holds none of it, so its
  // import can be dropped now.
  bool Destroyed(uint64_t buffer);

 private:
  base::flat_map<uint64_t, int> held_;
  base::flat_set<uint64_t> destroyed_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_SURFACE_HOLDS_H_
