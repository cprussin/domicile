// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Captures the browser's display through the C ABI and reads the frames back.
// Used by guard-display-capture.sh, with a shell painted one color.
//
// Starts a capture at one size, waits for a frame whose center is `--color`,
// resizes the capture, and waits for a frame of the new size in that color.
// Releases every frame, as the compositor does. Exit status:
//
//   0  both frames came, the right size and color
//   1  a frame came, and its center is another color
//   2  no frame came, or none at the new size
//   3  the probe could not run
//
// Reads shared memory and linear dmabufs; a headless browser sends the first.

#include <poll.h>
#include <sys/mman.h>

#include <cstdint>
#include <cstdio>
#include <string>

#include "base/command_line.h"
#include "base/compiler_specific.h"
#include "base/containers/span.h"
#include "base/memory/raw_ptr_exclusion.h"
#include "base/strings/string_number_conversions.h"
#include "base/time/time.h"
#include "components/domicile/engine/domicile_engine.h"

namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
constexpr char kColorSwitch[] = "color";
constexpr char kForSecondsSwitch[] = "for-seconds";

constexpr int kDefaultSeconds = 60;

// Even, since viz rounds an ARGB capture to even sizes.
constexpr uint32_t kFirstWidth = 400;
constexpr uint32_t kFirstHeight = 300;
constexpr uint32_t kResizedWidth = 200;
constexpr uint32_t kResizedHeight = 150;

constexpr uint32_t kFramesPerSecond = 30;

// DRM_FORMAT_ARGB8888 and DRM_FORMAT_ABGR8888.
constexpr uint32_t kArgb8888 = 0x34325241;
constexpr uint32_t kAbgr8888 = 0x34324241;

// DRM_FORMAT_MOD_LINEAR.
constexpr uint64_t kLinear = 0;

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
  uint32_t want = 0;
  uint32_t width = kFirstWidth;
  uint32_t height = kFirstHeight;
  bool matched = false;
  // The last center color read, or -1 before any.
  int64_t last = -1;
  bool unusable = false;
  bool ended = false;
  int frames = 0;
};

// The 0xRRGGBB at the center of `record`'s content, or -1 if it cannot be
// read.
int64_t CenterColor(const DomicileCapturedFrame& record) {
  if (record.plane_count != 1 ||
      (record.memory == DOMICILE_CAPTURE_DMABUF && record.modifier != kLinear) ||
      (record.fourcc != kArgb8888 && record.fourcc != kAbgr8888)) {
    return -1;
  }
  const DomicileDmabufPlane plane = base::span(record.planes)[0];
  const size_t length =
      plane.offset + static_cast<size_t>(plane.stride) * record.height;
  void* mapped = mmap(nullptr, length, PROT_READ, MAP_SHARED, plane.fd, 0);
  if (mapped == MAP_FAILED) {
    return -1;
  }
  // SAFETY: `mapped` is `length` bytes, mapped just above.
  const auto bytes = UNSAFE_BUFFERS(
      base::span(static_cast<const uint8_t*>(mapped), length));
  const size_t x = static_cast<size_t>(record.content_x) +
                   static_cast<size_t>(record.content_width) / 2;
  const size_t y = static_cast<size_t>(record.content_y) +
                   static_cast<size_t>(record.content_height) / 2;
  const auto pixel = bytes.subspan(plane.offset + y * plane.stride + x * 4, 4u);
  // ARGB8888 is B, G, R, A in memory; ABGR8888 is R, G, B, A.
  const bool bgra = record.fourcc == kArgb8888;
  const uint32_t red = bgra ? pixel[2] : pixel[0];
  const uint32_t green = pixel[1];
  const uint32_t blue = bgra ? pixel[0] : pixel[2];
  munmap(mapped, length);
  return (red << 16) | (green << 8) | blue;
}

void OnCaptured(void* user_data,
                DomicileCaptureId capture,
                uint64_t frame,
                const DomicileCapturedFrame* record) {
  Seen* seen = static_cast<Seen*>(user_data);
  ++seen->frames;
  const int64_t center = CenterColor(*record);
  printf("frame %llu: %ux%u, content %dx%d at (%d,%d), center #%06llX\n",
         static_cast<unsigned long long>(frame), record->width, record->height,
         record->content_width, record->content_height, record->content_x,
         record->content_y, static_cast<unsigned long long>(center));
  domicile_captured_frame_release(seen->engine, capture, frame);
  if (center < 0) {
    seen->unusable = true;
    return;
  }
  seen->last = center;
  seen->matched = record->width == seen->width &&
                  record->height == seen->height && center == seen->want;
}

void OnCaptureEnded(void* user_data, DomicileCaptureId capture) {
  static_cast<Seen*>(user_data)->ended = true;
}

// Dispatches the engine's events until `seen` matches or `deadline` passes.
void WaitForMatch(Seen* seen, base::TimeTicks deadline) {
  while (!seen->matched && !seen->unusable && !seen->ended &&
         base::TimeTicks::Now() < deadline) {
    pollfd descriptor = {
        .fd = domicile_engine_fd(seen->engine), .events = POLLIN, .revents = 0};
    if (poll(&descriptor, 1, 100) > 0) {
      domicile_engine_dispatch(seen->engine);
    }
  }
}

// Says why the probe stopped before a match.
Verdict Unmatched(const Seen& seen, const std::string& when) {
  if (seen.unusable) {
    fprintf(stderr, "a frame came that the probe cannot read, %s\n",
            when.c_str());
    return Verdict::kUnusable;
  }
  if (seen.last >= 0 && seen.last != seen.want) {
    fprintf(stderr, "the frames' center is #%06llX, not #%06X, %s\n",
            static_cast<unsigned long long>(seen.last), seen.want,
            when.c_str());
    return Verdict::kWrongColor;
  }
  fprintf(stderr, "no %ux%u frame came%s, %s\n", seen.width, seen.height,
          seen.ended ? " and the browser ended the capture" : "",
          when.c_str());
  return Verdict::kNoFrame;
}

}  // namespace

int main(int argc, char** argv) {
  base::CommandLine::Init(argc, argv);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();

  const std::string socket = command_line.GetSwitchValueASCII(kSocketSwitch);
  Seen seen;
  int seconds = kDefaultSeconds;
  if (socket.empty() ||
      !base::HexStringToUInt(command_line.GetSwitchValueASCII(kColorSwitch),
                             &seen.want) ||
      (command_line.HasSwitch(kForSecondsSwitch) &&
       !base::StringToInt(command_line.GetSwitchValueASCII(kForSecondsSwitch),
                          &seconds))) {
    fprintf(stderr, "%s",
            "usage: domicile_capture_probe --domicile-broker-socket=<path> "
            "--color=RRGGBB [--for-seconds=60]\n");
    return static_cast<int>(Verdict::kUnusable);
  }

  DomicileEngineCallbacks callbacks = {};
  callbacks.user_data = &seen;
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
  // The browser's window can open after its socket, so ask until it answers.
  DomicileCaptureId capture = 0;
  while (capture == 0 && base::TimeTicks::Now() < deadline) {
    capture = domicile_display_capture_start(seen.engine, /*display_id=*/0,
                                             kFirstWidth, kFirstHeight,
                                             kFramesPerSecond);
    if (capture == 0) {
      poll(nullptr, 0, 500);
    }
  }
  if (capture == 0) {
    fprintf(stderr, "the browser refused every capture of its window\n");
    domicile_engine_destroy(seen.engine);
    return static_cast<int>(Verdict::kNoFrame);
  }
  printf("capturing the browser's window as capture %u\n", capture);

  WaitForMatch(&seen, deadline);
  if (!seen.matched) {
    const Verdict verdict = Unmatched(seen, "before the resize");
    domicile_engine_destroy(seen.engine);
    return static_cast<int>(verdict);
  }

  seen.matched = false;
  seen.width = kResizedWidth;
  seen.height = kResizedHeight;
  domicile_display_capture_resize(seen.engine, capture, kResizedWidth,
                                  kResizedHeight);
  WaitForMatch(&seen, deadline);
  const Verdict verdict =
      seen.matched ? Verdict::kFound : Unmatched(seen, "after the resize");

  domicile_display_capture_stop(seen.engine, capture);
  domicile_engine_destroy(seen.engine);
  if (verdict == Verdict::kFound) {
    printf("found #%06X at both sizes in %d frame(s)\n", seen.want,
           seen.frames);
  }
  return static_cast<int>(verdict);
}
