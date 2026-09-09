// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// THROWAWAY. Step 4 of the spike in docs/architecture/ENGINE-FORK.md: the
// measurement the whole fork exists to justify.
//
// Steps 1 to 3 were plumbing that either worked or named a blocker. This asks
// the question the design is for: does CSS treat an <app> — a <canvas> showing
// a viz surface a process outside the renderer submits to — the way it treats
// any other element?
//
// The answer is not a judgement. The page lays each property out twice, once
// on an <app> and once on an ordinary <div> filled with the colour the producer
// submits, so a property behaves "like a <div>" exactly when one half of a cell
// is a pixel-for-pixel copy of the other. This captures the browser's window
// out of the display compositor's own draw and does that comparison.
//
// Two checks, because they need different pages:
//
//   --check=css     the six CSS properties, against spike-css-page.html
//   --check=resize  the embedder's box changing and the producer being
//                   reconfigured to match, against spike-resize-page.html.
//                   That one mutates the LocalSurfaceId every element in the
//                   document shares, so it cannot share a page with the others
//   --check=iframe  an <app> against an out-of-process <iframe> under the same
//                   transform, against spike-iframe-page.html. The one part of
//                   the CSS claim that was read off the mechanism rather than
//                   measured
//
// packages/domicile-engine/scripts/guard-css-and-resize.sh in the Domicile repository
// runs both and has the engine flags they need.

#include <algorithm>
#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "base/at_exit.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/message_loop/message_pump_type.h"
#include "base/run_loop.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_split.h"
#include "base/strings/stringprintf.h"
#include "base/task/single_thread_task_executor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool/thread_pool_instance.h"
#include "base/threading/thread.h"
#include "base/time/time.h"
#include "components/domicile/spike/css_parity_layout.h"
#include "components/domicile/spike/spike_color.h"
#include "components/domicile/spike/surface_producer.h"
#include "components/domicile/spike/window_diff.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/core/embedder/embedder.h"
#include "mojo/core/embedder/scoped_ipc_support.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace {

using domicile::spike::ColorsMatch;
using domicile::spike::DiffRects;
using domicile::spike::RectDiff;
using domicile::spike::ToHex;
using domicile::spike::WindowCapture;

// Must match content/browser/domicile/domicile_frame_sink_broker.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
constexpr char kColorSwitch[] = "color";
constexpr char kCheckSwitch[] = "check";
constexpr char kResizeFromSwitch[] = "resize-from";
constexpr char kResizeToSwitch[] = "resize-to";

// Which page is on the other side, and so what to make of the pixels.
enum class Check {
  kCss,
  kResize,
  kIframe,
};

// The colour the producer submits, and the colour the page fills every control
// element with. One value reaches both halves through the harness — there is no
// channel from the page to the producer, so the harness is what makes them
// agree, and guard-css-and-resize.sh derives one from the other.
constexpr SkColor kDefaultColor = SkColorSetARGB(0xFF, 0x00, 0xC8, 0x53);

constexpr base::TimeDelta kEmbedTimeout = base::Seconds(60);

// Long enough for the page to have embedded every <app> and for viz to have
// aggregated a frame containing all of them. Sampling is retried, so this is a
// floor rather than a guess at the right moment.
constexpr base::TimeDelta kSettleDelay = base::Seconds(2);

// How different two pixels may be before they count as different. Bigger than
// the tolerance steps 2 and 3 compare one flat colour with, because a scaled or
// blurred surface is resampled from a texture while a <div> is rasterised from
// a vector, and the two round differently in the last bit or two.
constexpr int kPixelTolerance = 4;

// A mismatching pixel every one of whose neighbours within this radius also
// mismatches is inside a region that differs, rather than on the boundary of
// one. That distinction is the whole verdict: a composited surface resamples
// its edges where a <div> rasterises them, exactly as a hardware-composited
// <video> does, so a one-or-two-pixel outline is parity and a filled region is
// not.
constexpr int kEdgeRadius = 2;

// Latency: how many times to change the colour and time how long it takes to
// appear, and the floor to measure it against.
constexpr int kLatencySamples = 60;
constexpr int kLatencyFloorSamples = 60;
constexpr int kMaxLatencyPolls = 200;

// The half of a cell holding the <app>, against the half beside it holding the
// ordinary element the page laid out identically. This is the measurement.
RectDiff DiffHalves(const WindowCapture& capture, const gfx::Rect& left) {
  return DiffRects(
      capture, left,
      gfx::Point(left.x() + domicile::spike::kCellHalfWidth, left.y()),
      kPixelTolerance, kEdgeRadius);
}

gfx::Rect CellRect(size_t index, int viewport_top) {
  const int col = static_cast<int>(index) % domicile::spike::kColumns;
  const int row = static_cast<int>(index) / domicile::spike::kColumns;
  return gfx::Rect(
      domicile::spike::kGridLeft +
          col * (domicile::spike::kCellWidth + domicile::spike::kColumnGap),
      viewport_top + domicile::spike::kGridTop +
          row * (domicile::spike::kCellHeight + domicile::spike::kRowGap),
      domicile::spike::kCellHalfWidth, domicile::spike::kCellHeight);
}

// The middle of the <app> in a cell, in window coordinates.
gfx::Point AppCenter(size_t index, int viewport_top) {
  const gfx::Rect cell = CellRect(index, viewport_top);
  return gfx::Point(
      cell.x() + domicile::spike::kBoxLeft + domicile::spike::kBoxWidth / 2,
      cell.y() + domicile::spike::kBoxTop + domicile::spike::kBoxHeight / 2);
}

std::optional<gfx::Size> ParseSize(const base::CommandLine& command_line,
                                   const char* switch_name) {
  const std::string value = command_line.GetSwitchValueASCII(switch_name);
  const std::vector<std::string> parts = base::SplitString(
      value, "x", base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY);
  int width = 0;
  int height = 0;
  if (parts.size() != 2 || !base::StringToInt(parts[0], &width) ||
      !base::StringToInt(parts[1], &height)) {
    return std::nullopt;
  }
  return gfx::Size(width, height);
}

// The median of an already-sorted run, in display frames — the unit that makes
// these numbers mean anything, since every one of them is a wait for a
// compositor to draw.
std::string InIntervals(const std::vector<base::TimeDelta>& sorted,
                        base::TimeDelta interval) {
  if (interval.is_zero()) {
    return std::string();
  }
  return base::StringPrintf(
      "  (median %.1f frames)",
      sorted[sorted.size() / 2].InMillisecondsF() / interval.InMillisecondsF());
}

// min / median / max of an already-sorted, non-empty run of samples.
std::string Spread(const std::vector<base::TimeDelta>& sorted) {
  return base::StringPrintf(
      "min %.2f, median %.2f, max %.2f ms", sorted.front().InMillisecondsF(),
      sorted[sorted.size() / 2].InMillisecondsF(),
      sorted.back().InMillisecondsF());
}

// Runs one of the two checks against a producer, and sets the exit code.
class Measurement {
 public:
  Measurement(SkColor color,
              Check check,
              const gfx::Size& resize_from,
              const gfx::Size& resize_to,
              base::OnceCallback<void(bool)> done)
      : check_(check),
        resize_from_(resize_from),
        resize_to_(resize_to),
        done_(std::move(done)),
        producer_(color,
                  base::BindRepeating(&Measurement::OnEmbedded,
                                      base::Unretained(this)),
                  base::BindOnce(&Measurement::OnLost, base::Unretained(this))) {
  }

  bool Connect(const mojo::NamedPlatformChannel::ServerName& socket) {
    return producer_.Connect(socket);
  }

  void Start() {
    producer_.Start(
        base::BindOnce(&Measurement::OnBrokered, base::Unretained(this)));
  }

 private:
  void OnBrokered(const viz::FrameSinkId& frame_sink_id) {
    printf("brokered frame sink: %s\n", frame_sink_id.ToString().c_str());
    printf("waiting for a page to embed it...\n");
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&Measurement::OnEmbedTimeout, base::Unretained(this)),
        kEmbedTimeout);
  }

  void OnEmbedded(const viz::LocalSurfaceId& local_surface_id,
                  const gfx::Size& size) {
    ++embeds_;
    printf("embedded (%d): %s at %s\n", embeds_,
           local_surface_id.ToString().c_str(), size.ToString().c_str());
    embedded_sizes_.push_back(size);

    // Every <app> on the CSS page embeds the same surface, so the first
    // notification is the one that matters and the rest repeat it. The resize
    // page has one <app> and re-embeds it, so there the second is the point.
    if (check_ == Check::kResize && embeds_ < 2) {
      return;
    }
    if (settling_) {
      return;
    }
    settling_ = true;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&Measurement::Capture,
                                  base::Unretained(this)),
        kSettleDelay);
  }

  void OnEmbedTimeout() {
    if (producer_.embedded()) {
      return;
    }
    printf("NOT embedded: no page asked for this surface in %" PRId64 "s\n",
           kEmbedTimeout.InSeconds());
    Finish(false);
  }

  void Capture() {
    producer_.probe()->CaptureWindow(
        base::BindOnce(&Measurement::OnCaptured, base::Unretained(this)));
  }

  void OnCaptured(bool captured, const gfx::Size& size,
                  const std::vector<uint32_t>& pixels) {
    if (!captured) {
      if (++capture_tries_ < 20) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
            FROM_HERE,
            base::BindOnce(&Measurement::Capture, base::Unretained(this)),
            base::Milliseconds(200));
        return;
      }
      printf("the browser never drew its window\n");
      Finish(false);
      return;
    }

    capture_ = WindowCapture(size, pixels);
    if (!capture_.valid()) {
      printf("the browser returned a window it could not describe\n");
      Finish(false);
      return;
    }

    viewport_top_ = capture_.FindViewportTop(domicile::spike::kPageBackground,
                                             kPixelTolerance);
    if (viewport_top_ < 0) {
      printf("no row of the %s window is the page's background %s: the page "
             "did not load, or its colours are not what this expects\n",
             size.ToString().c_str(), ToHex(domicile::spike::kPageBackground).c_str());
      Finish(false);
      return;
    }
    printf("window %s, page starts at y=%d\n", size.ToString().c_str(),
           viewport_top_);

    switch (check_) {
      case Check::kCss:
        ReportCss();
        return;
      case Check::kResize:
        ReportResize();
        return;
      case Check::kIframe:
        ReportIframe();
        return;
    }
  }

  void ReportCss() {
    // Nothing else in this run means anything if no surface reached the page,
    // and the diff alone cannot tell "both halves are the producer's colour"
    // from "both halves are missing". One absolute check fixes that.
    const gfx::Point baseline = AppCenter(0, viewport_top_);
    if (!capture_.Contains(gfx::Rect(baseline, gfx::Size(1, 1)))) {
      printf("the page is not where this expects it: %s is outside the "
             "window\n", baseline.ToString().c_str());
      Finish(false);
      return;
    }
    const SkColor at_baseline = capture_.At(baseline.x(), baseline.y());
    const bool app_present =
        ColorsMatch(at_baseline, producer_.color(), kPixelTolerance);
    printf("\n<app> centre of the baseline cell: %s, producer submitted %s "
           "— %s\n\n", ToHex(at_baseline).c_str(),
           ToHex(producer_.color()).c_str(),
           app_present ? "embedded" : "NOT EMBEDDED");

    printf("%-18s %8s %8s %10s %8s %9s  %s\n", "property", "pixels", "differ",
           "interior", "worst", "in effect", "verdict");
    const gfx::Rect baseline_cell = CellRect(0, viewport_top_);
    bool all_passed = app_present;
    size_t index = 0;
    for (const domicile::spike::Cell& spec : domicile::spike::kCells) {
      const gfx::Rect cell = CellRect(index, viewport_top_);
      ++index;
      // Through a std::string because -Wunsafe-buffer-usage will not take a
      // bare const char* for a %s: it cannot see that a string literal is
      // null-terminated once it has been through a struct field.
      const std::string name(spec.name);
      if (!capture_.Contains(cell) ||
          !capture_.Contains(gfx::Rect(
              cell.x() + domicile::spike::kCellHalfWidth, cell.y(),
              cell.width(), cell.height()))) {
        printf("%-18s %s\n", name.c_str(),
               "off the window: the page does not fit");
        all_passed = false;
        continue;
      }
      const RectDiff diff = DiffHalves(capture_, cell);
      const bool matched = diff.interior_mismatched == 0;

      // Whether this cell's <app> looks like the baseline cell's, which is what
      // it would look like if the property were not in effect at all. A cell
      // whose property never reached the page leaves both of its halves plain,
      // and two plain halves match — so without this the run would report
      // parity for a property it had not applied.
      const bool in_effect =
          DiffRects(capture_, cell, baseline_cell.origin(), kPixelTolerance,
                    kEdgeRadius)
              .mismatched > 0;
      const bool applied_as_expected = in_effect == spec.differs_from_baseline;

      const bool passed =
          matched == spec.halves_should_match && applied_as_expected;
      all_passed = all_passed && passed;

      std::string verdict;
      if (!applied_as_expected) {
        verdict = spec.differs_from_baseline
                      ? "FAIL (the property is not in effect)"
                      : "FAIL (something else changed this cell)";
      } else if (!spec.halves_should_match) {
        verdict = passed ? "pass (differs, as it must)"
                         : "FAIL (the diff cannot see a difference)";
      } else if (passed && diff.mismatched == 0) {
        verdict = "pass";
      } else if (passed) {
        verdict = "pass (edges only)";
      } else {
        verdict = "FAIL";
      }
      printf("%-18s %8d %8d %10d %8d %9s  %s\n", name.c_str(), diff.compared,
             diff.mismatched, diff.interior_mismatched, diff.worst_delta,
             in_effect ? "yes" : "no", verdict.c_str());
    }

    css_passed_ = all_passed;
    printf("\n");
    MeasureLatencyFloor();
  }

  // The floor: what a probe round trip costs when nothing has changed. Every
  // number below includes it, because the only way to see what the display
  // compositor drew is to ask it to draw and copy it back.
  void MeasureLatencyFloor() {
    latency_point_ = AppCenter(0, viewport_top_);
    floor_started_ = base::TimeTicks::Now();
    PollFloor();
  }

  void PollFloor() {
    floor_at_ = base::TimeTicks::Now();
    producer_.probe()->SamplePixel(
        latency_point_,
        base::BindOnce(&Measurement::OnFloorSampled, base::Unretained(this)));
  }

  void OnFloorSampled(bool sampled, uint32_t argb) {
    if (!sampled) {
      printf("latency: the probe stopped answering\n");
      Finish(false);
      return;
    }
    floor_.push_back(base::TimeTicks::Now() - floor_at_);
    if (static_cast<int>(floor_.size()) < kLatencyFloorSamples) {
      PollFloor();
      return;
    }
    StartLatency();
  }

  void StartLatency() {
    latency_iteration_ = 0;
    NextLatency();
  }

  void NextLatency() {
    if (latency_iteration_ >= kLatencySamples) {
      ReportLatency();
      return;
    }
    // A colour nothing else on the page is, and a different one each time so
    // that "it was already that colour" cannot be mistaken for "it arrived
    // instantly".
    const uint8_t step = static_cast<uint8_t>(20 + latency_iteration_ * 7);
    latency_target_ = SkColorSetARGB(0xFF, step, 0x40, 0xC0);
    latency_polls_ = 0;
    submitted_at_ = base::TimeTicks::Now();
    producer_.SetColor(latency_target_);
    PollLatency();
  }

  void PollLatency() {
    ++latency_polls_;
    producer_.probe()->SamplePixel(
        latency_point_,
        base::BindOnce(&Measurement::OnLatencySampled, base::Unretained(this)));
  }

  void OnLatencySampled(bool sampled, uint32_t argb) {
    if (sampled && ColorsMatch(argb, latency_target_, kPixelTolerance)) {
      latencies_.push_back(base::TimeTicks::Now() - submitted_at_);
      polls_.push_back(latency_polls_);
      ++latency_iteration_;
      NextLatency();
      return;
    }
    if (latency_polls_ >= kMaxLatencyPolls) {
      printf("latency: %s never appeared after %d draws\n",
             ToHex(latency_target_).c_str(), latency_polls_);
      Finish(false);
      return;
    }
    PollLatency();
  }

  void ReportLatency() {
    std::sort(floor_.begin(), floor_.end());
    std::sort(latencies_.begin(), latencies_.end());
    std::sort(polls_.begin(), polls_.end());

    // Both spreads, not one median each. The two overlap, and that overlap is
    // the finding: what a submitted colour costs to reach the display
    // compositor's output is not separable from what asking the question costs,
    // which is a forced full-window software composite and a readback.
    printf("latency over %d samples, producer submit to the colour appearing "
           "in the display compositor's own output:\n", kLatencySamples);
    const base::TimeDelta interval = producer_.frame_interval();
    printf("  %-34s %.2f ms\n", "display frame interval, per viz",
           interval.InMillisecondsF());
    printf("  %-34s %s%s\n", "probe round trip, nothing changed",
           Spread(floor_).c_str(), InIntervals(floor_, interval).c_str());
    printf("  %-34s %s%s\n", "submit to drawn", Spread(latencies_).c_str(),
           InIntervals(latencies_, interval).c_str());
    printf("  %-34s %d (min %d, max %d)\n", "draws the colour took to appear",
           polls_[polls_.size() / 2], polls_.front(), polls_.back());
    printf("\n");
    Finish(css_passed_);
  }

  // The part of ENGINE-FORK.md's CSS claim that was argued rather than
  // measured: whether an <app> differs from a <div> the way a surface-backed
  // element must. Three pairs — the requirement, a reference point, and the
  // control that keeps the comparison honest.
  void ReportIframe() {
    printf("\n%-16s %8s %8s %10s %8s  %s\n", "pair", "pixels", "differ",
           "interior", "worst", "verdict");
    bool all_passed = true;
    size_t index = 0;
    for (const domicile::spike::IframeCell& spec :
         domicile::spike::kIframeCells) {
      const gfx::Rect cell = CellRect(index, viewport_top_);
      ++index;
      const std::string name(spec.name);
      if (!capture_.Contains(cell) ||
          !capture_.Contains(gfx::Rect(
              cell.x() + domicile::spike::kCellHalfWidth, cell.y(),
              cell.width(), cell.height()))) {
        printf("%-16s %s\n", name.c_str(),
               "off the window: the page does not fit");
        all_passed = false;
        continue;
      }

      const RectDiff diff = DiffHalves(capture_, cell);
      const bool identical = diff.mismatched == 0;
      const std::string verdict = Verdict(spec, identical, diff);
      all_passed = all_passed && Passed(spec, identical);
      printf("%-16s %8d %8d %10d %8d  %s\n", name.c_str(), diff.compared,
             diff.mismatched, diff.interior_mismatched, diff.worst_delta,
             verdict.c_str());
    }
    printf("\n");
    Finish(all_passed);
  }

  static bool Passed(const domicile::spike::IframeCell& spec, bool identical) {
    switch (spec.expect) {
      case domicile::spike::IframeCell::Expect::kIdentical:
        return identical;
      case domicile::spike::IframeCell::Expect::kDiffers:
        return !identical;
      case domicile::spike::IframeCell::Expect::kInformational:
        return true;
    }
  }

  // Descriptive rather than diagnostic where it has to be: a pair that differs
  // could be a different edge treatment or a different raster scale, and the
  // pixels cannot tell those apart. What the harness can tell — whether the
  // iframe got a renderer of its own — it reports separately.
  static std::string Verdict(const domicile::spike::IframeCell& spec,
                             bool identical,
                             const RectDiff& diff) {
    const bool edges_only = !identical && diff.interior_mismatched == 0;
    switch (spec.expect) {
      case domicile::spike::IframeCell::Expect::kIdentical:
        return identical ? "pass — every pixel, so CSS cannot tell them apart"
                         : (edges_only ? "FAIL — differs on its edges"
                                       : "FAIL — differs beyond its edges");
      case domicile::spike::IframeCell::Expect::kDiffers:
        return identical
                   ? "FAIL — identical; check the renderer count below"
                   : (edges_only ? "differs on edges, as Chromium's own "
                                   "surface embedder does"
                                 : "differs beyond its edges");
      case domicile::spike::IframeCell::Expect::kInformational:
        return identical ? "identical" : "differs on edges (not a requirement)";
    }
  }

  void ReportResize() {
    printf("\n");
    bool passed = true;
    if (embedded_sizes_.size() < 2) {
      printf("the page never reconfigured: one embed, at %s\n",
             embedded_sizes_.empty()
                 ? "nothing"
                 : embedded_sizes_.front().ToString().c_str());
      Finish(false);
      return;
    }
    const gfx::Size first = embedded_sizes_.front();
    const gfx::Size last = embedded_sizes_.back();
    printf("configured at %s, then reconfigured to %s\n",
           first.ToString().c_str(), last.ToString().c_str());
    if (first != resize_from_ || last != resize_to_) {
      printf("expected %s then %s: the page and this disagree about its own "
             "boxes\n", resize_from_.ToString().c_str(),
             resize_to_.ToString().c_str());
      passed = false;
    }
    if (producer_.size() != resize_to_) {
      printf("the producer is rendering at %s, not %s\n",
             producer_.size().ToString().c_str(),
             resize_to_.ToString().c_str());
      passed = false;
    }

    const gfx::Rect cell = CellRect(0, viewport_top_);
    if (!capture_.Contains(cell)) {
      printf("the page is not where this expects it\n");
      Finish(false);
      return;
    }
    const RectDiff diff = DiffHalves(capture_, cell);
    const bool matched = diff.interior_mismatched == 0;
    printf("%-18s %8s %8s %10s %8s  %s\n", "property", "pixels", "differ",
           "interior", "worst", "verdict");
    printf("%-18s %8d %8d %10d %8d  %s\n", "resize", diff.compared,
           diff.mismatched, diff.interior_mismatched, diff.worst_delta,
           matched ? (diff.mismatched == 0 ? "pass" : "pass (edges only)")
                   : "FAIL");
    printf("\n");
    Finish(passed && matched);
  }

  void OnLost(const std::string& why) {
    LOG(ERROR) << why;
    Finish(false);
  }

  void Finish(bool ok) {
    if (done_) {
      std::move(done_).Run(ok);
    }
  }

  const Check check_;
  const gfx::Size resize_from_;
  const gfx::Size resize_to_;
  base::OnceCallback<void(bool)> done_;
  domicile::spike::SurfaceProducer producer_;

  int embeds_ = 0;
  std::vector<gfx::Size> embedded_sizes_;
  bool settling_ = false;
  int capture_tries_ = 0;
  WindowCapture capture_;
  int viewport_top_ = -1;
  bool css_passed_ = false;

  gfx::Point latency_point_;
  base::TimeTicks floor_started_;
  base::TimeTicks floor_at_;
  std::vector<base::TimeDelta> floor_;
  int latency_iteration_ = 0;
  int latency_polls_ = 0;
  SkColor latency_target_ = SK_ColorBLACK;
  base::TimeTicks submitted_at_;
  std::vector<base::TimeDelta> latencies_;
  std::vector<int> polls_;
};

}  // namespace

int main(int argc, char** argv) {
  base::AtExitManager exit_manager;
  base::CommandLine::Init(argc, argv);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();

  const std::string socket = command_line.GetSwitchValueASCII(kSocketSwitch);
  if (socket.empty()) {
    LOG(ERROR) << "usage: domicile_css_parity --" << kSocketSwitch
               << "=<path> [--color=AARRGGBB] [--check=css|resize] "
               << "[--resize-from=WxH --resize-to=WxH]";
    return 2;
  }

  const std::string requested = command_line.GetSwitchValueASCII(kCheckSwitch);
  const bool resize_check = requested == "resize";
  if (!requested.empty() && requested != "css" && !resize_check &&
      requested != "iframe") {
    LOG(ERROR) << "--" << kCheckSwitch << " is css, resize or iframe";
    return 2;
  }
  const Check check = resize_check          ? Check::kResize
                      : requested == "iframe" ? Check::kIframe
                                              : Check::kCss;

  gfx::Size resize_from;
  gfx::Size resize_to;
  if (resize_check) {
    const std::optional<gfx::Size> from =
        ParseSize(command_line, kResizeFromSwitch);
    const std::optional<gfx::Size> to = ParseSize(command_line, kResizeToSwitch);
    if (!from || !to) {
      LOG(ERROR) << "--check=resize needs --" << kResizeFromSwitch << "=WxH and "
                 << "--" << kResizeToSwitch << "=WxH, which is how it knows "
                 << "what the page is going to do";
      return 2;
    }
    resize_from = *from;
    resize_to = *to;
  }

  base::SingleThreadTaskExecutor main_task_executor;
  base::ThreadPoolInstance::CreateAndStartWithDefaultParams("css_parity");

  mojo::core::Init();
  base::Thread ipc_thread("mojo");
  ipc_thread.StartWithOptions(
      base::Thread::Options(base::MessagePumpType::IO, 0));
  mojo::core::ScopedIPCSupport ipc_support(
      ipc_thread.task_runner(),
      mojo::core::ScopedIPCSupport::ShutdownPolicy::CLEAN);

  base::RunLoop run_loop;
  bool ok = false;
  Measurement measurement(
      domicile::spike::ParseColor(command_line, kColorSwitch, kDefaultColor),
      check, resize_from, resize_to,
      base::BindOnce(
          [](bool* ok, base::OnceClosure quit, bool result) {
            *ok = result;
            std::move(quit).Run();
          },
          &ok, run_loop.QuitClosure()));

  if (!measurement.Connect(
          mojo::NamedPlatformChannel::ServerNameFromUTF8(socket))) {
    return 1;
  }
  measurement.Start();
  run_loop.Run();

  return ok ? 0 : 1;
}
