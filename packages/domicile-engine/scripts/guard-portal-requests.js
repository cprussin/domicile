// The shell guard-portal-requests.sh drives. It binds the channel, waits until
// the compositor stand-in's requests have reached the page, and only then
// listens for `portalrequests`, so only the replay to a late listener can
// deliver them. It answers the request twice, the first answer malformed:
//
//   GUARD listening                    the channel is bound
//   GUARD portal heard=<id>:<kind>:<app>

const answer = (host, event) => {
  const [request] = JSON.parse(event.data).items;
  // The browser drops this one: it has no `kind`. Sent first, so the stand-in
  // would hear it before the real answer.
  host.answerPortalRequest(request.id, JSON.stringify({ no: "kind" }));
  host.answerPortalRequest(request.id, JSON.stringify({ kind: "access" }));
  console.log(
    `GUARD portal heard=${request.id}:${request.kind}:${request.app_id}`,
  );
};

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-portal-requests: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  // Reading binds the channel, which is what has the compositor speak.
  void host.windows;
  console.log("GUARD listening");

  // The stand-in sends `idle` after the requests, on the same socket, so once
  // `idle` is set the requests have reached this page.
  const waiting = setInterval(() => {
    if (host.idle === true) {
      clearInterval(waiting);
      host.addEventListener(
        "portalrequests",
        (event) => {
          answer(host, event);
        },
        { once: true },
      );
    }
  }, 100);
};
