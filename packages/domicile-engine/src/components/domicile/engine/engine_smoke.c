// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// THROWAWAY, with the rest of the spike. What phase 1's library has to be able
// to do, asserted by a process that is not Chromium and does not know it is
// talking to one.
//
// It is C rather than C++ on purpose. The seam is a C ABI because
// domicile-compositor is Rust and cannot consume a GN-built C++ target any
// other way, so a header that only compiles as C++ would not be the seam the
// design calls for. This is the compiler checking that claim.
//
// It stands in for the calloop domicile-compositor runs: poll the engine's fd,
// dispatch when it wakes, and take the callbacks from there. Exits 0 only once
// both a configure and a frame have arrived — which together mean the
// invitation was accepted, the broker brokered, a page embedded the surface,
// viz is driving it, and both events crossed the fd onto this thread.

#ifdef UNSAFE_BUFFERS_BUILD
// This walks argv, which is a pointer and a count and cannot be anything else
// in C. The seam is a C ABI because domicile-compositor is Rust; a harness that
// used Chromium's C++ containers to prove that would not be proving it.
#pragma allow_unsafe_buffers
#endif

#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "components/domicile/engine/domicile_engine.h"

static const char kSocketSwitch[] = "--domicile-broker-socket=";

// How long to wait for a page to embed the surface. The engine has to start and
// load a page; the compositor may well win that race, and waiting rather than
// failing keeps the ordering out of the harness.
static const int kTimeoutMs = 60000;

struct Seen {
  int configures;
  int frames;
  int releases;
  uint32_t width;
  uint32_t height;
};

static void OnConfigure(void* user_data,
                        DomicileSurfaceId surface,
                        uint32_t width,
                        uint32_t height) {
  struct Seen* seen = (struct Seen*)user_data;
  seen->configures++;
  seen->width = width;
  seen->height = height;
  printf("configure: surface %u at %ux%u\n", surface, width, height);
}

static void OnFrame(void* user_data,
                    DomicileSurfaceId surface,
                    uint64_t deadline_us) {
  struct Seen* seen = (struct Seen*)user_data;
  if (seen->frames++ == 0) {
    printf("frame: surface %u, first of many\n", surface);
  }
}

static void OnReleased(void* user_data,
                       DomicileSurfaceId surface,
                       uint64_t buffer) {
  struct Seen* seen = (struct Seen*)user_data;
  seen->releases++;
  printf("released: surface %u buffer %llu\n", surface,
         (unsigned long long)buffer);
}

static int64_t NowMs(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

int main(int argc, char** argv) {
  const char* socket_path = NULL;
  for (int i = 1; i < argc; ++i) {
    if (strncmp(argv[i], kSocketSwitch, strlen(kSocketSwitch)) == 0) {
      socket_path = argv[i] + strlen(kSocketSwitch);
    }
  }
  if (socket_path == NULL) {
    fprintf(stderr, "usage: domicile_engine_smoke %s<path>\n", kSocketSwitch);
    return 2;
  }

  struct Seen seen;
  memset(&seen, 0, sizeof(seen));

  DomicileEngineCallbacks callbacks;
  memset(&callbacks, 0, sizeof(callbacks));
  callbacks.user_data = &seen;
  callbacks.configure = OnConfigure;
  callbacks.frame = OnFrame;
  callbacks.released = OnReleased;

  DomicileEngine* engine = domicile_engine_connect(socket_path, callbacks);
  if (engine == NULL) {
    fprintf(stderr, "could not join the browser's mojo graph at %s\n",
            socket_path);
    return 1;
  }
  printf("joined the browser's mojo graph\n");

  const DomicileSurfaceId surface =
      domicile_surface_create(engine, "domicile-engine-smoke");
  if (surface == 0) {
    fprintf(stderr, "the browser brokered no frame sink\n");
    domicile_engine_destroy(engine);
    return 1;
  }
  printf("brokered a frame sink for surface %u\n", surface);
  printf("waiting for a page to embed it...\n");

  // The loop the compositor already runs, standing in for calloop.
  const int fd = domicile_engine_fd(engine);
  const int64_t deadline = NowMs() + kTimeoutMs;
  while ((seen.configures == 0 || seen.frames == 0) && NowMs() < deadline) {
    struct pollfd descriptor;
    descriptor.fd = fd;
    descriptor.events = POLLIN;
    descriptor.revents = 0;
    if (poll(&descriptor, 1, 250) > 0) {
      domicile_engine_dispatch(engine);
    }
  }

  const int ok = seen.configures > 0 && seen.frames > 0;
  if (ok) {
    printf("configured %d time(s), %d frame callback(s), %d release(s)\n",
           seen.configures, seen.frames, seen.releases);
    printf("the C ABI carried it: invitation, broker, fd, dispatch\n");
  } else {
    fprintf(stderr,
            "within %ds: %d configure(s) and %d frame callback(s); both are "
            "needed, and a configure with no frames means BeginFrames are not "
            "flowing\n",
            kTimeoutMs / 1000, seen.configures, seen.frames);
  }

  domicile_surface_destroy(engine, surface);
  domicile_engine_destroy(engine);
  return ok ? 0 : 1;
}
