// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_
#define COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_

#include <stddef.h>
#include <stdint.h>

// libdomicile_engine.so: the seam between domicile-compositor and the browser.
//
// The library owns the mojo, domicile-compositor owns the Wayland. Everything
// behind this header is C++ built by GN — the invitation, the FrameSinkBroker
// pipe, and in time the SharedImage import and CompositorFrame assembly. None
// of it reaches cargo and none of it needs to. See
// docs/architecture/ENGINE-FORK.md in the Domicile repository, "The seam: a C
// ABI, and what crosses it", which is the design this implements.
//
// IT DOES NOT OWN THE THREAD. domicile-compositor runs Smithay's calloop and
// mojo wants a task runner of its own, so the library keeps mojo on a thread of
// its own and hands the compositor an fd to poll:
//
//   int  domicile_engine_fd(engine);        // add to calloop
//   void domicile_engine_dispatch(engine);  // run pending work, fire callbacks
//
// which is the shape of wl_display_get_fd and wl_display_dispatch, the loop the
// compositor already runs. Callbacks fire from inside dispatch, on the caller's
// thread, and never from anywhere else.
//
// IT NEVER SEES A MAILBOX AND NEVER HOLDS A GPU CHANNEL. A dmabuf is sent over
// the socket already held and the browser imports it, because the browser is
// the process with an aura::Env to reach a SharedImageInterface through — which
// is where components/exo/buffer.cc already lives. What comes back is an opaque
// BufferId. See ENGINE-FORK.md, "Settled: broker the import".

// Chromium builds with -fvisibility=hidden, so every entry point says so.
#define DOMICILE_ENGINE_EXPORT __attribute__((visibility("default")))

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DomicileEngine DomicileEngine;

// Which of the desktop's two clipboards something is on.
//
// The pair every desktop has and neither of which is the other: one is what
// Ctrl-C puts somewhere, and the other is what selecting a word puts somewhere
// else for the middle button to paste. A plain integer rather than an `enum`,
// like every other scalar here, so that what crosses is a width both sides
// spell out.
typedef uint32_t DomicileClipboard;

// Ctrl-C and Ctrl-V, which on the Wayland side is wl_data_device.
#define DOMICILE_CLIPBOARD_COPY 0u
// Selecting a word and the middle button, which on the Wayland side is
// zwp_primary_selection_device_v1.
#define DOMICILE_CLIPBOARD_PRIMARY 1u

// Which way up a monitor is bolted to the desk, as the turn what is drawn on it
// takes to come out upright -- the `wl_output.transform` rotations, in that
// order, which count counterclockwise. A plain integer for the reason
// DomicileClipboard above is one.
typedef uint32_t DomicileDisplayTransform;

#define DOMICILE_DISPLAY_TRANSFORM_NORMAL 0u
#define DOMICILE_DISPLAY_TRANSFORM_ROTATE_90 1u
#define DOMICILE_DISPLAY_TRANSFORM_ROTATE_180 2u
#define DOMICILE_DISPLAY_TRANSFORM_ROTATE_270 3u

// A surface, as the compositor names one. Zero is never valid, so it doubles as
// the failure return of domicile_surface_create.
typedef uint32_t DomicileSurfaceId;

// An imported buffer. Zero is never valid, so it doubles as the failure return
// of domicile_surface_import.
typedef uint64_t DomicileBufferId;

// One plane of a dmabuf, as zwp_linux_buffer_params_v1.add sends it.
typedef struct DomicileDmabufPlane {
  int fd;
  uint32_t offset;
  uint32_t stride;
} DomicileDmabufPlane;

// A client's buffer, exactly as the compositor already has it.
//
// The fds are borrowed for the duration of the call: the library duplicates
// what it sends and the caller keeps ownership of the originals.
typedef struct DomicileDmabuf {
  uint32_t width;
  uint32_t height;
  // DRM_FORMAT_*, as the client sent it.
  uint32_t fourcc;
  uint64_t modifier;
  uint32_t plane_count;
  DomicileDmabufPlane planes[4];
} DomicileDmabuf;

// One display the browser is scanning out on.
//
// THIS EXISTS BECAUSE THE ENGINE IS THE PROCESS THAT HOLDS DRM MASTER. A
// Wayland compositor normally reads its own hardware; Domicile's does not and
// carries no DRM backend at all, so on a tty the display list is the browser's
// reading and this is how it crosses. Nested, nothing sends these: the screen
// there is the host's monitors, which are not this desktop's displays.
//
// `x`, `y`, `width` and `height` are the display's place on the browser's
// desktop, in pixels.
//
// `physical_width_mm`, `physical_height_mm` and `refresh_mhz` are the panel
// itself, in the units wl_output states them in, and any of the three may be
// zero — which is that protocol's own word for a screen with no such number,
// and what a projector, a virtual output or a connector with no readable mode
// reports. They are a reading rather than a constant: the browser divides them
// back out of the DisplaySnapshot's own physical size, which is the only place
// on the machine those millimeters exist, because the engine is the process
// holding DRM master.
typedef struct DomicileDisplay {
  // Stable across a hotplug: ozone derives it from the EDID. The compositor
  // names its wl_output after this, so a monitor unplugged and plugged back in
  // keeps the output its clients are on.
  int64_t id;
  // What to call this monitor: "<MAKE> <MODEL> <SERIAL>", off its EDID, or an
  // empty string -- never null -- for one that states none of the three.
  //
  // The id above is identity and this is a NAME, and the compositor needs
  // both. An int64 derived from an EDID cannot be predicted from looking at a
  // desk, so it is no use to somebody writing down which monitor a layout
  // means; this is the string kanshi and sway match on.
  //
  // BORROWED FOR THE DURATION OF THE CALL, like the array itself: the library
  // owns the characters and may free them once the callback returns, so a
  // caller that keeps one copies it.  (It in fact holds them a little longer
  // -- they live in the event the engine is draining -- but that is an
  // implementation detail and not something to write a caller against.)
  const char* name;
  int32_t x;
  int32_t y;
  int32_t width;
  int32_t height;
  int32_t physical_width_mm;
  int32_t physical_height_mm;
  int32_t refresh_mhz;
} DomicileDisplay;

// One display, as the compositor wants the connector behind it driven.
//
// THE OPPOSITE DIRECTION TO DomicileDisplay, and the opposite kind of fact.
// That one is what the browser read off the hardware; this is what the
// compositor's config says to do with it -- which connectors to light, and
// where each one's mode goes on the browser's own desktop. The two halves are
// in different processes because the config is the compositor's and DRM master
// is the browser's, which is the whole reason this crosses at all.
typedef struct DomicileDisplayLayout {
  // Which display, as DomicileDisplay::id named it. The compositor cannot
  // invent one: it is the id the browser derived from the EDID and sent.
  int64_t id;
  // Nonzero to light this connector. Zero leaves it dark, which is what a
  // profile's `enabled: false` says -- the way a laptop panel is named so that
  // shutting the lid on a full desk still matches the desk's profile, and
  // turned off so nothing is drawn behind the lid.
  int32_t enabled;
  // Where its mode goes on the browser's desktop, in physical pixels. Not read
  // where `enabled` is zero: a display that is not being lit has no corner, and
  // zero is what to send instead of one.
  int32_t x;
  int32_t y;
  // Which way up the monitor is, and how many of its pixels one logical pixel
  // is worth. THE BROWSER DRAWS BOTH: it turns and scales the window it puts
  // on this connector, so the page in it lays out upright in the logical
  // pixels the desktop is described in, and a shell never has to know the
  // monitor is on its side. Read for a dark connector too, because its window
  // outlives the dark.
  DomicileDisplayTransform transform;
  double scale;
} DomicileDisplayLayout;

// What the browser has to tell the compositor. Each maps onto a Wayland request
// the compositor already speaks, which is why this is a translation table
// rather than a protocol:
//
//   configure  xdg_toplevel.configure — the page's layout box changed
//   frame      wl_surface.frame       — viz asked for a frame
//   released   wl_buffer.release      — viz is done sampling a buffer, so the
//                                       client may draw into it again
//   displays   wl_output              — the whole display list, primary first
//   copied     wl_data_device.set_selection — something was copied in a page
//
// All five fire from domicile_engine_dispatch, on the thread that calls it.
// `user_data` is passed back untouched. A null function pointer means that
// event is dropped.
//
// THIS STRUCT GROWS AT THE END AND NOWHERE ELSE, which is what makes a
// compositor newer than the engine it loaded safe: the library reads the
// prefix it knows and ignores the rest. The reverse — an engine newer than the
// compositor that loaded it — is not safe and is not guarded here, because it
// is not a configuration this repository ships: `engine-release.nix` pins the
// engine into the checkout the compositor is built from, and
// `scripts/test-the-pinned-engine-meets-the-compositor.sh` is what keeps that
// pair honest.
//
// `displays` is the only one carrying an array. It points at `count` records
// borrowed for the duration of the call — the library owns them and frees them
// when the callback returns, so a caller that keeps one copies it. `count` is
// never zero: an empty list is a screen nobody has read yet rather than a
// desktop with no displays, and the browser does not send one.
typedef struct DomicileEngineCallbacks {
  void* user_data;
  void (*configure)(void* user_data,
                    DomicileSurfaceId surface,
                    uint32_t width,
                    uint32_t height);
  void (*frame)(void* user_data,
                DomicileSurfaceId surface,
                uint64_t deadline_us);
  void (*released)(void* user_data, DomicileSurfaceId surface, uint64_t buffer);
  void (*displays)(void* user_data,
                   const DomicileDisplay* displays,
                   uint32_t count);
  // Something was copied in a page or a browser window, on its way to the
  // seat. WITHOUT THIS THE BROWSER HAS A CLIPBOARD NOTHING ELSE CAN REACH: it
  // is not a Wayland client of the compositor — on a tty there is no display
  // server for it to be one of — so a copy made in a page reaches no seat on
  // its own.
  //
  // `text` points at `length` bytes borrowed for the duration of the call, and
  // an empty one is a clipboard with nothing on it — which is what copying
  // something that is not text leaves behind, because nothing but text crosses
  // here. LENGTH-CARRIED RATHER THAN NUL-TERMINATED, which is the one place
  // this ABI differs from itself and is about clipboards rather than taste:
  // what a person copies is arbitrary bytes and may hold a nul, which a C
  // string cannot say and would cut short.
  void (*copied)(void* user_data,
                 DomicileClipboard clipboard,
                 const char* text,
                 size_t length);
  // `configure`, and the scale the box was laid out at: how many of the
  // page's device pixels one of its CSS pixels is. A desk of several monitors
  // is several pages, each drawn at its own monitor's scale, so the box of one
  // window comes back down to logical pixels by its own page's scale and not
  // by whichever page last said what its ratio was.
  //
  // Called INSTEAD of `configure` where it is set, and last in the struct for
  // the reason stated above it: an engine that predates it reads the prefix
  // and goes on calling `configure`.
  void (*configure_at)(void* user_data,
                       DomicileSurfaceId surface,
                       uint32_t width,
                       uint32_t height,
                       double scale);
} DomicileEngineCallbacks;

// Joins the browser's mojo graph over the named socket the browser is
// listening on, and returns an engine or null.
//
// Null means the socket was not there or the invitation was refused; the
// library logs why. This blocks until the connection is established or fails,
// which is bounded by the browser answering an invitation it is already
// listening for.
DOMICILE_ENGINE_EXPORT DomicileEngine* domicile_engine_connect(
    const char* socket_path,
    DomicileEngineCallbacks callbacks);

// Stops the internal thread and drops every surface. Callbacks do not fire
// after this returns.
DOMICILE_ENGINE_EXPORT void domicile_engine_destroy(DomicileEngine* engine);

// The fd to poll. Readable exactly when domicile_engine_dispatch has something
// to do, so a compositor that adds it to calloop is woken for every event and
// for nothing else. Valid until domicile_engine_destroy. -1 if the engine
// could not create it.
DOMICILE_ENGINE_EXPORT int domicile_engine_fd(DomicileEngine* engine);

// Runs the work the fd woke you for, firing callbacks on this thread. Cheap
// and harmless when there is nothing to do, which is what a spurious wakeup
// looks like.
DOMICILE_ENGINE_EXPORT void domicile_engine_dispatch(DomicileEngine* engine);

// Asks the browser to broker a frame sink, and returns the surface to name in
// every later call about it — or zero if the browser refused.
//
// This is a window appearing. The browser holds the page's
// embedExternalSurface() until a producer has been brokered a sink, so a page
// that got there first is waiting for exactly this call.
//
// `app_id` is what the compositor calls the window. It reaches viz as the
// frame sink's debug label, which is where a name is useful and where a
// mistaken one is harmless; which surface a given <app> element shows is the
// chrome protocol's to decide and is not settled here.
DOMICILE_ENGINE_EXPORT DomicileSurfaceId
domicile_surface_create(DomicileEngine* engine, const char* app_id);

// Drops the surface and the frame sink behind it.
DOMICILE_ENGINE_EXPORT void domicile_surface_destroy(DomicileEngine* engine,
                                                     DomicileSurfaceId surface);

// Imports a client's dmabuf and returns the id to name it by, or zero.
//
// This is zwp_linux_dmabuf_v1: the fds the client already sent. Blocking,
// because a buffer that does not exist is not something the compositor can
// attach — and it happens once per buffer, not once per frame.
//
// Zero means the browser refused it. The commonest reason by far is that there
// is no GPU to import into: an ozone platform that does not implement
// CreateNativePixmapFromHandle — headless is one — cannot do this at all.
DOMICILE_ENGINE_EXPORT DomicileBufferId
domicile_surface_import(DomicileEngine* engine,
                        DomicileSurfaceId surface,
                        const DomicileDmabuf* dmabuf);

// Submits a frame showing `buffer`, damaging the given rectangle. An empty
// rectangle — zero width or height — means the whole surface.
//
// This is wl_surface.commit. The browser puts the matching
// TransferableResource in the CompositorFrame; the producer never names a
// mailbox because it never has one.
DOMICILE_ENGINE_EXPORT void domicile_surface_submit(DomicileEngine* engine,
                                                    DomicileSurfaceId surface,
                                                    DomicileBufferId buffer,
                                                    int32_t damage_x,
                                                    int32_t damage_y,
                                                    int32_t damage_width,
                                                    int32_t damage_height);

// Tells the browser which connectors to light and where.
//
// THE ANSWER TO the `displays` callback, and the reason this ABI carries both
// directions: what the browser reads off DRM is a fact, and what to do with it
// is a config only the compositor holds.
//
// AN EMPTY LIST IS NOT "LIGHT NOTHING". It is the compositor having no
// opinion, which is what every desktop but a matched profile's has, and the
// browser answers it by going back to lighting what the hardware reports. That
// is load-bearing rather than tidy: a profile that turned a panel off stops
// matching the moment a monitor is unplugged, and something has to say the
// panel comes back on.
//
// The records are borrowed for the duration of the call -- the library copies
// what it needs before it returns.
//
// Nothing comes back, and not for want of trying: a modeset is committed on
// the browser's own DRM thread and answered on a later task, so anything this
// returned would be a guess. What the caller learns instead is the next
// `displays` callback, which the modeset itself provokes.
DOMICILE_ENGINE_EXPORT void domicile_displays_configure(
    DomicileEngine* engine,
    const DomicileDisplayLayout* layout,
    uint32_t count);

// Tells the browser what is on one of the desktop's two clipboards.
//
// THE BROWSER IS TOLD RATHER THAN ASKED, because the compositor already has
// the bytes: a selection arriving on the seat is read out of the client that
// offered it whether or not anybody pastes, so there is nothing left to fetch
// and a page pasting is answered out of the browser's own memory.
//
// An empty `text` is a clipboard with nothing on it, which is what a desktop
// that has just started has, and is worth saying: a browser never told would
// go on offering whatever it was told last.
//
// `text` is borrowed for the duration of the call and carries its length for
// the reason the `copied` callback does. Nothing comes back; what the browser
// does with it is put it where a page pasting reads.
DOMICILE_ENGINE_EXPORT void domicile_clipboard_set(DomicileEngine* engine,
                                                   DomicileClipboard clipboard,
                                                   const char* text,
                                                   size_t length);

// Drops an imported buffer. Every buffer goes when its surface does, so this is
// for a client that destroys one of its own.
DOMICILE_ENGINE_EXPORT void domicile_buffer_destroy(DomicileEngine* engine,
                                                    DomicileSurfaceId surface,
                                                    DomicileBufferId buffer);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_
