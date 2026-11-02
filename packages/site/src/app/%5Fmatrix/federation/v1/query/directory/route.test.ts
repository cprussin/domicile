import { describe, expect, test } from "bun:test";

import { ROOM_ID } from "../../../../../../matrix/room";
import { GET } from "./route";

const query = (alias: string): Request =>
  new Request(
    `https://domicile-desktop.com/_matrix/federation/v1/query/directory?room_alias=${encodeURIComponent(alias)}`,
  );

describe("the room alias lookup", () => {
  test("answers #domicile with the room and servers to join through", async () => {
    const response = GET(query("#domicile:domicile-desktop.com"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      room_id: ROOM_ID,
      servers: ["prussin.net", "matrix.org"],
    });
  });

  test("answers any other alias with M_NOT_FOUND", async () => {
    const response = GET(query("#other:domicile-desktop.com"));

    expect(response.status).toBe(404);
    expect((await response.json()).errcode).toBe("M_NOT_FOUND");
  });
});
