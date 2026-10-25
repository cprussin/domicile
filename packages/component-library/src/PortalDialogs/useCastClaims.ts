import type { CastClaim } from "@domicile-desktop/sdk/cast";
import { CastClaimKind, claimCastRequest } from "@domicile-desktop/sdk/cast";
import type { PortalHost, PortalRequest } from "@domicile-desktop/sdk/portal";
import { answerPortalRequest } from "@domicile-desktop/sdk/portal";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * The requests among `requests` that a cast to a TV asked for, by id. Answers
 * the ones it can as each arrives, before it would show. See
 * docs/architecture/CASTING-TO-TVS.md.
 */
export const useCastClaims = (
  host: PortalHost,
  requests: readonly PortalRequest[],
): ReadonlyMap<number, CastClaim> => {
  // Every request seen, claimed or not: each is claimed once.
  const seen = useRef(new Map<number, CastClaim | undefined>());
  const [claims, setClaims] = useState<ReadonlyMap<number, CastClaim>>(
    () => new Map(),
  );

  // Before paint, so a claimed request never shows as an application's.
  useLayoutEffect(() => {
    const known = seen.current;
    const asked = new Set(requests.map(({ id }) => id));
    for (const id of known.keys()) {
      if (!asked.has(id)) {
        known.delete(id);
      }
    }
    for (const request of requests) {
      if (!known.has(request.id)) {
        const claim = claimCastRequest(host, request);
        known.set(request.id, claim);
        if (claim?.kind === CastClaimKind.Answered) {
          answerPortalRequest(host, request.id, claim.answer);
        }
      }
    }
    setClaims(
      new Map(
        [...known].flatMap(([id, claim]) =>
          claim === undefined ? [] : [[id, claim] as const],
        ),
      ),
    );
  }, [host, requests]);

  return claims;
};
