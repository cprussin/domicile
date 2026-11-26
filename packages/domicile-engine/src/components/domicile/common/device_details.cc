// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/device_details.h"

#include <cmath>
#include <cstddef>

namespace domicile {

namespace {

// Each detail's own stream from the seed, so one can't be worked out from
// another.
constexpr uint64_t kConcurrency = 0x636f6e6375727265;
constexpr uint64_t kAudio = 0x617564696f617564;
constexpr uint64_t kPixels = 0x706978656c706978;

// How many pixels FarblePixels changes: enough that a picture's hash is
// never the true one's, few enough that nobody could see them.
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
  if (count == 0) {
    return;
  }
  const uint64_t hash = Hash(Mix(seed ^ kPixels), pixels);
  for (int flip = 0; flip < kFlips; ++flip) {
    const uint64_t pick = Mix(hash + static_cast<uint64_t>(flip));
    const size_t pixel = static_cast<size_t>(pick % count) * kBytesPerPixel;
    // A pixel with nothing to see keeps its nothing.
    if (pixels[pixel + 3] == 0) {
      continue;
    }
    pixels[pixel + static_cast<size_t>((pick >> 32) % 3)] ^= 1;
  }
}

}  // namespace domicile
