// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/device_details.h"

#include <cmath>
#include <cstdint>
#include <set>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// A picture with something in every pixel: each byte its own index.
std::vector<uint8_t> Opaque(size_t pixels) {
  std::vector<uint8_t> bytes(pixels * 4);
  for (size_t i = 0; i < bytes.size(); ++i) {
    bytes[i] = static_cast<uint8_t>(i);
  }
  for (size_t i = 3; i < bytes.size(); i += 4) {
    bytes[i] = 255;
  }
  return bytes;
}

TEST(DeviceDetailsTest, ConcurrencyIsBetweenTwoAndTheTruthAndVaries) {
  std::set<unsigned> seen;
  for (uint64_t seed = 0; seed < 64; ++seed) {
    const unsigned farbled = FarbledHardwareConcurrency(seed, 16);
    EXPECT_GE(farbled, 2u);
    EXPECT_LE(farbled, 16u);
    EXPECT_EQ(farbled, FarbledHardwareConcurrency(seed, 16));
    seen.insert(farbled);
  }
  EXPECT_GT(seen.size(), 4u);
  EXPECT_EQ(FarbledHardwareConcurrency(7, 2), 2u);
  EXPECT_EQ(FarbledHardwareConcurrency(7, 1), 1u);
}

TEST(DeviceDetailsTest, AudioIsOffByAHundredThousandthAtMost) {
  std::set<float> seen;
  for (uint64_t seed = 0; seed < 64; ++seed) {
    const float factor = FarbledAudioFactor(seed);
    EXPECT_NE(factor, 1.0f);
    EXPECT_LE(std::abs(factor - 1.0f), 1.1e-5f);
    EXPECT_EQ(factor, FarbledAudioFactor(seed));
    seen.insert(factor);
  }
  EXPECT_GT(seen.size(), 32u);
}

TEST(DeviceDetailsTest, APictureChangesALittleAndTheSameEachTime) {
  const std::vector<uint8_t> truth = Opaque(64);
  std::vector<uint8_t> once = truth;
  std::vector<uint8_t> again = truth;
  FarblePixels(42, once);
  FarblePixels(42, again);

  EXPECT_EQ(once, again);
  size_t changed = 0;
  for (size_t i = 0; i < truth.size(); ++i) {
    if (once[i] != truth[i]) {
      ++changed;
      // The lowest bit of a color, never alpha.
      EXPECT_EQ(once[i] ^ truth[i], 1);
      EXPECT_NE(i % 4, 3u);
    }
  }
  EXPECT_GT(changed, 0u);
  EXPECT_LE(changed, 8u);

  std::vector<uint8_t> other = truth;
  FarblePixels(43, other);
  EXPECT_NE(other, once);
}

TEST(DeviceDetailsTest, NothingVisibleStaysAsItIs) {
  std::vector<uint8_t> clear(64 * 4, 0);
  FarblePixels(42, clear);
  EXPECT_EQ(clear, std::vector<uint8_t>(64 * 4, 0));

  std::vector<uint8_t> short_of_a_pixel = {1, 2, 3};
  FarblePixels(42, short_of_a_pixel);
  EXPECT_EQ(short_of_a_pixel, (std::vector<uint8_t>{1, 2, 3}));
}

}  // namespace
}  // namespace domicile
