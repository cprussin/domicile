// Counts the shell document's frames from the moment guard-shell-handover.js
// starts loading. Its own module, so it runs before that one's wait.

let frames = 0;
const count = () => {
  frames += 1;
  requestAnimationFrame(count);
};
requestAnimationFrame(count);

/** The frames drawn so far. */
export const framesSoFar = () => frames;
