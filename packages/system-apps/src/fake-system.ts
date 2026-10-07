// A `System` over an in-memory tree, for a shell's tests.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DirEntry,
  Ran,
  Stat,
  Subprocess,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

/**
 * A file's contents, a symlink to another path in the tree, or a path every
 * call on fails.
 */
export type Node =
  | string
  | Uint8Array
  | { linksTo: string }
  | { fails: SystemErrorKind };

/** What a spawned argv writes and how it ends. */
export type Spawned = {
  stdout: Uint8Array | string;
  stderr: string;
  code: number;
};

export type FakeSystem = System & {
  /** Every path read, listed or statted, in order. */
  touched: string[];
};

type Tree = Readonly<Record<string, Node>>;

/**
 * A system whose files are `tree`, keyed by path, with the directories
 * between them implied. `spawned` answers `spawn` and `run`.
 */
export const fakeSystem = (
  tree: Tree,
  spawned: (argv: readonly string[]) => Spawned = unexpected,
): FakeSystem => {
  const touched: string[] = [];
  const at = (path: string): Result<Found, SystemError> => {
    touched.push(path);
    return found(tree, path);
  };
  const readFile = (path: string): Result<Uint8Array, SystemError> =>
    at(path).andThen((node) =>
      typeof node === "string" || node instanceof Uint8Array
        ? Ok(bytesOf(node))
        : Err({ kind: SystemErrorKind.IsADirectory, message: path }),
    );
  return {
    dbusCall: unexpected,
    dbusMatch: unexpected,
    readDir: (path) =>
      Promise.resolve(
        at(path).andThen((node) =>
          typeof node === "string" || node instanceof Uint8Array
            ? Err({ kind: SystemErrorKind.NotADirectory, message: path })
            : Ok(listing(tree, node.directory)),
        ),
      ),
    readFile: (path) => Promise.resolve(readFile(path)),
    readTextFile: (path) =>
      Promise.resolve(
        readFile(path).map((bytes) => new TextDecoder().decode(bytes)),
      ),
    run: (argv) => {
      const { code, stderr, stdout } = spawned(argv);
      const ran: Ran = {
        code,
        signal: undefined,
        stderr,
        stdout: new TextDecoder().decode(bytesOf(stdout)),
      };
      return Promise.resolve(Ok(ran));
    },
    screenshot: unexpected,
    spawn: (argv) => Promise.resolve(Ok(subprocess(spawned(argv)))),
    stat: (path) =>
      Promise.resolve(
        at(path).map(
          (node): Stat =>
            typeof node === "string" || node instanceof Uint8Array
              ? {
                  fileType: FileType.File,
                  modifiedMs: undefined,
                  size: bytesOf(node).byteLength,
                }
              : {
                  fileType: FileType.Directory,
                  modifiedMs: undefined,
                  size: 0,
                },
        ),
      ),
    touched,
    watch: unexpected,
    writeFile: unexpected,
  };
};

/** A file's contents, or the directory a path resolved to. */
type Found = string | Uint8Array | { directory: string };

/** What is at `path`, following symlinks. */
const found = (tree: Tree, path: string): Result<Found, SystemError> => {
  const node = tree[path];
  const linkedParent = Object.entries(tree)
    .flatMap(([link, each]) =>
      typeof each === "object" && "linksTo" in each
        ? [{ link, to: each.linksTo }]
        : [],
    )
    .find(({ link }) => path.startsWith(`${link}/`));
  if (linkedParent !== undefined) {
    const { link, to } = linkedParent;
    return found(tree, `${to}${path.slice(link.length)}`);
  } else if (node === undefined) {
    return Object.keys(tree).some((each) => each.startsWith(`${path}/`))
      ? Ok({ directory: path })
      : Err({ kind: SystemErrorKind.NotFound, message: path });
  } else if (typeof node === "string" || node instanceof Uint8Array) {
    return Ok(node);
  } else {
    return "linksTo" in node
      ? found(tree, node.linksTo)
      : Err({ kind: node.fails, message: path });
  }
};

const listing = (tree: Tree, path: string): DirEntry[] => {
  const names = new Map<string, FileType>();
  for (const [each, node] of Object.entries(tree)) {
    if (each.startsWith(`${path}/`)) {
      const [name = "", ...below] = each.slice(path.length + 1).split("/");
      names.set(name, below.length > 0 ? FileType.Directory : ownType(node));
    }
  }
  return [...names].map(([name, fileType]) => ({ fileType, name }));
};

/** A node's type without following it. */
const ownType = (node: Node): FileType =>
  typeof node === "object" && "linksTo" in node
    ? FileType.Symlink
    : FileType.File;

const subprocess = ({ code, stderr, stdout }: Spawned): Subprocess => ({
  closeStdin: unexpected,
  exited: Promise.resolve(Ok({ code, signal: undefined })),
  kill: unexpected,
  stderr: streamOf(bytesOf(stderr)),
  stdout: streamOf(bytesOf(stdout)),
  write: unexpected,
});

const bytesOf = (data: string | Uint8Array): Uint8Array =>
  typeof data === "string" ? new TextEncoder().encode(data) : data;

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const unexpected = (): never => {
  throw new Error("the code under test made a call this fake does not take");
};
