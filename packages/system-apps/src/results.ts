// Combining the `Result`s of system calls made side by side.

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

/** Every value, or the first error. */
export const allOk = <
  T extends NonNullable<unknown>,
  E extends NonNullable<unknown>,
>(
  results: readonly Result<T, E>[],
): Result<T[], E> =>
  results.reduce<Result<T[], E>>(
    (all, each) =>
      all.andThen((values) => each.map((value) => [...values, value])),
    Ok([]),
  );

/**
 * `result`, with `absent` in place of an error that means the path is not
 * there to read: missing, of the other kind, or unreadable. The spec says to
 * skip those. Any other error, such as a locked desktop, is kept.
 */
export const orAbsent = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
  absent: T,
): Result<T, SystemError> =>
  result.orElse((error) => {
    switch (error.kind) {
      case SystemErrorKind.NotFound:
      case SystemErrorKind.NotADirectory:
      case SystemErrorKind.IsADirectory:
      case SystemErrorKind.PermissionDenied: {
        return Ok(absent);
      }
      case SystemErrorKind.AlreadyExists:
      case SystemErrorKind.InvalidInput:
      case SystemErrorKind.Locked:
      case SystemErrorKind.Dbus:
      case SystemErrorKind.Canceled:
      case SystemErrorKind.Other: {
        return result;
      }
    }
  });
