// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_
#define COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_

#include <stddef.h>
#include <stdint.h>

// libdomicile_engine.so: the C ABI between domicile-compositor and the
// browser.
//
// The library owns the mojo side; domicile-compositor owns Wayland. See
// docs/architecture/ENGINE-FORK.md#the-c-abi in the Domicile repository.
//
// Mojo runs on the library's own thread. The compositor polls an fd and calls
// dispatch, like wl_display_get_fd and wl_display_dispatch:
//
//   int  domicile_engine_fd(engine);        // add to calloop
//   void domicile_engine_dispatch(engine);  // run pending work, fire callbacks
//
// Callbacks fire only from inside dispatch, on the caller's thread.
//
// The browser imports dmabufs and returns opaque BufferIds, so the compositor
// never handles mailboxes or GPU channels. See
// docs/architecture/ENGINE-FORK.md#buffer-import.

// Chromium builds with -fvisibility=hidden.
#define DOMICILE_ENGINE_EXPORT __attribute__((visibility("default")))

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DomicileEngine DomicileEngine;

// Which of the desktop's two clipboards. A fixed-width integer rather than an
// `enum` so both sides agree on its size.
typedef uint32_t DomicileClipboard;

// Ctrl-C and Ctrl-V (wl_data_device).
#define DOMICILE_CLIPBOARD_COPY 0u
// Select and middle-click paste (zwp_primary_selection_device_v1).
#define DOMICILE_CLIPBOARD_PRIMARY 1u

// One type a clipboard's contents can be pasted as. Borrowed for the call it
// crosses in.
//
// Text crosses once, under any text type; the browser offers it under every
// text type a reader asks for. An image crosses under its own type, such as
// "image/png".
typedef struct DomicileClipboardItem {
  // A nul-terminated MIME type. Never null.
  const char* mime_type;
  // `length` bytes. Null only when `length` is zero.
  const uint8_t* data;
  size_t length;
} DomicileClipboardItem;

// A monitor's rotation: the turn content takes to appear upright. Values follow
// `wl_output.transform` order.
typedef uint32_t DomicileDisplayTransform;

#define DOMICILE_DISPLAY_TRANSFORM_NORMAL 0u
#define DOMICILE_DISPLAY_TRANSFORM_ROTATE_90 1u
#define DOMICILE_DISPLAY_TRANSFORM_ROTATE_180 2u
#define DOMICILE_DISPLAY_TRANSFORM_ROTATE_270 3u

// A client's wl_surface.set_buffer_transform: the turn and flip it drew its
// buffer with. Values follow `wl_output.transform` order.
typedef uint32_t DomicileBufferTransform;

#define DOMICILE_BUFFER_TRANSFORM_NORMAL 0u
#define DOMICILE_BUFFER_TRANSFORM_ROTATE_90 1u
#define DOMICILE_BUFFER_TRANSFORM_ROTATE_180 2u
#define DOMICILE_BUFFER_TRANSFORM_ROTATE_270 3u
#define DOMICILE_BUFFER_TRANSFORM_FLIPPED 4u
#define DOMICILE_BUFFER_TRANSFORM_FLIPPED_90 5u
#define DOMICILE_BUFFER_TRANSFORM_FLIPPED_180 6u
#define DOMICILE_BUFFER_TRANSFORM_FLIPPED_270 7u

// A surface id. Zero is never valid and is domicile_surface_create's failure
// return.
typedef uint32_t DomicileSurfaceId;

// An imported buffer id. Zero is never valid and is domicile_surface_import's
// failure return.
typedef uint64_t DomicileBufferId;

// One plane of a dmabuf, as zwp_linux_buffer_params_v1.add sends it.
typedef struct DomicileDmabufPlane {
  int fd;
  uint32_t offset;
  uint32_t stride;
} DomicileDmabufPlane;

// A client's dmabuf.
//
// The fds are borrowed for the call: the library duplicates what it sends and
// the caller keeps the originals.
typedef struct DomicileDmabuf {
  uint32_t width;
  uint32_t height;
  // DRM_FORMAT_*, as the client sent it.
  uint32_t fourcc;
  uint64_t modifier;
  uint32_t plane_count;
  DomicileDmabufPlane planes[4];
} DomicileDmabuf;

// A window's frame in shared memory, one plane at offset 0.
//
// The fd is borrowed for the call: the library duplicates what it sends and the
// caller keeps the original. It must be open for reading and writing, as
// memfd_create makes it.
typedef struct DomicileShmBuffer {
  int fd;
  uint32_t width;
  uint32_t height;
  // Bytes from one row to the next; at least 4 * width.
  uint32_t stride;
  // DRM_FORMAT_ARGB8888, XRGB8888, ABGR8888 or XBGR8888.
  uint32_t fourcc;
} DomicileShmBuffer;

// A capture id, of a display or a browser window. Zero is never valid and is
// the failure return of domicile_display_capture_start and
// domicile_browser_window_capture_start.
typedef uint32_t DomicileCaptureId;

// Where a captured frame's pixels are.
typedef uint32_t DomicileCaptureMemory;

// A dmabuf: the browser composites on the GPU.
#define DOMICILE_CAPTURE_DMABUF 0u
// Shared memory, one plane at offset 0: the browser composites in software.
#define DOMICILE_CAPTURE_SHM 1u

// One frame of a display capture, as viz composited it.
//
// The fds are lent for the callback: duplicate what you keep. The buffer
// stays the frame's until domicile_captured_frame_release, so a duplicated fd
// may be read until then.
typedef struct DomicileCapturedFrame {
  DomicileCaptureMemory memory;
  uint32_t width;
  uint32_t height;
  // DRM_FORMAT_ARGB8888 or DRM_FORMAT_ABGR8888, as viz picked.
  uint32_t fourcc;
  // Zero for shared memory.
  uint64_t modifier;
  uint32_t plane_count;
  DomicileDmabufPlane planes[4];
  // The part of the frame that holds the display. Viz letterboxes the rest
  // when the display's aspect differs from the size asked for.
  int32_t content_x;
  int32_t content_y;
  int32_t content_width;
  int32_t content_height;
  // What changed since the capture's previous frame. Empty means all of it.
  int32_t damage_x;
  int32_t damage_y;
  int32_t damage_width;
  int32_t damage_height;
} DomicileCapturedFrame;

// One display the browser scans out to.
//
// The engine holds DRM master, so on a tty this is the compositor's only source
// of displays. Nested sessions never send these.
//
// `x`, `y`, `width` and `height` place the display on the browser's desktop, in
// pixels. `physical_width_mm`, `physical_height_mm` and `refresh_mhz` use
// wl_output's units; any may be zero when the display does not report it.
typedef struct DomicileDisplay {
  // Derived from the EDID, so stable across a hotplug. The compositor names
  // its wl_output after it, so a replugged monitor keeps its clients.
  int64_t id;
  // "<MAKE> <MODEL> <SERIAL>" from the EDID, or "" (never null) if it has
  // none. A human-readable name for config matching, like kanshi and sway use;
  // `id` is the identity.
  //
  // Borrowed for the call; copy it to keep it.
  const char* name;
  int32_t x;
  int32_t y;
  int32_t width;
  int32_t height;
  int32_t physical_width_mm;
  int32_t physical_height_mm;
  int32_t refresh_mhz;
} DomicileDisplay;

// A display and the connector it is on, for `connected_displays`.
typedef struct DomicileConnectedDisplay {
  DomicileDisplay display;
  // The kernel's name for the connector, as sway uses it: "DP-1", "HDMI-A-1",
  // "eDP-1". Never null.
  //
  // The compositor names a monitor whose `name` is "" after it. Borrowed for
  // the call; copy it to keep it.
  const char* connector;
} DomicileConnectedDisplay;

// How the compositor wants one display's connector driven.
//
// The reverse of DomicileDisplay: the compositor's config decides, but the
// browser holds DRM master and applies it.
typedef struct DomicileDisplayLayout {
  // DomicileDisplay::id, as the browser sent it.
  int64_t id;
  // Nonzero to light this connector; zero leaves it dark (a profile's
  // `enabled: false`, such as a closed laptop lid).
  int32_t enabled;
  // Position on the browser's desktop, in physical pixels. Zero and ignored
  // when `enabled` is zero.
  int32_t x;
  int32_t y;
  // Rotation and scale. The browser applies both to the window on this
  // connector, so the page always lays out upright in logical pixels. Read
  // even when dark, because the window outlives that state.
  DomicileDisplayTransform transform;
  double scale;
  // Position on the compositor's logical desktop, used to move the pointer
  // between monitors. Zero when `enabled` is zero.
  int32_t desk_x;
  int32_t desk_y;
  int32_t desk_width;
  int32_t desk_height;
} DomicileDisplayLayout;

// A tablet or touchscreen and the display it covers, for
// `domicile_pointers_configure`.
typedef struct DomicilePointerTarget {
  // The evdev device's name or `phys`, matched exactly. Borrowed for the call.
  const char* device;
  // DomicileDisplay::id, as the browser sent it.
  int64_t display_id;
} DomicilePointerTarget;

// A monitor with no connector, for `domicile_virtual_displays_configure`. The
// desk extends onto it, and only a capture shows it.
typedef struct DomicileVirtualDisplay {
  // Its display id, picked by the compositor. Must not collide with a
  // connector's EDID-derived id; the compositor sets the top bit.
  int64_t id;
  // Its mode, in physical pixels.
  int32_t width;
  int32_t height;
  // Its refresh rate in mHz.
  int32_t refresh_mhz;
  // Its name, such as the TV it is cast to. Borrowed for the call.
  const char* name;
} DomicileVirtualDisplay;

// How a frame reached the screen, for `presented`. The values are
// wp_presentation_feedback.kind's.
typedef uint32_t DomicilePresentedFlags;

#define DOMICILE_PRESENTED_VSYNC 0x1u
#define DOMICILE_PRESENTED_HW_CLOCK 0x2u
#define DOMICILE_PRESENTED_HW_COMPLETION 0x4u
#define DOMICILE_PRESENTED_ZERO_COPY 0x8u
// Never shown: a newer frame replaced it first, or its surface was not drawn.
// No other flag is set with it.
#define DOMICILE_PRESENTED_DISCARDED 0x80000000u

// Events from the browser, each mapped to a Wayland request:
//
//   configure  xdg_toplevel.configure — the page's layout box changed
//   released   wl_buffer.release      — viz is done sampling a buffer, so the
//                                       client may draw into it again
//   frame_done wl_surface.frame       — viz took a frame and will take the next
//   presented  wp_presentation_feedback — a frame reached the screen, or never
//                                       will
//   displays   wl_output              — the whole display list, primary first
//   copied     wl_data_device.set_selection — something was copied in a page
//   captured   a frame of a display capture, for a screen cast
//   imported   zwp_linux_buffer_params.created — a dmabuf was imported
//
// All fire from domicile_engine_dispatch, on the calling thread. `user_data`
// is passed back untouched. A null function pointer drops that event.
//
// Only append fields, so a newer compositor works with an older engine: the
// library reads the prefix it knows. A newer engine with an older compositor is
// unsupported; `engine-release.nix` pins the pair and
// `scripts/test-the-pinned-engine-meets-the-compositor.sh` checks it.
//
// `displays` points at `count` records borrowed for the call; copy any you
// keep. `count` is never zero.
typedef struct DomicileEngineCallbacks {
  void* user_data;
  void (*configure)(void* user_data,
                    DomicileSurfaceId surface,
                    uint32_t width,
                    uint32_t height);
  void (*released)(void* user_data, DomicileSurfaceId surface, uint64_t buffer);
  void (*displays)(void* user_data,
                   const DomicileDisplay* displays,
                   uint32_t count);
  // A copy in a page or browser window. The browser is not a Wayland client,
  // so this is how its copies reach a seat.
  //
  // `text` is `length` bytes borrowed for the call; empty when the copy was
  // not text. Length-delimited because copied bytes may contain a NUL.
  //
  // Not called when `copied_items` is set.
  void (*copied)(void* user_data,
                 DomicileClipboard clipboard,
                 const char* text,
                 size_t length);
  // Like `configure`, plus the page's device pixels per CSS pixel. Each
  // monitor is its own page at its own scale, so the compositor needs the
  // scale of the page this box is in.
  //
  // Called instead of `configure` when set. An older engine ignores it and
  // keeps calling `configure`.
  void (*configure_at)(void* user_data,
                       DomicileSurfaceId surface,
                       uint32_t width,
                       uint32_t height,
                       double scale);
  // A frame of `capture`. `record` is borrowed for the call. Release `frame`
  // with domicile_captured_frame_release once read: viz keeps a few buffers,
  // so a capture whose frames are all held stops.
  void (*captured)(void* user_data,
                   DomicileCaptureId capture,
                   uint64_t frame,
                   const DomicileCapturedFrame* record);
  // The browser ended `capture`, and no frame follows. Not called after
  // domicile_display_capture_stop.
  void (*capture_ended)(void* user_data, DomicileCaptureId capture);
  // Like `configure_at`, plus the box's number. Pass it to
  // domicile_surface_submit_for_box with the frame the client draws for this
  // configure. Numbers start at 1 and grow per surface.
  //
  // Called instead of `configure_at` when set.
  void (*configure_box)(void* user_data,
                        DomicileSurfaceId surface,
                        uint32_t width,
                        uint32_t height,
                        double scale,
                        uint64_t box);
  // Like `copied`, with every type the copy can be pasted as: its text and
  // its image. `items` points at `count` records borrowed for the call; zero
  // when the copy was neither.
  //
  // Called instead of `copied` when set.
  void (*copied_items)(void* user_data,
                       DomicileClipboard clipboard,
                       const DomicileClipboardItem* items,
                       uint32_t count);
  // Viz acked `frame` of `surface`: it drew or dropped it, and takes the next.
  //
  // `frame` counts the surface's submits, from 1, including any the engine
  // could not send to viz. Each submit gets one call, in order.
  void (*frame_done)(void* user_data,
                     DomicileSurfaceId surface,
                     uint64_t frame);
  // `frame` of `surface`, numbered as in `frame_done`, reached the screen at
  // `time_ns` on CLOCK_MONOTONIC. `refresh_ns` is the display's frame interval,
  // zero if unknown. With DOMICILE_PRESENTED_DISCARDED, both are zero.
  //
  // Viz reports a frame on its next BeginFrame, so this follows the frame's
  // `frame_done`. A frame that never reached viz is reported discarded at
  // once.
  void (*presented)(void* user_data,
                    DomicileSurfaceId surface,
                    uint64_t frame,
                    int64_t time_ns,
                    int64_t refresh_ns,
                    DomicilePresentedFlags flags);
  // The answer to domicile_surface_import_async with this `request`: the
  // buffer's id, or zero if the browser refused it.
  void (*imported)(void* user_data,
                   DomicileSurfaceId surface,
                   uint64_t request,
                   DomicileBufferId buffer);
  // Like `displays`, plus each display's connector. `displays` points at
  // `count` records borrowed for the call.
  //
  // Called instead of `displays` when set. An older engine ignores it and
  // keeps calling `displays`.
  void (*connected_displays)(void* user_data,
                             const DomicileConnectedDisplay* displays,
                             uint32_t count);
  // The browser went away: it exited, or closed the broker. No callback
  // follows; the compositor joins the next browser to say hello. An older
  // engine never calls it, so a compositor also compares the pid that dials
  // its chrome socket. See "Crashes are recovered" in
  // docs/architecture/THE-DOMICILE-BINARY.md.
  void (*disconnected)(void* user_data);
} DomicileEngineCallbacks;

// Returns nonzero. Exists so a compositor can tell an engine that calls
// `frame_done` and `presented` from an older one that ignores them.
DOMICILE_ENGINE_EXPORT int domicile_engine_reports_frames(void);

// Connects to the browser's mojo socket. Returns null on failure, and the
// library logs why.
//
// Blocks until the browser accepts or refuses the invitation.
DOMICILE_ENGINE_EXPORT DomicileEngine* domicile_engine_connect(
    const char* socket_path,
    DomicileEngineCallbacks callbacks);

// Stops the internal thread and drops every surface. Callbacks do not fire
// after this returns.
DOMICILE_ENGINE_EXPORT void domicile_engine_destroy(DomicileEngine* engine);

// The fd to poll; readable when domicile_engine_dispatch has work. Valid until
// domicile_engine_destroy. -1 if the engine could not create it.
DOMICILE_ENGINE_EXPORT int domicile_engine_fd(DomicileEngine* engine);

// Runs pending work, firing callbacks on this thread. Safe to call on a
// spurious wakeup.
DOMICILE_ENGINE_EXPORT void domicile_engine_dispatch(DomicileEngine* engine);

// Asks the browser to broker a frame sink for a new window. Returns the surface
// id, or zero if the browser refused.
//
// A page's embedExternalSurface() waits until this call brokers a sink.
// `app_id` becomes the frame sink's debug label only.
DOMICILE_ENGINE_EXPORT DomicileSurfaceId
domicile_surface_create(DomicileEngine* engine, const char* app_id);

// Drops the surface and the frame sink behind it.
DOMICILE_ENGINE_EXPORT void domicile_surface_destroy(DomicileEngine* engine,
                                                     DomicileSurfaceId surface);

// Imports a client's dmabuf (zwp_linux_dmabuf_v1). Returns the buffer id, or
// zero if the browser refused.
//
// Blocks for a round trip to the GPU process. The usual failure is an ozone
// platform without CreateNativePixmapFromHandle, such as headless.
DOMICILE_ENGINE_EXPORT DomicileBufferId
domicile_surface_import(DomicileEngine* engine,
                        DomicileSurfaceId surface,
                        const DomicileDmabuf* dmabuf);

// Like domicile_surface_import, but returns at once. The answer arrives as
// `imported`, carrying `request`. Submit the buffer only once it has.
//
// The fds are duplicated before this returns. A null `dmabuf` aborts.
DOMICILE_ENGINE_EXPORT void domicile_surface_import_async(
    DomicileEngine* engine,
    DomicileSurfaceId surface,
    const DomicileDmabuf* dmabuf,
    uint64_t request);

// Imports a window's frame in shared memory, for a browser that composites in
// software (2D virtio-gpu, simpledrm, vkms, --disable-gpu). Returns the buffer
// id, or zero if the browser refused: it refuses while it composites on the
// GPU, where a dmabuf is the way in.
//
// Viz reads the memory itself at each frame that shows the buffer. Write to it
// only while the buffer is released. Blocks for a round trip to the browser.
DOMICILE_ENGINE_EXPORT DomicileBufferId
domicile_surface_import_shm(DomicileEngine* engine,
                            DomicileSurfaceId surface,
                            const DomicileShmBuffer* buffer);

// Submits a frame showing `buffer` (wl_surface.commit), damaging the given
// rectangle. An empty rectangle means the whole surface.
DOMICILE_ENGINE_EXPORT void domicile_surface_submit(DomicileEngine* engine,
                                                    DomicileSurfaceId surface,
                                                    DomicileBufferId buffer,
                                                    int32_t damage_x,
                                                    int32_t damage_y,
                                                    int32_t damage_width,
                                                    int32_t damage_height);

// Like domicile_surface_submit, but shows only `crop` of `buffer`, in buffer
// pixels. An empty crop is the whole buffer.
//
// Implements xdg_surface.set_window_geometry, so a client's own shadow is not
// part of the <app> box. A separate symbol so a newer compositor fails to
// resolve it against an older engine instead of passing ignored arguments.
DOMICILE_ENGINE_EXPORT void domicile_surface_submit_crop(
    DomicileEngine* engine,
    DomicileSurfaceId surface,
    DomicileBufferId buffer,
    int32_t crop_x,
    int32_t crop_y,
    int32_t crop_width,
    int32_t crop_height,
    int32_t damage_x,
    int32_t damage_y,
    int32_t damage_width,
    int32_t damage_height);

// Names the newest box in domicile_surface_submit_for_box.
#define DOMICILE_NEWEST_BOX UINT64_MAX

// Like domicile_surface_submit_crop, but shows the frame at the newest box
// numbered at most `box` (see `configure_box`). Zero is the box shown last.
//
// A client draws for the configure it acked, which may be older than the
// page's box. Shown at its own box, an old buffer keeps its size, and the page
// waits for the client's frame at the new one instead of stretching the old
// one over it.
DOMICILE_ENGINE_EXPORT void domicile_surface_submit_for_box(
    DomicileEngine* engine,
    DomicileSurfaceId surface,
    DomicileBufferId buffer,
    int32_t crop_x,
    int32_t crop_y,
    int32_t crop_width,
    int32_t crop_height,
    int32_t damage_x,
    int32_t damage_y,
    int32_t damage_width,
    int32_t damage_height,
    uint64_t box);

// Like domicile_surface_submit_for_box, but shows a buffer the client drew
// with `transform`, turned upright. `crop` is in the buffer's own pixels,
// before the turn.
//
// Implements wl_surface.set_buffer_transform. A transform past
// DOMICILE_BUFFER_TRANSFORM_FLIPPED_270 is a caller bug and aborts.
DOMICILE_ENGINE_EXPORT void domicile_surface_submit_transformed(
    DomicileEngine* engine,
    DomicileSurfaceId surface,
    DomicileBufferId buffer,
    int32_t crop_x,
    int32_t crop_y,
    int32_t crop_width,
    int32_t crop_height,
    int32_t damage_x,
    int32_t damage_y,
    int32_t damage_width,
    int32_t damage_height,
    uint64_t box,
    DomicileBufferTransform transform);

// Like domicile_surface_submit_transformed, for a buffer whose draw may not
// have finished. `acquire_fence` is a sync_file fd that signals when it has,
// and viz reads the buffer only after that. Later submits to the surface wait
// behind this one.
//
// The fd is duplicated before this returns. An invalid fd aborts. If the
// browser refuses the fence, the frame is dropped and the buffer `released`.
DOMICILE_ENGINE_EXPORT void domicile_surface_submit_fenced(
    DomicileEngine* engine,
    DomicileSurfaceId surface,
    DomicileBufferId buffer,
    int32_t crop_x,
    int32_t crop_y,
    int32_t crop_width,
    int32_t crop_height,
    int32_t damage_x,
    int32_t damage_y,
    int32_t damage_width,
    int32_t damage_height,
    uint64_t box,
    DomicileBufferTransform transform,
    int acquire_fence);

// Makes the next submit to `surface`, and every one after it, go up at synced
// frame `frame`. The page shows that frame once an <app> with `frame` set to
// it embeds it, in the same rendering update that applies the move the frame
// goes with. Until then it shows the previous frame.
//
// Frames count from 1 per surface; 0 is the frame a surface starts at. A
// `frame` not above the last aborts. See
// docs/architecture/WINDOW-COMPOSITING.md#synced-frames in the Domicile
// repository.
DOMICILE_ENGINE_EXPORT void domicile_surface_sync(DomicileEngine* engine,
                                                  DomicileSurfaceId surface,
                                                  uint32_t frame);

// Tells the browser which connectors to light and where, in answer to the
// `displays` callback.
//
// An empty list means the compositor has no preference, and the browser lights
// what the hardware reports. This turns a panel back on when a monitor unplug
// stops a profile from matching.
//
// The records are borrowed for the call. Nothing is returned because the
// modeset completes asynchronously; the resulting `displays` callback reports
// the outcome.
DOMICILE_ENGINE_EXPORT void domicile_displays_configure(
    DomicileEngine* engine,
    const DomicileDisplayLayout* layout,
    uint32_t count);

// Tells the browser which display each tablet or touchscreen covers.
//
// The list replaces the last one. A device it names maps onto that display's
// rectangle; a device it does not name covers no display. Ignored off a tty.
// The records and strings are borrowed for the call.
DOMICILE_ENGINE_EXPORT void domicile_pointers_configure(
    DomicileEngine* engine,
    const DomicilePointerTarget* targets,
    uint32_t count);

// Sets the virtual displays, replacing the last list.
//
// Each joins the next `displays` callback as a display on connector
// `virtual-<n>`, n being its id without the top bit, laid out by
// `domicile_displays_configure` like any other. No CRTC lights for it. Ignored off a tty. The records and strings are borrowed
// for the call.
DOMICILE_ENGINE_EXPORT void domicile_virtual_displays_configure(
    DomicileEngine* engine,
    const DomicileVirtualDisplay* displays,
    uint32_t count);

// Sets what each channel is multiplied by on every display, for a night
// light. 1 leaves a channel as it is; each is 0 to 1. The browser keeps it and
// sets it again after each modeset. Ignored off a tty.
DOMICILE_ENGINE_EXPORT void domicile_displays_set_white_point(
    DomicileEngine* engine,
    float red,
    float green,
    float blue);

// Sets the contents of one of the desktop's clipboards.
//
// The compositor reads every seat selection eagerly, so it pushes the bytes
// and the browser serves pastes from memory. Send empty `text` to clear the
// clipboard, or the browser keeps offering the last value.
//
// `text` is borrowed for the call and length-delimited, like `copied`.
DOMICILE_ENGINE_EXPORT void domicile_clipboard_set(DomicileEngine* engine,
                                                   DomicileClipboard clipboard,
                                                   const char* text,
                                                   size_t length);

// Sets the contents of one of the desktop's clipboards to `count` items: text,
// an image, or both, as `copied_items` reports them. Zero items clears the
// clipboard.
//
// The records and their bytes are borrowed for the call.
DOMICILE_ENGINE_EXPORT void domicile_clipboard_set_items(
    DomicileEngine* engine,
    DomicileClipboard clipboard,
    const DomicileClipboardItem* items,
    uint32_t count);

// Drops an imported buffer. Destroying a surface drops its buffers, so this is
// for a client that destroys a single buffer.
DOMICILE_ENGINE_EXPORT void domicile_buffer_destroy(DomicileEngine* engine,
                                                    DomicileSurfaceId surface,
                                                    DomicileBufferId buffer);

// Captures what a display shows, for a screen cast. Returns the capture id, or
// zero if no browser window shows that display.
//
// `display_id` is a DomicileDisplay::id. A nested or headless browser sends no
// displays; zero names its only window.
//
// Frames arrive through `captured`, `width` x `height`, only when the display
// changed and at most `max_fps` a second. Blocks for the browser's answer.
DOMICILE_ENGINE_EXPORT DomicileCaptureId
domicile_display_capture_start(DomicileEngine* engine,
                               int64_t display_id,
                               uint32_t width,
                               uint32_t height,
                               uint32_t max_fps);

// Captures what browser window `window_id` shows, alone, for a screenshot.
// Returns the capture id, or zero if no such window has a page drawn.
//
// `window_id` is the id the shell's browser window list gives, borrowed for
// the call. Frames arrive through `captured` at the page's size in pixels,
// until domicile_display_capture_resize, and otherwise as for
// domicile_display_capture_start, whose resize, stop and release functions
// this capture also takes. Blocks for the browser's answer.
DOMICILE_ENGINE_EXPORT DomicileCaptureId
domicile_browser_window_capture_start(DomicileEngine* engine,
                                      const char* window_id,
                                      uint32_t max_fps);

// Captures at `width` x `height` from the next frame on.
DOMICILE_ENGINE_EXPORT void domicile_display_capture_resize(
    DomicileEngine* engine,
    DomicileCaptureId capture,
    uint32_t width,
    uint32_t height);

// Stops `capture` and releases every frame of it still held.
DOMICILE_ENGINE_EXPORT void domicile_display_capture_stop(
    DomicileEngine* engine,
    DomicileCaptureId capture);

// Gives a frame's buffer back to viz, which may draw the next frame into it.
DOMICILE_ENGINE_EXPORT void domicile_captured_frame_release(
    DomicileEngine* engine,
    DomicileCaptureId capture,
    uint64_t frame);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_
