// Portal dialogs for a shell: the requests applications make through
// `xdg-desktop-portal`, and the shell's answers. See
// docs/architecture/PORTALS.md.
//
// The engine relays each request's body untyped; it is parsed here, by kind.
// A new kind is one schema in `KINDS`, one `PortalKind` and one constructor.

import { z } from "zod";

import type { DomicileHost } from "./domicile-host";

export enum PortalKind {
  /** A yes/no question, such as whether an application may use the camera. */
  Access,
  /** A kind this SDK cannot parse. Answer it with {@link PortalAnswer.Refused}. */
  Unknown,
}

/** What every request carries. */
export type PortalRequestBase = {
  /** The id {@link answerPortalRequest} takes. */
  id: number;
  /** The asking application's desktop file id. Empty when unknown. */
  appId: string;
  /** The `<app>` to show the dialog over, or the focused screen when absent. */
  parentAppId: string | undefined;
};

/** An access dialog's texts. A missing label is the shell's to choose. */
export type AccessBody = {
  title: string;
  subtitle: string;
  body: string;
  grantLabel: string | undefined;
  denyLabel: string | undefined;
};

export const PortalRequest = {
  Access: (base: PortalRequestBase, body: AccessBody) => ({
    ...base,
    body,
    kind: PortalKind.Access as const,
  }),
  Unknown: (base: PortalRequestBase, wireKind: string) => ({
    ...base,
    kind: PortalKind.Unknown as const,
    wireKind,
  }),
};

export type PortalRequest = ReturnType<
  (typeof PortalRequest)[keyof typeof PortalRequest]
>;

export enum PortalAnswerKind {
  /** The user allowed an {@link PortalKind.Access} request. */
  Access,
  /** The user dismissed or denied the dialog. */
  Canceled,
  /** The shell has no dialog for this kind. */
  Refused,
}

export const PortalAnswer = {
  Access: () => ({ kind: PortalAnswerKind.Access as const }),
  Canceled: () => ({ kind: PortalAnswerKind.Canceled as const }),
  Refused: () => ({ kind: PortalAnswerKind.Refused as const }),
};

export type PortalAnswer = ReturnType<
  (typeof PortalAnswer)[keyof typeof PortalAnswer]
>;

/** What the portal functions need of the desktop `Shell` is handed. */
export type PortalHost = Pick<DomicileHost, "answerPortalRequest"> & {
  addEventListener: (
    type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
  removeEventListener: (
    type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ) => void;
};

/**
 * Call `listener` with every unanswered request, oldest first, on each change.
 * Returns a function that stops listening. Throws on a request of a known kind
 * whose body does not parse: the compositor and this SDK disagree.
 */
export const watchPortalRequests = (
  host: PortalHost,
  listener: (requests: readonly PortalRequest[]) => void,
): (() => void) => {
  const heard = (event: MessageEvent<string>) => {
    listener(
      requestsSchema
        .parse(JSON.parse(event.data))
        .items.map((item) => parseRequest(item)),
    );
  };
  host.addEventListener("portalrequests", heard);
  return () => {
    host.removeEventListener("portalrequests", heard);
  };
};

/** Answer request `id`. The first answer to reach the compositor wins. */
export const answerPortalRequest = (
  host: PortalHost,
  id: number,
  answer: PortalAnswer,
): void => {
  host.answerPortalRequest(id, JSON.stringify({ kind: wireAnswer(answer) }));
};

const accessSchema = z
  .object({
    body: z.string(),
    deny_label: z.string().optional(),
    grant_label: z.string().optional(),
    subtitle: z.string(),
    title: z.string(),
  })
  .transform(
    (body): AccessBody => ({
      body: body.body,
      denyLabel: body.deny_label,
      grantLabel: body.grant_label,
      subtitle: body.subtitle,
      title: body.title,
    }),
  );

/** Each kind's wire name, and how to read its body into a request. */
const KINDS: ReadonlyMap<
  string,
  (base: PortalRequestBase, body: unknown) => PortalRequest
> = new Map([
  [
    "access",
    (base: PortalRequestBase, body: unknown) =>
      PortalRequest.Access(base, accessSchema.parse(body)),
  ],
]);

const itemSchema = z.object({
  app_id: z.string(),
  body: z.unknown(),
  id: z.number(),
  kind: z.string(),
  parent_app_id: z.string().optional(),
});

const requestsSchema = z.object({
  items: z.array(itemSchema),
  type: z.literal("portal_requests"),
});

const parseRequest = (item: z.infer<typeof itemSchema>): PortalRequest => {
  const base = {
    appId: item.app_id,
    id: item.id,
    parentAppId: item.parent_app_id,
  };
  const parse = KINDS.get(item.kind);
  return parse === undefined
    ? PortalRequest.Unknown(base, item.kind)
    : parse(base, item.body);
};

const wireAnswer = (answer: PortalAnswer): string => {
  switch (answer.kind) {
    case PortalAnswerKind.Access:
      return "access";
    case PortalAnswerKind.Canceled:
      return "canceled";
    case PortalAnswerKind.Refused:
      return "refused";
  }
};
