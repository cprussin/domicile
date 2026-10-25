import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import { appDesktop } from "./desktop/app-desktop";
import type { DomicileAppHost } from "./domicile-host";
import { FileType } from "./system";

/** An app's host that answers each call as the compositor would. */
class FakeAppHost implements DomicileAppHost {
  onsystem: ((event: MessageEvent<string>) => void) | null = null;
  readonly #listeners: ((event: MessageEvent<string>) => void)[] = [];

  callSystem(id: number, _request: string): void {
    const event = new MessageEvent("system", {
      data: JSON.stringify({
        id,
        reply: { file_type: "file", kind: "stat", modified_ms: null, size: 4 },
        type: "system_reply",
      }),
    });
    queueMicrotask(() => {
      for (const listener of this.#listeners) {
        listener(event);
      }
    });
  }

  addEventListener(
    _type: "system",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.push(listener);
  }

  removeEventListener(
    _type: "system",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.splice(this.#listeners.indexOf(listener), 1);
  }
}

describe("an app's host", () => {
  it("makes system calls through its desktop", async () => {
    const stat = await appDesktop(new FakeAppHost()).files.stat("notes.txt");

    expect(stat).toStrictEqual(
      Ok({ fileType: FileType.File, modifiedMs: undefined, size: 4 }),
    );
  });
});
