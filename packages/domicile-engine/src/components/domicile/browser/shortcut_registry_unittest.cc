// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shortcut_registry.h"

#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Alt+Tab and Alt+Enter, in the evdev codes the shell claims them in.
constexpr uint32_t kTab = 15;
constexpr uint32_t kEnter = 28;

Chord AltTab() {
  return Chord{kTab, /*alt=*/true, /*ctrl=*/false, /*shift=*/false,
               /*meta=*/false};
}

// A channel that keeps what it was told, in order. Registered against a
// registry built on the stack rather than the process-wide one: what is under
// test here is the matching and the bookkeeping, and neither wants a singleton
// to be reset between tests.
class RecordingChannel {
 public:
  explicit RecordingChannel(ShortcutRegistry& registry)
      : id_(registry.AddChannel(
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

  EXPECT_FALSE(registry.Press(AltTab()));
  EXPECT_TRUE(channel.presses().empty());
}

TEST(ShortcutRegistryTest, AClaimedChordFiresOnTheChannelThatClaimedIt) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());

  EXPECT_TRUE(registry.Press(AltTab()));
  ASSERT_EQ(1u, channel.presses().size());
  EXPECT_EQ(AltTab(), channel.presses()[0]);
}

// THE WHOLE COMBINATION IS THE CLAIM, which is the shell's own reading of it:
// `ALT_ENTER` names every modifier including the three that must not be held,
// because Ctrl+Alt+Enter is a combination nobody claimed and the page is the
// only path that should answer it.
TEST(ShortcutRegistryTest, AChordIsEveryModifierAndNotJustTheKey) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());

  EXPECT_FALSE(registry.Press(
      Chord{kTab, /*alt=*/false, /*ctrl=*/false, /*shift=*/false,
            /*meta=*/false}));
  EXPECT_FALSE(registry.Press(
      Chord{kTab, /*alt=*/true, /*ctrl=*/false, /*shift=*/true,
            /*meta=*/false}));
  EXPECT_FALSE(registry.Press(
      Chord{kEnter, /*alt=*/true, /*ctrl=*/false, /*shift=*/false,
            /*meta=*/false}));
  EXPECT_TRUE(channel.presses().empty());
}

// The protocol says so in as many words: registering the same combination
// twice is not an error, it is one claim. A shell re-runs the effect that
// claims its chords whenever the callbacks it closes over change.
TEST(ShortcutRegistryTest, ClaimingOneChordTwiceIsOneClaim) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());
  registry.Grab(AltTab());

  EXPECT_TRUE(registry.Press(AltTab()));
  EXPECT_EQ(1u, channel.presses().size());
}

// A page that went away is one nothing may be delivered to. The channel is
// destroyed with the pipe, and a registry still holding its callback would run
// it against freed memory on the next keystroke.
TEST(ShortcutRegistryTest, AChannelThatLeftIsToldNothing) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);
  registry.Grab(AltTab());
  registry.RemoveChannel(channel.id());

  // Still the desktop's key -- the claim outlives the channel that made it,
  // which is what stops a reload from handing chords back to the focused page.
  EXPECT_TRUE(registry.Press(AltTab()));
  EXPECT_TRUE(channel.presses().empty());
}

// Modifiers are a state, not a stream: the shell re-renders on every one it is
// told about, and a keystroke a user types with Alt held would otherwise
// report the same set once per key.
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

// The first set is a change, and it has to be: a shell assumes nothing is held
// until it is told otherwise, so a registry that started out believing the
// same thing would swallow the first Alt of the session -- which is the one
// that begins the drag.
TEST(ShortcutRegistryTest, TheFirstModifiersAreAlwaysReported) {
  ShortcutRegistry registry;
  RecordingChannel channel(registry);

  registry.SetModifiers(
      Modifiers{/*alt=*/false, /*ctrl=*/false, /*shift=*/false, /*meta=*/false});

  EXPECT_EQ(1u, channel.modifiers().size());
}

}  // namespace
}  // namespace domicile
