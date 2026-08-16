// A tiny bit of live chrome, to prove ordinary CSS and JS run in the shell.

const TICK_INTERVAL_MS = 1000;

/**
 * Render the wall clock into `element` and keep it current.
 *
 * @param now - Injected by tests so the rendered text is deterministic.
 * @returns A teardown that stops the interval.
 */
export const installClock = (
  element: Element,
  now: () => Date = () => new Date(),
): (() => void) => {
  const tick = (): void => {
    element.textContent = now().toLocaleTimeString();
  };
  tick();
  const timer = setInterval(tick, TICK_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
};
