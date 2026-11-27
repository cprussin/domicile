// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/device_details.h"

#include <algorithm>
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
  EXPECT_EQ(changed, 8u);

  std::vector<uint8_t> other = truth;
  FarblePixels(43, other);
  EXPECT_NE(other, once);
}

// A picture with something in only every `every`th pixel, the rest clear.
std::vector<uint8_t> Sparse(size_t pixels, size_t every) {
  std::vector<uint8_t> bytes(pixels * 4, 0);
  for (size_t pixel = 0; pixel < pixels; pixel += every) {
    bytes[pixel * 4] = static_cast<uint8_t>(pixel);
    bytes[pixel * 4 + 3] = 255;
  }
  return bytes;
}

// The bytes `farbled` differs from `truth` in, each checked to be the lowest
// bit of a color of a visible pixel.
size_t ChangedBytes(const std::vector<uint8_t>& truth,
                    const std::vector<uint8_t>& farbled) {
  size_t changed = 0;
  for (size_t i = 0; i < truth.size(); ++i) {
    if (farbled[i] != truth[i]) {
      ++changed;
      EXPECT_EQ(farbled[i] ^ truth[i], 1);
      EXPECT_NE(i % 4, 3u);
      EXPECT_NE(truth[i - i % 4 + 3], 0);
    }
  }
  return changed;
}

TEST(DeviceDetailsTest, AMostlyClearPictureAlwaysChangesByEightPixels) {
  // About a third drawn, like a fingerprinting canvas: picks that could land
  // on clear pixels would leave it untouched for some seeds.
  const std::vector<uint8_t> truth = Sparse(10000, 3);
  for (uint64_t seed = 0; seed < 1000; ++seed) {
    std::vector<uint8_t> farbled = truth;
    FarblePixels(seed, farbled);
    EXPECT_EQ(ChangedBytes(truth, farbled), 8u) << "seed " << seed;
  }
}

TEST(DeviceDetailsTest, AFewVisiblePixelsAllChange) {
  for (size_t visible = 1; visible <= 9; ++visible) {
    const std::vector<uint8_t> truth = Sparse(visible * 50, 50);
    for (uint64_t seed = 0; seed < 100; ++seed) {
      std::vector<uint8_t> farbled = truth;
      FarblePixels(seed, farbled);
      EXPECT_EQ(ChangedBytes(truth, farbled), std::min<size_t>(visible, 8))
          << visible << " visible, seed " << seed;
    }
  }
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
