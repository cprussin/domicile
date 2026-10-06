// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Checks whether a color appears in the pixels viz drew for the browser's
// page. Used by guard-webview-framing.sh, which has no Wayland client.
//
// `--witness` is a color the page always paints. If it never appears, nothing
// was measured, so "absent" would be meaningless. Exit status:
//
//   0  the subject color is on the page
//   1  the witness is on the page and the subject is not
//   2  the witness never appeared, so nothing was measured
//   3  the probe could not run
//
// Colors match exactly; a near match would be an edge or a blend.

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
constexpr char kColorSwitch[] = "color";
constexpr char kWitnessSwitch[] = "witness";
constexpr char kForSecondsSwitch[] = "for-seconds";

// Long enough for the browser to start and paint, short enough to fail before
// the CI step's timeout.
constexpr int kDefaultSeconds = 60;

// Each capture is a blocking readback of the whole window, so do not spin.
constexpr base::TimeDelta kLookEvery = base::Milliseconds(500);

// The exit statuses listed above.
enum class Verdict {
  kFound = 0,
  kAbsent = 1,
  kNothingMeasured = 2,
  kUnusable = 3,
};

bool ParseColor(const base::CommandLine& command_line,
                const char* name,
                uint32_t* out) {
  const std::string value = command_line.GetSwitchValueASCII(name);
  if (value.empty()) {
    return false;
  }
  return base::HexStringToUInt(value, out);
}

// Waits by polling the engine's fd, dispatching anything that arrives.
void WaitABit(DomicileEngine* engine) {
  pollfd descriptor = {
      .fd = domicile_engine_fd(engine), .events = POLLIN, .revents = 0};
  if (poll(&descriptor, 1, static_cast<int>(kLookEvery.InMilliseconds())) > 0) {
    domicile_engine_dispatch(engine);
  }
}

// Takes a std::string because -Wunsafe-buffer-usage-in-libc-call rejects a
// bare `const char*` passed to %s.
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
  if (socket.empty() || !ParseColor(command_line, kColorSwitch, &subject) ||
      !ParseColor(command_line, kWitnessSwitch, &witness)) {
    fprintf(stderr, "%s",
            "usage: domicile_color_probe --domicile-broker-socket=<path> "
            "--color=AARRGGBB --witness=AARRGGBB [--for-seconds=60]\n");
    return static_cast<int>(Verdict::kUnusable);
  }
  int seconds = kDefaultSeconds;
  if (command_line.HasSwitch(kForSecondsSwitch)) {
    if (!base::StringToInt(command_line.GetSwitchValueASCII(kForSecondsSwitch),
                           &seconds) ||
        seconds <= 0) {
      // Passed through %s to satisfy the libc-call check.
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
    const int32_t found = domicile_engine_spike_find_color(engine, subject,
                                                           &box);
    if (found >= 0) {
      ++captures;
    }
    if (found == 1) {
      Describe("found:", subject, box);
      domicile_engine_destroy(engine);
      return static_cast<int>(Verdict::kFound);
    }

    // Stop looking once seen: the witness does not move, and each look is a
    // full readback.
    if (!witnessed &&
        domicile_engine_spike_find_color(engine, witness, &witness_box) == 1) {
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
