// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Lays a headless desk out on two virtual displays and captures each one, as
// the compositor would. Used by guard-headless-desk.sh, with a shell painted
// `--left` for its first 640 pixels and `--right` past them.
//
// The left display is 640x480 at 0,0 and the right one 320x240 at 640,0, so
// each capture's center shows one side of the page.
//
// With `--clicked` and `--typed`, it then drives the desk as an EIS client
// would through the compositor: a click on the right display must turn it
// `--clicked`, and the A key the left one `--typed`. Exit status:
//
//   0  both displays came on their connectors and show their color
//   1  a display shows another color, before or after the input
//   2  the displays never came, or a display gave no frame at its size
//   3  the probe could not run

#include <poll.h>

#include <cstdint>
#include <cstdio>
#include <limits>
#include <string>
#include <vector>

#include "base/command_line.h"
#include "base/compiler_specific.h"
#include "base/memory/raw_ptr_exclusion.h"
#include "base/strings/string_number_conversions.h"
#include "base/time/time.h"
#include "components/domicile/engine/captured_color.h"
#include "components/domicile/engine/domicile_engine.h"

namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
constexpr char kLeftSwitch[] = "left";
constexpr char kRightSwitch[] = "right";
constexpr char kForSecondsSwitch[] = "for-seconds";
constexpr char kClickedSwitch[] = "clicked";
constexpr char kTypedSwitch[] = "typed";

// evdev codes.
constexpr uint32_t kBtnLeft = 0x110;
constexpr uint32_t kKeyA = 30;

constexpr int kDefaultSeconds = 60;
constexpr uint32_t kFramesPerSecond = 30;

// One virtual display, as the probe asks for it and expects it back.
struct Wanted {
  int64_t id;
  // A std::string so that printf takes it: a const char* fails
  // -Wunsafe-buffer-usage-in-libc-call.
  std::string name;
  const char* connector;
  int32_t x;
  int32_t width;
  int32_t height;
  uint32_t color = 0;
};

// The exit statuses listed above.
enum class Verdict {
  kFound = 0,
  kWrongColor = 1,
  kNoFrame = 2,
  kUnusable = 3,
};

// What the probe has seen so far.
struct Seen {
  // An opaque C struct from the library, so not a raw_ptr.
  RAW_PTR_EXCLUSION DomicileEngine* engine = nullptr;
  // How many of the wanted displays the last list had, each at its place and
  // on its connector.
  size_t displays_found = 0;
  // The display being captured.
  RAW_PTR_EXCLUSION const Wanted* capturing = nullptr;
  bool matched = false;
  // The last center color read, or -1 before any.
  int64_t last = -1;
  bool unusable = false;
  bool ended = false;
  std::vector<Wanted> wanted;
};

void OnDisplays(void* user_data,
                const DomicileConnectedDisplay* displays,
                uint32_t count) {
  Seen* seen = static_cast<Seen*>(user_data);
  seen->displays_found = 0;
  for (uint32_t index = 0; index < count; ++index) {
    // SAFETY: the engine passes `count` records.
    const DomicileConnectedDisplay& one = UNSAFE_BUFFERS(displays[index]);
    printf("display %lld on %s: %dx%d at %d,%d, \"%s\"\n",
           static_cast<long long>(one.display.id),
           std::string(one.connector).c_str(), one.display.width,
           one.display.height, one.display.x, one.display.y,
           std::string(one.display.name).c_str());
    for (const Wanted& wanted : seen->wanted) {
      if (one.display.id == wanted.id &&
          std::string(one.connector) == wanted.connector &&
          one.display.x == wanted.x && one.display.y == 0 &&
          one.display.width == wanted.width &&
          one.display.height == wanted.height) {
        ++seen->displays_found;
      }
    }
  }
}

void OnCaptured(void* user_data,
                DomicileCaptureId capture,
                uint64_t frame,
                const DomicileCapturedFrame* record) {
  Seen* seen = static_cast<Seen*>(user_data);
  const int64_t center = domicile::CenterColor(*record);
  printf("frame %llu: %ux%u, center #%06llX\n",
         static_cast<unsigned long long>(frame), record->width, record->height,
         static_cast<unsigned long long>(center));
  domicile_captured_frame_release(seen->engine, capture, frame);
  if (center < 0) {
    seen->unusable = true;
    return;
  }
  seen->last = center;
  seen->matched =
      record->width == static_cast<uint32_t>(seen->capturing->width) &&
      record->height == static_cast<uint32_t>(seen->capturing->height) &&
      center == seen->capturing->color;
}

void OnCaptureEnded(void* user_data, DomicileCaptureId capture) {
  static_cast<Seen*>(user_data)->ended = true;
}

// Dispatches the engine's events until `done` or `deadline`.
template <typename Done>
void DispatchUntil(Seen* seen, base::TimeTicks deadline, Done done) {
  while (!done() && base::TimeTicks::Now() < deadline) {
    pollfd descriptor = {
        .fd = domicile_engine_fd(seen->engine), .events = POLLIN, .revents = 0};
    if (poll(&descriptor, 1, 100) > 0) {
      domicile_engine_dispatch(seen->engine);
    }
  }
}

// Captures `wanted` until a frame at its size shows its color.
Verdict Capture(Seen* seen, const Wanted& wanted, base::TimeTicks deadline) {
  seen->capturing = &wanted;
  seen->matched = false;
  seen->last = -1;
  seen->ended = false;
  // The display's window can open after the display, so ask until it answers.
  DomicileCaptureId capture = 0;
  while (capture == 0 && base::TimeTicks::Now() < deadline) {
    capture = domicile_display_capture_start(
        seen->engine, wanted.id, static_cast<uint32_t>(wanted.width),
        static_cast<uint32_t>(wanted.height), kFramesPerSecond);
    if (capture == 0) {
      DispatchUntil(seen, base::TimeTicks::Now() + base::Milliseconds(500),
                    [] { return false; });
    }
  }
  if (capture == 0) {
    fprintf(stderr, "no window shows display %s\n", wanted.name.c_str());
    return Verdict::kNoFrame;
  }
  printf("capturing display %s as capture %u\n", wanted.name.c_str(), capture);
  DispatchUntil(seen, deadline, [seen] {
    return seen->matched || seen->unusable || seen->ended;
  });
  domicile_display_capture_stop(seen->engine, capture);
  if (seen->matched) {
    printf("display %s shows #%06X\n", wanted.name.c_str(), wanted.color);
    return Verdict::kFound;
  }
  if (seen->unusable) {
    fprintf(stderr, "display %s gave a frame the probe cannot read\n",
            wanted.name.c_str());
    return Verdict::kUnusable;
  }
  if (seen->last >= 0) {
    fprintf(stderr, "display %s shows #%06llX, not #%06X\n",
            wanted.name.c_str(), static_cast<unsigned long long>(seen->last),
            wanted.color);
    return Verdict::kWrongColor;
  }
  fprintf(stderr, "display %s gave no %dx%d frame%s\n", wanted.name.c_str(),
          wanted.width, wanted.height,
          seen->ended ? ", and the browser ended the capture" : "");
  return Verdict::kNoFrame;
}

void Inject(Seen* seen, DomicileDeskInput input) {
  domicile_input_inject(seen->engine, &input);
}

// Clicks the right display, then types A, each checked on its display.
Verdict DriveTheDesk(Seen* seen,
                     uint32_t clicked,
                     uint32_t typed,
                     base::TimeTicks deadline) {
  Wanted& left = seen->wanted[0];
  Wanted& right = seen->wanted[1];
  Inject(seen, {.kind = DOMICILE_DESK_INPUT_POINTER,
                .x = right.x + right.width / 2.0,
                .y = right.height / 2.0});
  for (uint32_t pressed : {1u, 0u}) {
    Inject(seen, {.kind = DOMICILE_DESK_INPUT_BUTTON,
                  .code = kBtnLeft,
                  .pressed = pressed});
  }
  printf("clicked the middle of display %s\n", right.name.c_str());
  right.color = clicked;
  Verdict verdict = Capture(seen, right, deadline);
  if (verdict != Verdict::kFound) {
    return verdict;
  }
  for (uint32_t pressed : {1u, 0u}) {
    Inject(
        seen,
        {.kind = DOMICILE_DESK_INPUT_KEY, .code = kKeyA, .pressed = pressed});
  }
  printf("typed A\n");
  left.color = typed;
  return Capture(seen, left, deadline);
}

// Runs the probe on a connected engine.
Verdict Probe(Seen* seen, base::TimeTicks deadline) {
  std::vector<DomicileVirtualDisplay> virtuals;
  std::vector<DomicileDisplayLayout> layout;
  for (const Wanted& wanted : seen->wanted) {
    virtuals.push_back({.id = wanted.id,
                        .width = wanted.width,
                        .height = wanted.height,
                        .refresh_mhz = 60000,
                        .name = wanted.name.c_str()});
    layout.push_back({.id = wanted.id,
                      .enabled = 1,
                      .x = wanted.x,
                      .y = 0,
                      .transform = DOMICILE_DISPLAY_TRANSFORM_NORMAL,
                      .scale = 1.0,
                      .desk_x = wanted.x,
                      .desk_y = 0,
                      .desk_width = wanted.width,
                      .desk_height = wanted.height});
  }
  domicile_virtual_displays_configure(seen->engine, virtuals.data(),
                                      static_cast<uint32_t>(virtuals.size()));
  // The compositor answers the display list with a layout; until then the
  // desk has no presenters.
  domicile_displays_configure(seen->engine, layout.data(),
                              static_cast<uint32_t>(layout.size()));
  DispatchUntil(seen, deadline,
                [seen] { return seen->displays_found == seen->wanted.size(); });
  if (seen->displays_found != seen->wanted.size()) {
    fprintf(stderr,
            "the browser never listed both virtual displays at their places "
            "on their connectors\n");
    return Verdict::kNoFrame;
  }
  for (const Wanted& wanted : seen->wanted) {
    const Verdict verdict = Capture(seen, wanted, deadline);
    if (verdict != Verdict::kFound) {
      return verdict;
    }
  }
  return Verdict::kFound;
}

}  // namespace

int main(int argc, char** argv) {
  base::CommandLine::Init(argc, argv);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();

  constexpr int64_t kVirtualBit = std::numeric_limits<int64_t>::min();
  Seen seen;
  seen.wanted = {
      {.id = kVirtualBit | 1,
       .name = "Left",
       .connector = "virtual-1",
       .x = 0,
       .width = 640,
       .height = 480},
      {.id = kVirtualBit | 2,
       .name = "Right",
       .connector = "virtual-2",
       .x = 640,
       .width = 320,
       .height = 240},
  };
  const std::string socket = command_line.GetSwitchValueASCII(kSocketSwitch);
  int seconds = kDefaultSeconds;
  const bool drives = command_line.HasSwitch(kClickedSwitch);
  uint32_t clicked = 0;
  uint32_t typed = 0;
  if (socket.empty() ||
      !base::HexStringToUInt(command_line.GetSwitchValueASCII(kLeftSwitch),
                             &seen.wanted[0].color) ||
      !base::HexStringToUInt(command_line.GetSwitchValueASCII(kRightSwitch),
                             &seen.wanted[1].color) ||
      (command_line.HasSwitch(kForSecondsSwitch) &&
       !base::StringToInt(command_line.GetSwitchValueASCII(kForSecondsSwitch),
                          &seconds)) ||
      (drives &&
       (!base::HexStringToUInt(command_line.GetSwitchValueASCII(kClickedSwitch),
                               &clicked) ||
        !base::HexStringToUInt(command_line.GetSwitchValueASCII(kTypedSwitch),
                               &typed)))) {
    fprintf(stderr, "%s",
            "usage: domicile_desk_probe --domicile-broker-socket=<path> "
            "--left=RRGGBB --right=RRGGBB [--clicked=RRGGBB --typed=RRGGBB] "
            "[--for-seconds=60]\n");
    return static_cast<int>(Verdict::kUnusable);
  }

  DomicileEngineCallbacks callbacks = {};
  callbacks.user_data = &seen;
  callbacks.connected_displays = &OnDisplays;
  callbacks.captured = &OnCaptured;
  callbacks.capture_ended = &OnCaptureEnded;
  seen.engine = domicile_engine_connect(socket.c_str(), callbacks);
  if (!seen.engine) {
    fprintf(stderr, "could not join the browser's mojo graph at %s\n",
            socket.c_str());
    return static_cast<int>(Verdict::kUnusable);
  }
  const base::TimeTicks deadline =
      base::TimeTicks::Now() + base::Seconds(seconds);
  Verdict verdict = Probe(&seen, deadline);
  if (verdict == Verdict::kFound && drives) {
    verdict = DriveTheDesk(&seen, clicked, typed, deadline);
  }
  domicile_engine_destroy(seen.engine);
  return static_cast<int>(verdict);
}
