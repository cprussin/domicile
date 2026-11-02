// domicile-desktop.com/_matrix/federation/v1/query/directory: a Matrix server
// resolving #domicile:domicile-desktop.com asks here for the room to join.
// Only the alias lookup is served; the room lives on prussin.net.

import { ALIAS, ROOM_ID, SERVERS } from "../../../../../../matrix/room";

export const GET = (request: Request): Response =>
  new URL(request.url).searchParams.get("room_alias") === ALIAS
    ? Response.json({ room_id: ROOM_ID, servers: SERVERS })
    : Response.json(
        { errcode: "M_NOT_FOUND", error: "Room alias not found" },
        { status: 404 },
      );
