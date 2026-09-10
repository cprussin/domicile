// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Is this colour on the browser's page? Asked from outside the browser, of the
// pixels the display compositor actually drew.
//
// It exists because every other pixel guard in this series needs a Wayland
// client to have committed a frame -- the search runs on the submit path -- and
// guard-webview-framing.sh has no client at all. What it measures is a page
// against itself: a <webview> that shows a site refusing to be framed, and an
// <iframe> that must not.
//
// TWO COLOURS, and the second is what makes an answer of "no" mean anything.
// `--witness` is a colour the page paints on its own; a run that cannot find
// it has not measured the page, and reporting "the colour is absent" from such
// a run would be a negative control that passes on a browser that never
// started. So the exit status distinguishes them:
//
//   0  the subject colour is on the page
//   1  the witness is, the subject is not -- a measurement, and a real "no"
//   2  the witness never appeared, so nothing was measured
//   3  this could not run at all
//
// Both are matched exactly, like every other assertion built on
// domicile_engine_spike_find_colour: a page draws flat colours here and a near
// match would be an edge, a blend, or the browser's own background.

#include <poll.h>

#include <cstdint>
#include <cstdio>
#include <string>

#include "base/command_line.h"
#include "base/strings/string_number_conversions.h"
#include "base/time/time.h"
#include "components/domicile/engine/domicile_engine.h"
#include "components/domicile/engine/domicile_engine_spike.h"

namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
constexpr char kColourSwitch[] = "colour";
constexpr char kWitnessSwitch[] = "witness";
constexpr char kForSecondsSwitch[] = "for-seconds";

// Long enough for a browser to start, load a page over a loopback HTTP server
// and paint it, and short enough that a guard which is never going to pass says
// so inside a CI step rather than at its timeout.
constexpr int kDefaultSeconds = 60;

// How often to look. A CaptureWindow is a blocking readback of the whole
// window, so this is not free and does not want to be a tight loop.
constexpr base::TimeDelta kLookEvery = base::Milliseconds(500);

// What the exit statuses above are, spelled once.
enum class Verdict {
  kFound = 0,
  kAbsent = 1,
  kNothingMeasured = 2,
  kUnusable = 3,
};

bool ParseColour(const base::CommandLine& command_line,
                 const char* name,
                 uint32_t* out) {
  const std::string value = command_line.GetSwitchValueASCII(name);
  if (value.empty()) {
    return false;
  }
  return base::HexStringToUInt(value, out);
}

// Sleeps by polling the engine's fd, which is the loop the compositor runs and
// the only one this has any business running. There is no surface here, so
// nothing is expected to wake it; the point is to wait without spinning.
void WaitABit(DomicileEngine* engine) {
  pollfd descriptor = {
      .fd = domicile_engine_fd(engine), .events = POLLIN, .revents = 0};
  if (poll(&descriptor, 1, static_cast<int>(kLookEvery.InMilliseconds())) > 0) {
    domicile_engine_dispatch(engine);
  }
}

// `what` by value and printed through c_str(), which is not fussiness: this
// tree builds with -Wunsafe-buffer-usage-in-libc-call as an error, and a bare
// `const char*` handed to %s is "not guaranteed to be null-terminated". A
// std::string is.
void Describe(const std::string& what,
              uint32_t argb,
              const DomicileSpikeCapture& box) {
  printf("%s #%08X is %dx%d at (%d,%d) of the browser's %dx%d window\n",
         what.c_str(), argb, box.width, box.height, box.x, box.y,
         box.window_width, box.window_height);
}

}  // namespace

int main(int argc, char** argv) {
  base::CommandLine::Init(argc, argv);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();

  const std::string socket = command_line.GetSwitchValueASCII(kSocketSwitch);
  uint32_t subject = 0;
  uint32_t witness = 0;
  if (socket.empty() || !ParseColour(command_line, kColourSwitch, &subject) ||
      !ParseColour(command_line, kWitnessSwitch, &witness)) {
    fprintf(stderr, "%s",
            "usage: domicile_colour_probe --domicile-broker-socket=<path> "
            "--colour=AARRGGBB --witness=AARRGGBB [--for-seconds=60]\n");
    return static_cast<int>(Verdict::kUnusable);
  }
  int seconds = kDefaultSeconds;
  if (command_line.HasSwitch(kForSecondsSwitch)) {
    if (!base::StringToInt(command_line.GetSwitchValueASCII(kForSecondsSwitch),
                           &seconds) ||
        seconds <= 0) {
      // A literal through %s, like the usage above: the switch name is an
      // array and the libc-call check will not take one.
      fprintf(stderr, "%s",
              "--for-seconds wants a positive number of seconds\n");
      return static_cast<int>(Verdict::kUnusable);
    }
  }

  DomicileEngineCallbacks callbacks = {};
  DomicileEngine* engine = domicile_engine_connect(socket.c_str(), callbacks);
  if (!engine) {
    fprintf(stderr, "could not join the browser's mojo graph at %s\n",
            socket.c_str());
    return static_cast<int>(Verdict::kUnusable);
  }
  printf("joined the browser's mojo graph at %s\n", socket.c_str());
  printf("looking for #%08X, with #%08X as the witness, for %ds\n", subject,
         witness, seconds);

  const base::TimeTicks deadline =
      base::TimeTicks::Now() + base::Seconds(seconds);
  bool witnessed = false;
  DomicileSpikeCapture witness_box = {};
  int captures = 0;

  while (base::TimeTicks::Now() < deadline) {
    DomicileSpikeCapture box = {};
    const int32_t found = domicile_engine_spike_find_colour(engine, subject,
                                                            &box);
    if (found >= 0) {
      ++captures;
    }
    if (found == 1) {
      Describe("found:", subject, box);
      domicile_engine_destroy(engine);
      return static_cast<int>(Verdict::kFound);
    }

    // Only until it has been seen once. The witness is the page's own paint
    // and does not move, and each look is a full readback.
    if (!witnessed &&
        domicile_engine_spike_find_colour(engine, witness, &witness_box) == 1) {
      witnessed = true;
      Describe("witness:", witness, witness_box);
    }

    WaitABit(engine);
  }

  domicile_engine_destroy(engine);

  if (!witnessed) {
    fprintf(stderr,
            "nothing was measured: the witness #%08X never appeared in %ds "
            "(%d capture(s) of the browser's window came back). The page did "
            "not load, or the browser drew nothing at all.\n",
            witness, seconds, captures);
    return static_cast<int>(Verdict::kNothingMeasured);
  }

  printf("absent: #%08X is nowhere in the browser's %dx%d window, which the "
         "witness says was drawn\n",
         subject, witness_box.window_width, witness_box.window_height);
  return static_cast<int>(Verdict::kAbsent);
}
