import { z } from "zod";

/** Text parsed as JSON; text that is not JSON is an issue, not a throw. */
export const jsonText = z.string().transform((text, context): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: "custom", input: text, message: "not JSON" });
    return z.NEVER;
  }
});
