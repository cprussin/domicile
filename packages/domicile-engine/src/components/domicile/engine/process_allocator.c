// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// The allocations libdomicile_engine.so makes go to the allocator of the
// process that loaded it, as its frees do.
//
// Chromium 160 builds with -fsanitize=alloc-token, which turns every call to
// malloc, calloc, realloc, operator new and the rest into a call to the
// matching __alloc_token_* function. The library links //base, whose allocator
// shim defines those functions over PartitionAlloc. It also defines malloc and
// free, but the compositor loads the library with dlopen, after libc, so libc's
// free wins every lookup. A block from the shim's __alloc_token_malloc was then
// handed to libc's free, which aborted with "free(): invalid size" as soon as
// the compositor started the engine.
//
// The linker's --wrap (see BUILD.gn) sends the library's __alloc_token_* calls
// here instead. Each wrapper calls the plain function, which the dynamic linker
// resolves in the process as it did before Chromium 160. This file must not be
// built with alloc-token itself, or each wrapper would call itself.

#include <stddef.h>
#include <stdlib.h>

#include <malloc.h>
#include <unistd.h>

#define PROCESS_ALLOCATOR __attribute__((used, no_sanitize("alloc-token")))

PROCESS_ALLOCATOR void* __wrap___alloc_token_malloc(size_t size, size_t token) {
  return malloc(size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_calloc(size_t n,
                                                    size_t size,
                                                    size_t token) {
  return calloc(n, size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_realloc(void* ptr,
                                                     size_t size,
                                                     size_t token) {
  return realloc(ptr, size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_reallocarray(void* ptr,
                                                          size_t n,
                                                          size_t size,
                                                          size_t token) {
  return reallocarray(ptr, n, size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_aligned_alloc(size_t alignment,
                                                           size_t size,
                                                           size_t token) {
  return aligned_alloc(alignment, size);
}

PROCESS_ALLOCATOR int __wrap___alloc_token_posix_memalign(void** result,
                                                          size_t alignment,
                                                          size_t size,
                                                          size_t token) {
  return posix_memalign(result, alignment, size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_memalign(size_t alignment,
                                                      size_t size,
                                                      size_t token) {
  return memalign(alignment, size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_valloc(size_t size,
                                                    size_t token) {
  return valloc(size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token_pvalloc(size_t size,
                                                     size_t token) {
  return pvalloc(size);
}

// operator new and new[], by their mangled names. The nothrow_t argument is a
// reference, so a pointer here, and align_val_t is a size_t.
void* _Znwm(size_t size);
void* _Znam(size_t size);
void* _ZnwmRKSt9nothrow_t(size_t size, const void* nothrow);
void* _ZnamRKSt9nothrow_t(size_t size, const void* nothrow);
void* _ZnwmSt11align_val_t(size_t size, size_t alignment);
void* _ZnamSt11align_val_t(size_t size, size_t alignment);
void* _ZnwmSt11align_val_tRKSt9nothrow_t(size_t size,
                                         size_t alignment,
                                         const void* nothrow);
void* _ZnamSt11align_val_tRKSt9nothrow_t(size_t size,
                                         size_t alignment,
                                         const void* nothrow);

PROCESS_ALLOCATOR void* __wrap___alloc_token__Znwm(size_t size, size_t token) {
  return _Znwm(size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__Znam(size_t size, size_t token) {
  return _Znam(size);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__ZnwmRKSt9nothrow_t(
    size_t size,
    const void* nothrow,
    size_t token) {
  return _ZnwmRKSt9nothrow_t(size, nothrow);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__ZnamRKSt9nothrow_t(
    size_t size,
    const void* nothrow,
    size_t token) {
  return _ZnamRKSt9nothrow_t(size, nothrow);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__ZnwmSt11align_val_t(
    size_t size,
    size_t alignment,
    size_t token) {
  return _ZnwmSt11align_val_t(size, alignment);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__ZnamSt11align_val_t(
    size_t size,
    size_t alignment,
    size_t token) {
  return _ZnamSt11align_val_t(size, alignment);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__ZnwmSt11align_val_tRKSt9nothrow_t(
    size_t size,
    size_t alignment,
    const void* nothrow,
    size_t token) {
  return _ZnwmSt11align_val_tRKSt9nothrow_t(size, alignment, nothrow);
}

PROCESS_ALLOCATOR void* __wrap___alloc_token__ZnamSt11align_val_tRKSt9nothrow_t(
    size_t size,
    size_t alignment,
    const void* nothrow,
    size_t token) {
  return _ZnamSt11align_val_tRKSt9nothrow_t(size, alignment, nothrow);
}
