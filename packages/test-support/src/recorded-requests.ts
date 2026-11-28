// A fake service for tests: each request it gets is recorded, then answered.

/** A request as a test sees it: its name and what it named. */
export type Asked = [string, ...unknown[]];

/**
 * Records each request `ask` gets in `asked`, in order, and answers it with
 * `answer`.
 */
export const recordedRequests = <Answer>(answer: (asked: Asked) => Answer) => {
  const asked: Asked[] = [];
  const ask = (request: Asked): Promise<Answer> => {
    asked.push(request);
    return Promise.resolve(answer(request));
  };
  return { ask, asked };
};
