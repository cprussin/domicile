import type { Result } from "@cprussin/option-result";

import type { SystemError } from "../system";

/** `length` bytes of a file from `offset`: fewer at its end. */
export type ReadBytes = (
  offset: number,
  length: number,
) => Promise<Result<Uint8Array, SystemError>>;
