// Portal dialogs for a shell: the requests applications make through
// `xdg-desktop-portal`, and the shell's answers. See
// docs/architecture/PORTALS.md.
//
// The engine relays each request's body untyped; it is parsed here, by kind.
// A new kind is one schema in `KINDS`, one `PortalKind` and one constructor.
// The same push lists the sessions that control or capture input.

import { z } from "zod";

import type { DomicileHost } from "./domicile-host";

export enum PortalKind {
  /** A yes/no question, such as whether an application may use the camera. */
  Access,
  /** Pick an application to open a file or URI with. */
  AppChooser,
  /** Files to open, or where to save. */
  FileChooser,
  /**
   * An application holding off logout, user switching or suspend, until it
   * lets go. Not a question: the compositor refuses answers to it.
   */
  Inhibit,
  /** Which input devices, and the clipboard, an application may control. */
  RemoteDesktop,
  /** Whether an application may take input that crosses a screen edge. */
  InputCapture,
  /**
   * Whether an application may have the user's name and picture. Allow it
   * with {@link PortalAnswer.Access}.
   */
  Account,
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

/** What an app chooser opens, and the applications it offers. */
export type AppChooserBody = {
  /** Desktop file IDs without `.desktop`. May change while the dialog is up. */
  choices: readonly string[];
  /** The application chosen last time for this content type. */
  lastChoice: string | undefined;
  /** The MIME type being opened. */
  contentType: string | undefined;
  uri: string | undefined;
  /** The file's name, without its directory. */
  filename: string | undefined;
};

/** Which `FileChooser` method asked. */
export enum FileChooserMode {
  /** Existing files, or a folder when `directory` is set. */
  Open,
  /** One new path. */
  Save,
  /** A folder to save `files` into. */
  SaveFiles,
}

/** A named group of accepted extensions, such as "Images". */
export type FileChooserFilter = {
  /** Lowercase and without the dot; empty accepts any file. */
  extensions: readonly string[];
  name: string;
};

/**
 * A question asked beside the files. No options means a checkbox, answered
 * `"true"` or `"false"`.
 */
export type FileChoice = {
  id: string;
  /** The option id, or `"true"`/`"false"`, selected at first. */
  initial: string;
  label: string;
  options: readonly { id: string; label: string }[];
};

/** A file chooser's request. Paths are absolute. */
export type FileChooserBody = {
  /** The confirm button's label; the shell's own when absent. */
  acceptLabel: string | undefined;
  choices: readonly FileChoice[];
  /** The index in `filters` to start with. */
  currentFilter: number | undefined;
  /** The folder to start in; the home when absent. */
  currentFolder: string | undefined;
  /** The suggested name for {@link FileChooserMode.Save}. */
  currentName: string | undefined;
  /** Open a folder rather than a file. */
  directory: boolean;
  /** The names {@link FileChooserMode.SaveFiles} saves into the folder. */
  files: readonly string[];
  /** Empty accepts any file. */
  filters: readonly FileChooserFilter[];
  /** The user's home directory, where the picker's places are. */
  home: string;
  mode: FileChooserMode;
  multiple: boolean;
  title: string;
};

/** What the user chose in a file chooser. */
export type FileChosen = {
  /** Each {@link FileChoice}'s answer, by id. */
  choices: ReadonlyMap<string, string>;
  /** The index in the request's `filters` in use. */
  currentFilter: number | undefined;
  /** Absolute paths: the files, or the folder for `SaveFiles`. */
  paths: readonly string[];
};

/** A session change an inhibitor holds off. */
export enum Inhibited {
  Logout,
  UserSwitch,
  Suspend,
}

/** What an inhibitor holds off, and the application's reason. */
export type InhibitBody = {
  what: readonly Inhibited[];
  reason: string | undefined;
};

/** Input devices a session asks for or holds. */
export type Devices = {
  keyboard: boolean;
  pointer: boolean;
  touchscreen: boolean;
};

/** What a remote desktop session asks to control. */
export type RemoteDesktopBody = {
  devices: Devices;
  clipboard: boolean;
};

/** What an input capture session asks to take. */
export type InputCaptureBody = {
  devices: Devices;
};

/** Why an application asks for the user's name, in its own words. */
export type AccountBody = {
  reason: string | undefined;
};

export const PortalRequest = {
  Access: (base: PortalRequestBase, body: AccessBody) => ({
    ...base,
    body,
    kind: PortalKind.Access as const,
  }),
  Account: (base: PortalRequestBase, body: AccountBody) => ({
    ...base,
    body,
    kind: PortalKind.Account as const,
  }),
  AppChooser: (base: PortalRequestBase, body: AppChooserBody) => ({
    ...base,
    body,
    kind: PortalKind.AppChooser as const,
  }),
  FileChooser: (base: PortalRequestBase, body: FileChooserBody) => ({
    ...base,
    body,
    kind: PortalKind.FileChooser as const,
  }),
  Inhibit: (base: PortalRequestBase, body: InhibitBody) => ({
    ...base,
    body,
    kind: PortalKind.Inhibit as const,
  }),
  InputCapture: (base: PortalRequestBase, body: InputCaptureBody) => ({
    ...base,
    body,
    kind: PortalKind.InputCapture as const,
  }),
  RemoteDesktop: (base: PortalRequestBase, body: RemoteDesktopBody) => ({
    ...base,
    body,
    kind: PortalKind.RemoteDesktop as const,
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
  /**
   * The user allowed an {@link PortalKind.Access} or
   * {@link PortalKind.Account} request.
   */
  Access,
  /** The application the user picked in an {@link PortalKind.AppChooser}. */
  AppChooser,
  /** The user chose in a {@link PortalKind.FileChooser}. */
  FileChooser,
  /** The user granted a {@link PortalKind.RemoteDesktop} no more than it asked. */
  RemoteDesktop,
  /** The user allowed a {@link PortalKind.InputCapture} request. */
  InputCapture,
  /** The user stopped a {@link Capturing} session. */
  Stop,
  /** The user dismissed or denied the dialog. */
  Canceled,
  /** The shell has no dialog for this kind. */
  Refused,
}

export const PortalAnswer = {
  Access: () => ({ kind: PortalAnswerKind.Access as const }),
  /** `choice` must be one of the request's `choices`. */
  AppChooser: (choice: string) => ({
    choice,
    kind: PortalAnswerKind.AppChooser as const,
  }),
  Canceled: () => ({ kind: PortalAnswerKind.Canceled as const }),
  FileChooser: (chosen: FileChosen) => ({
    chosen,
    kind: PortalAnswerKind.FileChooser as const,
  }),
  InputCapture: () => ({ kind: PortalAnswerKind.InputCapture as const }),
  Refused: () => ({ kind: PortalAnswerKind.Refused as const }),
  RemoteDesktop: (devices: Devices, clipboard: boolean) => ({
    clipboard,
    devices,
    kind: PortalAnswerKind.RemoteDesktop as const,
  }),
  Stop: () => ({ kind: PortalAnswerKind.Stop as const }),
};

export type PortalAnswer = ReturnType<
  (typeof PortalAnswer)[keyof typeof PortalAnswer]
>;

export enum CapturingKind {
  /** An application controls input, and the clipboard when `clipboard` is set. */
  RemoteDesktop,
  /** An application takes the user's input once it crosses a screen edge. */
  InputCapture,
  /** A kind this SDK cannot parse. It can still be stopped. */
  Unknown,
}

/** What every capturing session carries. */
export type CapturingBase = {
  /** The id {@link stopCapturing} takes. */
  id: number;
  /** The application's desktop file id. Empty when unknown. */
  appId: string;
};

export const Capturing = {
  InputCapture: (base: CapturingBase, body: InputCaptureBody) => ({
    ...base,
    ...body,
    kind: CapturingKind.InputCapture as const,
  }),
  RemoteDesktop: (base: CapturingBase, body: RemoteDesktopBody) => ({
    ...base,
    ...body,
    kind: CapturingKind.RemoteDesktop as const,
  }),
  Unknown: (base: CapturingBase, wireKind: string) => ({
    ...base,
    kind: CapturingKind.Unknown as const,
    wireKind,
  }),
};

export type Capturing = ReturnType<(typeof Capturing)[keyof typeof Capturing]>;

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

/**
 * Call `listener` with every session that controls or captures input, on each
 * change. Returns a function that stops listening.
 */
export const watchCapturing = (
  host: PortalHost,
  listener: (sessions: readonly Capturing[]) => void,
): (() => void) => {
  const heard = (event: MessageEvent<string>) => {
    listener(
      requestsSchema
        .parse(JSON.parse(event.data))
        .capturing.map((item) => parseCapturing(item)),
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
  host.answerPortalRequest(id, JSON.stringify(wireAnswer(answer)));
};

/** End capturing session `id`. */
export const stopCapturing = (host: PortalHost, id: number): void => {
  answerPortalRequest(host, id, PortalAnswer.Stop());
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

const appChooserSchema = z
  .object({
    choices: z.array(z.string()),
    content_type: z.string().optional(),
    filename: z.string().optional(),
    last_choice: z.string().optional(),
    uri: z.string().optional(),
  })
  .transform(
    (body): AppChooserBody => ({
      choices: body.choices,
      contentType: body.content_type,
      filename: body.filename,
      lastChoice: body.last_choice,
      uri: body.uri,
    }),
  );

const fileChooserSchema = z
  .object({
    accept_label: z.string().optional(),
    choices: z.array(
      z.object({
        id: z.string(),
        initial: z.string(),
        label: z.string(),
        options: z.array(z.object({ id: z.string(), label: z.string() })),
      }),
    ),
    current_filter: z.number().optional(),
    current_folder: z.string().optional(),
    current_name: z.string().optional(),
    directory: z.boolean(),
    files: z.array(z.string()),
    filters: z.array(
      z.object({ extensions: z.array(z.string()), name: z.string() }),
    ),
    home: z.string(),
    mode: z.enum(["open", "save", "save_files"]),
    multiple: z.boolean(),
    title: z.string(),
  })
  .transform(
    (body): FileChooserBody => ({
      acceptLabel: body.accept_label,
      choices: body.choices,
      currentFilter: body.current_filter,
      currentFolder: body.current_folder,
      currentName: body.current_name,
      directory: body.directory,
      files: body.files,
      filters: body.filters,
      home: body.home,
      mode: chooserMode(body.mode),
      multiple: body.multiple,
      title: body.title,
    }),
  );

const INHIBITED = {
  logout: Inhibited.Logout,
  suspend: Inhibited.Suspend,
  user_switch: Inhibited.UserSwitch,
} as const;

const inhibitSchema = z
  .object({
    reason: z.string().optional(),
    what: z.array(z.enum(["logout", "user_switch", "suspend"])),
  })
  .transform(
    (body): InhibitBody => ({
      reason: body.reason,
      what: body.what.map((inhibited) => INHIBITED[inhibited]),
    }),
  );

const devicesSchema = z.object({
  keyboard: z.boolean(),
  pointer: z.boolean(),
  touchscreen: z.boolean(),
});

const remoteDesktopSchema = z.object({
  clipboard: z.boolean(),
  devices: devicesSchema,
});

const inputCaptureSchema = z.object({ devices: devicesSchema });

const accountSchema = z
  .object({ reason: z.string().optional() })
  .transform((body): AccountBody => ({ reason: body.reason }));

/** Reads one kind's body into a request. */
type ReadKind = (base: PortalRequestBase, body: unknown) => PortalRequest;

/** Each kind's wire name, and how to read its body into a request. */
const KINDS: ReadonlyMap<string, ReadKind> = new Map<string, ReadKind>([
  [
    "access",
    (base, body) => PortalRequest.Access(base, accessSchema.parse(body)),
  ],
  [
    "app_chooser",
    (base, body) =>
      PortalRequest.AppChooser(base, appChooserSchema.parse(body)),
  ],
  [
    "file_chooser",
    (base, body) =>
      PortalRequest.FileChooser(base, fileChooserSchema.parse(body)),
  ],
  [
    "inhibit",
    (base: PortalRequestBase, body: unknown) =>
      PortalRequest.Inhibit(base, inhibitSchema.parse(body)),
  ],
  [
    "remote_desktop",
    (base, body) =>
      PortalRequest.RemoteDesktop(base, remoteDesktopSchema.parse(body)),
  ],
  [
    "input_capture",
    (base, body) =>
      PortalRequest.InputCapture(base, inputCaptureSchema.parse(body)),
  ],
  [
    "account",
    (base, body) => PortalRequest.Account(base, accountSchema.parse(body)),
  ],
]);

type ReadCapturing = (base: CapturingBase, body: unknown) => Capturing;

/** Each capturing kind's wire name, and how to read its body into a session. */
const CAPTURING_KINDS: ReadonlyMap<string, ReadCapturing> = new Map<
  string,
  ReadCapturing
>([
  [
    "remote_desktop",
    (base, body) =>
      Capturing.RemoteDesktop(base, remoteDesktopSchema.parse(body)),
  ],
  [
    "input_capture",
    (base, body) =>
      Capturing.InputCapture(base, inputCaptureSchema.parse(body)),
  ],
]);

const itemSchema = z.object({
  app_id: z.string(),
  body: z.unknown(),
  id: z.number(),
  kind: z.string(),
  parent_app_id: z.string().optional(),
});

const capturingSchema = z.object({
  app_id: z.string(),
  body: z.unknown(),
  id: z.number(),
  kind: z.string(),
});

const requestsSchema = z.object({
  // Optional on the wire, so a line without it parses.
  capturing: z.array(capturingSchema).default([]),
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

const chooserMode = (mode: "open" | "save" | "save_files"): FileChooserMode => {
  switch (mode) {
    case "open":
      return FileChooserMode.Open;
    case "save":
      return FileChooserMode.Save;
    case "save_files":
      return FileChooserMode.SaveFiles;
  }
};

const parseCapturing = (item: z.infer<typeof capturingSchema>): Capturing => {
  const base = { appId: item.app_id, id: item.id };
  const parse = CAPTURING_KINDS.get(item.kind);
  return parse === undefined
    ? Capturing.Unknown(base, item.kind)
    : parse(base, item.body);
};

/** `answer` as the compositor reads it. */
const wireAnswer = (answer: PortalAnswer): object => {
  switch (answer.kind) {
    case PortalAnswerKind.Access:
      return { kind: "access" };
    case PortalAnswerKind.AppChooser:
      return { choice: answer.choice, kind: "app_chooser" };
    case PortalAnswerKind.RemoteDesktop:
      return {
        clipboard: answer.clipboard,
        devices: answer.devices,
        kind: "remote_desktop",
      };
    case PortalAnswerKind.InputCapture:
      return { kind: "input_capture" };
    case PortalAnswerKind.Stop:
      return { kind: "stop" };
    case PortalAnswerKind.Canceled:
      return { kind: "canceled" };
    case PortalAnswerKind.FileChooser:
      return {
        choices: Object.fromEntries(answer.chosen.choices),
        current_filter: answer.chosen.currentFilter,
        kind: "file_chooser",
        paths: answer.chosen.paths,
      };
    case PortalAnswerKind.Refused:
      return { kind: "refused" };
  }
};
