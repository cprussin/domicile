// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Throwaway smoke test: a dmabuf allocated outside Chromium reaches the screen
// through a page.
//
// Stands in for domicile-compositor with one client. Allocates a buffer on the
// render node, fills it with a unique color, submits it through
// libdomicile_engine.so, and samples what viz drew at the <app>. Exits 0 only
// if the pixel matches and the buffer was released.
//
// C++ only to use //ui/gfx/linux:gbm for allocation; it still calls the C ABI.
//
// Run it with packages/domicile-engine/scripts/spike-dmabuf.sh. It cannot pass
// under --ozone-platform=headless, which lacks CreateNativePixmapFromHandle.

#include <fcntl.h>
#include <poll.h>
#include <unistd.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <array>
#include <memory>
#include <string>
#include <vector>

#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/strings/string_number_conversions.h"
#include "base/files/scoped_file.h"
#include "base/posix/eintr_wrapper.h"
#include "base/time/time.h"
#include "components/domicile/engine/domicile_engine.h"
#include "components/domicile/engine/domicile_engine_spike.h"
#include "third_party/skia/include/core/SkCanvas.h"
#include "third_party/skia/include/core/SkColor.h"
#include "third_party/skia/include/core/SkSurface.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/linux/gbm_buffer.h"
#include "ui/gfx/linux/gbm_device.h"
#include "ui/gfx/linux/gbm_wrapper.h"
#include "ui/gfx/linux/drm_util_linux.h"

namespace {

constexpr char kSocketSwitch[] = "domicile-broker-socket";
constexpr char kRenderNodeSwitch[] = "render-node";
constexpr char kColorSwitch[] = "color";
// Diagnostic: allocate an unfilled GPU-renderable buffer instead of a
// CPU-writable one. NVIDIA's gbm offers only one of the two, so this separates
// a broken import path from a driver that cannot sample linear dmabufs.
constexpr char kRenderableSwitch[] = "renderable";

// DRM_FORMAT_ABGR8888, defined here to avoid including libdrm's headers.
constexpr uint32_t kFormatAbgr8888 = 0x34324241;

// GBM_BO_USE_*, defined here for the same reason.
constexpr uint32_t kUseScanout = 1 << 0;
constexpr uint32_t kUseRendering = 1 << 2;
constexpr uint32_t kUseWrite = 1 << 3;
constexpr uint32_t kUseLinear = 1 << 4;

// Tried in order. Scanout allows overlay promotion, but a render node may
// refuse it. Linear is required so the CPU can fill the buffer.
struct Usage {
  const char* name;
  uint32_t flags;
};
constexpr Usage kUsages[] = {
    {"scanout|rendering|linear",
     kUseScanout | kUseRendering | kUseLinear | kUseWrite},
    {"rendering|linear", kUseRendering | kUseLinear | kUseWrite},
    {"linear", kUseLinear | kUseWrite},
};

// A color nothing else in the run draws, so a match proves it came from this
// dmabuf.
constexpr uint32_t kDefaultColor = 0xFF3366CC;

constexpr base::TimeDelta kEmbedTimeout = base::Seconds(60);
constexpr base::TimeDelta kReleaseTimeout = base::Seconds(20);
constexpr int kSampleTries = 60;

struct Seen {
  int configures = 0;
  int releases = 0;
  uint32_t width = 0;
  uint32_t height = 0;
  DomicileBufferId released_buffer = 0;
};

void OnConfigure(void* user_data,
                 DomicileSurfaceId surface,
                 uint32_t width,
                 uint32_t height) {
  Seen* seen = static_cast<Seen*>(user_data);
  seen->configures++;
  seen->width = width;
  seen->height = height;
  printf("configure: surface %u at %ux%u\n", surface, width, height);
}

void OnReleased(void* user_data,
                DomicileSurfaceId surface,
                uint64_t buffer) {
  Seen* seen = static_cast<Seen*>(user_data);
  seen->releases++;
  seen->released_buffer = buffer;
  printf("released: surface %u buffer %llu — wl_buffer.release, and the "
         "compositor may draw into it again\n",
         surface, static_cast<unsigned long long>(buffer));
}

// Fills a linear buffer with one color through gbm's SkSurface.
bool Paint(ui::GbmBuffer* buffer, uint32_t argb) {
  sk_sp<SkSurface> surface = buffer->GetSurface();
  if (!surface) {
    fprintf(stderr, "the buffer could not be mapped for the CPU to fill\n");
    return false;
  }
  surface->getCanvas()->clear(SkColor4f::FromColor(argb));
  return true;
}

// The dmabuf as the C ABI takes it, matching zwp_linux_buffer_params_v1.
DomicileDmabuf Describe(ui::GbmBuffer* buffer) {
  DomicileDmabuf dmabuf;
  memset(&dmabuf, 0, sizeof(dmabuf));
  dmabuf.width = static_cast<uint32_t>(buffer->GetSize().width());
  dmabuf.height = static_cast<uint32_t>(buffer->GetSize().height());
  dmabuf.fourcc = buffer->GetFormat();
  dmabuf.modifier = buffer->GetFormatModifier();
  const auto planes = base::span(dmabuf.planes);
  dmabuf.plane_count = static_cast<uint32_t>(
      std::min<size_t>(buffer->GetNumPlanes(), planes.size()));
  for (uint32_t i = 0; i < dmabuf.plane_count; ++i) {
    planes[i].fd = buffer->GetPlaneFd(i);
    planes[i].offset = static_cast<uint32_t>(buffer->GetPlaneOffset(i));
    planes[i].stride = buffer->GetPlaneStride(i);
  }
  return dmabuf;
}

// Allocates with the first usage the driver accepts. On NVIDIA only
// GPU-renderable buffers are sampleable after import; see spike-dmabuf.sh.
std::unique_ptr<ui::GbmBuffer> Allocate(ui::GbmDevice* device,
                                        const gfx::Size& size,
                                        bool renderable,
                                        std::string* usage_name) {
  if (renderable) {
    std::unique_ptr<ui::GbmBuffer> buffer =
        device->CreateBuffer(kFormatAbgr8888, size, kUseRendering);
    if (buffer && buffer->AreFdsValid()) {
      *usage_name = "rendering";
      return buffer;
    }
  }
  for (const Usage& usage : base::span(kUsages)) {
    std::unique_ptr<ui::GbmBuffer> buffer =
        device->CreateBuffer(kFormatAbgr8888, size, usage.flags);
    if (buffer && buffer->AreFdsValid()) {
      *usage_name = usage.name;
      return buffer;
    }
  }
  return nullptr;
}

// Runs the loop the compositor would, until `predicate` holds or time runs out.
template <typename Predicate>
bool PumpUntil(DomicileEngine* engine,
               base::TimeDelta timeout,
               Predicate predicate) {
  const base::TimeTicks deadline = base::TimeTicks::Now() + timeout;
  while (!predicate() && base::TimeTicks::Now() < deadline) {
    pollfd descriptor = {.fd = domicile_engine_fd(engine),
                         .events = POLLIN,
                         .revents = 0};
    if (poll(&descriptor, 1, 100) > 0) {
      domicile_engine_dispatch(engine);
    }
  }
  return predicate();
}

}  // namespace

int main(int argc, char** argv) {
  base::CommandLine::Init(argc, argv);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();

  const std::string socket = command_line.GetSwitchValueASCII(kSocketSwitch);
  if (socket.empty()) {
    fprintf(stderr, "%s",
            "usage: domicile_engine_dmabuf_smoke "
            "--domicile-broker-socket=<path> "
            "[--render-node=/dev/dri/renderD128] [--color=AARRGGBB]\n");
    return 2;
  }
  const std::string node =
      command_line.HasSwitch(kRenderNodeSwitch)
          ? command_line.GetSwitchValueASCII(kRenderNodeSwitch)
          : std::string("/dev/dri/renderD128");
  uint32_t color = kDefaultColor;
  if (command_line.HasSwitch(kColorSwitch)) {
    uint32_t parsed = 0;
    if (base::HexStringToUInt(command_line.GetSwitchValueASCII(kColorSwitch),
                              &parsed)) {
      color = parsed;
    }
  }

  base::ScopedFD render_node(HANDLE_EINTR(open(node.c_str(), O_RDWR)));
  if (!render_node.is_valid()) {
    fprintf(stderr, "no render node at %s\n", node.c_str());
    return 1;
  }
  std::unique_ptr<ui::GbmDevice> device =
      ui::CreateGbmDevice(render_node.get());
  if (!device) {
    fprintf(stderr, "gbm would not open %s\n", node.c_str());
    return 1;
  }
  printf("allocating on %s\n", node.c_str());

  Seen seen;
  DomicileEngineCallbacks callbacks;
  memset(&callbacks, 0, sizeof(callbacks));
  callbacks.user_data = &seen;
  callbacks.configure = OnConfigure;
  callbacks.released = OnReleased;

  DomicileEngine* engine =
      domicile_engine_connect(socket.c_str(), callbacks);
  if (!engine) {
    fprintf(stderr, "could not join the browser's mojo graph at %s\n",
            socket.c_str());
    return 1;
  }
  printf("joined the browser's mojo graph\n");

  const DomicileSurfaceId surface =
      domicile_surface_create(engine, "domicile-dmabuf-smoke");
  if (surface == 0) {
    fprintf(stderr, "the browser brokered no frame sink\n");
    domicile_engine_destroy(engine);
    return 1;
  }
  printf("brokered a frame sink for surface %u\n", surface);
  printf("waiting for a page to embed it...\n");

  if (!PumpUntil(engine, kEmbedTimeout,
                 [&seen] { return seen.configures > 0; })) {
    fprintf(stderr, "no page embedded the surface\n");
    domicile_engine_destroy(engine);
    return 1;
  }

  const gfx::Size window(static_cast<int>(seen.width),
                         static_cast<int>(seen.height));
  const bool renderable = command_line.HasSwitch(kRenderableSwitch);

  // Two buffers: viz releases the on-screen buffer only when a later frame
  // replaces it.
  std::unique_ptr<ui::GbmBuffer> buffers[2];
  std::string usage_name;
  for (auto& slot : base::span(buffers)) {
    slot = Allocate(device.get(), window, renderable, &usage_name);
    if (!slot) {
      fprintf(stderr, "gbm would not allocate a %ux%u buffer at all\n",
              seen.width, seen.height);
      domicile_engine_destroy(engine);
      return 1;
    }
    if (!renderable && !Paint(slot.get(), color)) {
      domicile_engine_destroy(engine);
      return 1;
    }
  }
  printf("allocated two %ux%u dmabufs as %s, %zu plane(s), modifier 0x%llx%s\n",
         seen.width, seen.height, usage_name.c_str(),
         buffers[0]->GetNumPlanes(),
         static_cast<unsigned long long>(buffers[0]->GetFormatModifier()),
         renderable ? ", unfilled" : "");

  std::array<DomicileBufferId, 2> imported = {0, 0};
  const auto slots = base::span(buffers);
  for (size_t i = 0; i < imported.size(); ++i) {
    const DomicileDmabuf described = Describe(slots[i].get());
    imported[i] = domicile_surface_import(engine, surface, &described);
    if (imported[i] == 0) {
      fprintf(stderr,
              "the browser could not import the dmabuf. On an ozone platform "
              "without CreateNativePixmapFromHandle — headless is one — it "
              "cannot: run this under scripts/under-wayland.sh\n");
      domicile_engine_destroy(engine);
      return 1;
    }
  }
  printf("imported: buffers %llu and %llu\n",
         static_cast<unsigned long long>(imported[0]),
         static_cast<unsigned long long>(imported[1]));

  domicile_surface_submit(engine, surface, imported[0], 0, 0, 0, 0);
  printf("submitted the first\n");

  // The spike page places the <app> over the window's center.
  uint32_t drawn = 0;
  bool matched = false;
  for (int i = 0; i < kSampleTries && !matched; ++i) {
    domicile_engine_dispatch(engine);
    uint32_t sampled = 0;
    if (domicile_engine_spike_sample_window_center(engine, &sampled)) {
      drawn = sampled;
      matched = sampled == color;
    }
  }

  // Submitting the second buffer releases the first.
  domicile_surface_submit(engine, surface, imported[1], 0, 0, 0, 0);
  printf("submitted the second, which is what frees the first\n");

  const bool released = PumpUntil(engine, kReleaseTimeout, [&seen, &imported] {
    return seen.released_buffer == imported[0];
  });

  printf("\n");
  if (renderable) {
    // The buffer is unfilled, so any color but the fallback means the
    // texture was sampled.
    matched = drawn != 0xFF000000u;
    printf("drew #%08X from an unfilled renderable dmabuf — %s\n", drawn,
           matched ? "sampled, so the texture path works"
                   : "the fallback, so it was not sampled at all");
  } else {
    printf("drew #%08X, the dmabuf holds #%08X — %s\n", drawn, color,
           matched ? "the client's own buffer reached the screen"
                   : "NOT the client's buffer");
  }
  printf("released fired %d time(s), last for buffer %llu%s\n", seen.releases,
         static_cast<unsigned long long>(seen.released_buffer),
         released ? " — wl_buffer.release, for the buffer the second frame "
                    "replaced"
                  : " — viz never handed the first buffer back");

  domicile_buffer_destroy(engine, surface, imported[0]);
  domicile_buffer_destroy(engine, surface, imported[1]);
  domicile_surface_destroy(engine, surface);
  domicile_engine_destroy(engine);

  return (matched && released) ? 0 : 1;
}
