// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/device_details.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace domicile {

namespace {

// Each detail's own stream from the seed, so one can't be worked out from
// another.
constexpr uint64_t kConcurrency = 0x636f6e6375727265;
constexpr uint64_t kAudio = 0x617564696f617564;
constexpr uint64_t kPixels = 0x706978656c706978;

// How many visible pixels FarblePixels changes (all of them when there are
// fewer): enough that a picture's hash is never the true one's, few enough
// that nobody could see them.
constexpr int kFlips = 8;

constexpr size_t kBytesPerPixel = 4;

// SplitMix64's step: a well-spread 64 bits from any.
uint64_t Mix(uint64_t x) {
  x += 0x9e3779b97f4a7c15;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9;
  x = (x ^ (x >> 27)) * 0x94d049bb133111eb;
  return x ^ (x >> 31);
}

// FNV-1a over `bytes`, from `basis`.
uint64_t Hash(uint64_t basis, base::span<const uint8_t> bytes) {
  uint64_t hash = basis ^ 0xcbf29ce484222325;
  for (uint8_t byte : bytes) {
    hash = (hash ^ byte) * 0x100000001b3;
  }
  return hash;
}

}  // namespace

unsigned FarbledHardwareConcurrency(uint64_t seed, unsigned real) {
  if (real <= 2) {
    return real;
  }
  return 2 + static_cast<unsigned>(Mix(seed ^ kConcurrency) % (real - 1));
}

float FarbledAudioFactor(uint64_t seed) {
  // The top 53 bits, as a double in [0, 1).
  const double unit =
      static_cast<double>(Mix(seed ^ kAudio) >> 11) * 0x1.0p-53;
  double delta = (unit * 2 - 1) * 1e-5;
  // Far enough from 1 that a float's samples change.
  if (std::abs(delta) < 1e-6) {
    delta = delta < 0 ? -1e-6 : 1e-6;
  }
  return static_cast<float>(1 + delta);
}

void FarblePixels(uint64_t seed, base::span<uint8_t> pixels) {
  const size_t count = pixels.size() / kBytesPerPixel;
  size_t visible = 0;
  for (size_t pixel = 0; pixel < count; ++pixel) {
    if (pixels[pixel * kBytesPerPixel + 3] != 0) {
      ++visible;
    }
  }
  // A pixel with nothing to see keeps its nothing.
  if (visible == 0) {
    return;
  }
  const uint64_t hash = Hash(Mix(seed ^ kPixels), pixels);

  // Which visible pixels change, counted among the visible ones only, so a
  // picture that is mostly see-through changes as surely as a full one, and
  // each a different one, so no two flips undo each other.
  struct Flip {
    size_t rank;
    size_t channel;
  };
  std::vector<Flip> flips;
  const size_t wanted = std::min(static_cast<size_t>(kFlips), visible);
  for (uint64_t draw = 0; flips.size() < wanted; ++draw) {
    const uint64_t pick = Mix(hash + draw);
    // Few visible pixels: each of them, so this never has to keep drawing.
    const size_t rank =
        visible <= static_cast<size_t>(kFlips)
            ? flips.size()
            : static_cast<size_t>(pick % visible);
    if (std::any_of(flips.begin(), flips.end(),
                    [rank](const Flip& flip) { return flip.rank == rank; })) {
      continue;
    }
    flips.push_back({rank, static_cast<size_t>((pick >> 32) % 3)});
  }
  std::sort(flips.begin(), flips.end(),
            [](const Flip& a, const Flip& b) { return a.rank < b.rank; });

  auto next = flips.begin();
  size_t rank = 0;
  for (size_t pixel = 0; pixel < count && next != flips.end(); ++pixel) {
    const size_t at = pixel * kBytesPerPixel;
    if (pixels[at + 3] == 0) {
      continue;
    }
    if (rank == next->rank) {
      pixels[at + next->channel] ^= 1;
      ++next;
    }
    ++rank;
  }
}

}  // namespace domicile
