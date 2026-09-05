// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_
#define COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_

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
// WHAT IS NOT HERE YET. domicile_surface_import and domicile_surface_submit —
// the dmabuf half — are phase 1's next step and deliberately absent rather than
// stubbed: an import that silently succeeds without a SharedImage behind it is
// worse than one that has not been written. `released` is declared because the
// buffer lifecycle is not optional once submit exists, and it cannot fire until
// it does.

// Chromium builds with -fvisibility=hidden, so every entry point says so.
#define DOMICILE_ENGINE_EXPORT __attribute__((visibility("default")))

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DomicileEngine DomicileEngine;

// A surface, as the compositor names one. Zero is never valid, so it doubles as
// the failure return of domicile_surface_create.
typedef uint32_t DomicileSurfaceId;

// What the browser has to tell the compositor. Each maps onto a Wayland request
// the compositor already speaks, which is why this is a translation table
// rather than a protocol:
//
//   configure  xdg_toplevel.configure — the page's layout box changed
//   frame      wl_surface.frame       — viz asked for a frame
//   released   wl_buffer.release      — viz is done sampling a buffer, so the
//                                       client may draw into it again
//
// All three fire from domicile_engine_dispatch, on the thread that calls it.
// `user_data` is passed back untouched. A null function pointer means that
// event is dropped.
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

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // COMPONENTS_DOMICILE_ENGINE_DOMICILE_ENGINE_H_
