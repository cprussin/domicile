// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shortcut_registry.h"

#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Evdev keycodes.
constexpr uint32_t kTab = 15;
constexpr uint32_t kEnter = 28;

Chord AltTab() {
  return Chord{kTab, /*alt=*/true, /*ctrl=*/false, /*shift=*/false,
               /*meta=*/false};
}

// Shell pages on two monitors.
constexpr Page kLeft{/*process=*/1, /*frame=*/1};
constexpr Page kRight{/*process=*/2, /*frame=*/1};

// A channel that records what it receives. Uses a registry on the stack so
// tests do not share the singleton.
class RecordingChannel {
 public:
  explicit RecordingChannel(ShortcutRegistry& registry, Page page = kLeft)
      : id_(registry.AddChannel(
            page,
            base::BindRepeating(&RecordingChannel::OnShortcut,
                                base::Unretained(this)),
            base::BindRepeating(&RecordingChannel::OnModifiers,
                                base::Unretained(this)))) {}

  ShortcutRegistry::ChannelId id() const { return id_; }
  const std::vector<Chord>& presses() const { return presses_; }
  const std::vector<Modifiers>& modifiers() const { return modifiers_; }

 private:
  void OnShortcut(Chord chord) { presses_.push_back(chord); }
  void OnModifiers(Modifiers modifiers) { modifiers_.push_back(modifiers); }

  ShortcutRegistry::ChannelId id_;
  std::vector<Chord> presses_;
  std::vector<Modifiers> modifiers_;
};

TEST(ShortcutRegistryTest, AKeyNobodyClaimedIsNotTheDesktops) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);

  EXPECT_FALSE(registry.Press(AltTab(), kLeft));
  EXPECT_TRUE(channel.presses().empty());
}

TEST(ShortcutRegistryTest, AClaimedChordFiresOnTheChannelThatClaimedIt) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());

  EXPECT_TRUE(registry.Press(AltTab(), kLeft));
  ASSERT_EQ(1u, channel.presses().size());
  EXPECT_EQ(AltTab(), channel.presses()[0]);
}

// A claim matches the exact modifier set. Ctrl+Alt+Enter is not claimed by
// Alt+Enter and must reach the page.
TEST(ShortcutRegistryTest, AChordIsEveryModifierAndNotJustTheKey) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());

  EXPECT_FALSE(registry.Press(
      Chord{kTab, /*alt=*/false, /*ctrl=*/false, /*shift=*/false,
            /*meta=*/false},
      kLeft));
  EXPECT_FALSE(registry.Press(
      Chord{kTab, /*alt=*/true, /*ctrl=*/false, /*shift=*/true,
            /*meta=*/false},
      kLeft));
  EXPECT_FALSE(registry.Press(
      Chord{kEnter, /*alt=*/true, /*ctrl=*/false, /*shift=*/false,
            /*meta=*/false},
      kLeft));
  EXPECT_TRUE(channel.presses().empty());
}

// The protocol makes duplicate claims one claim. A shell re-runs its claiming
// effect whenever its callbacks change.
TEST(ShortcutRegistryTest, ClaimingOneChordTwiceIsOneClaim) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());
  registry.Grab(AltTab());

  EXPECT_TRUE(registry.Press(AltTab(), kLeft));
  EXPECT_EQ(1u, channel.presses().size());
}

// A removed channel's callback may point at freed memory.
TEST(ShortcutRegistryTest, AChannelThatLeftIsToldNothing) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());
  registry.RemoveChannel(channel.id());

  // The claim outlives the channel, so a reload does not hand chords back to
  // the focused page.
  EXPECT_TRUE(registry.Press(AltTab(), kLeft));
  EXPECT_TRUE(channel.presses().empty());
}

// Each monitor has its own page. Telling every page would run one press once
// per monitor (e.g. one terminal per monitor).
TEST(ShortcutRegistryTest, AChordIsToldOnlyToThePageThatHeardIt) {
  ShortcutRegistry registry;
  RecordingChannel left(registry, kLeft);
  RecordingChannel right(registry, kRight);
  registry.Grab(AltTab());

  EXPECT_TRUE(registry.Press(AltTab(), kRight));
  EXPECT_TRUE(left.presses().empty());
  EXPECT_EQ(1u, right.presses().size());
}

// The shell re-renders on each report, so a repeated set is not resent.
TEST(ShortcutRegistryTest, ModifiersAreReportedWhenTheyChangeAndNotOtherwise) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  const Modifiers alt_held{/*alt=*/true, /*ctrl=*/false, /*shift=*/false,
                           /*meta=*/false};
  const Modifiers nothing_held{/*alt=*/false, /*ctrl=*/false, /*shift=*/false,
                               /*meta=*/false};

  registry.SetModifiers(alt_held);
  registry.SetModifiers(alt_held);
  registry.SetModifiers(nothing_held);

  ASSERT_EQ(2u, channel.modifiers().size());
  EXPECT_EQ(alt_held, channel.modifiers()[0]);
  EXPECT_EQ(nothing_held, channel.modifiers()[1]);
}

// The shell assumes nothing is held until told. Suppressing the first report
// would drop the first Alt, which starts a drag.
TEST(ShortcutRegistryTest, TheFirstModifiersAreAlwaysReported) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);

  registry.SetModifiers(
      Modifiers{/*alt=*/false, /*ctrl=*/false, /*shift=*/false, /*meta=*/false});

  EXPECT_EQ(1u, channel.modifiers().size());
}

}  // namespace
}  // namespace domicile
