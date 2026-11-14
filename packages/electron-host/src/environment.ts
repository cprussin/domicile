// The environment variables the host reads, parsed once at its entry point.

import { z } from "zod";

const schema = z.object({
  XDG_CACHE_HOME: z.string().optional(),
  XDG_CONFIG_HOME: z.string().optional(),
});

export type Environment = z.infer<typeof schema>;

export const readEnvironment = (
  // biome-ignore lint/style/noProcessEnv: the one place the host reads its environment
  source: Readonly<Record<string, string | undefined>> = process.env,
): Environment => schema.parse(source);
