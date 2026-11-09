// The shell for guard-animation-main-frames.sh. It slides a box across the
// viewport with a composited `transform` animation and counts the
// IntersectionObserver callbacks for it while the animation plays.
//
// An observer runs in the main thread's frames. The compositor thread runs
// the animation without them, so a desk that does not force main frames
// delivers a callback or two, not one each frame.
//
// It logs to the console, which the engine writes to its log:
//
//   GUARD shell-loaded           this module ran
//   GUARD sliding                the animation started
//   GUARD slid callbacks=N       it ended, after N callbacks while it played
//
// Everything is inside `HostShell`, which Domicile's document calls once the
// module loads.

export const HostShell = () => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  document.body.style.margin = "0";
  const box = document.createElement("div");
  box.style.position = "absolute";
  box.style.inset = "0";
  box.style.background = "#336";
  document.body.append(box);
  const style = document.createElement("style");
  style.textContent =
    "@keyframes guard-slide { from { transform: translateX(100%); } }";
  document.head.append(style);

  // One threshold per hundredth, so each frame of the slide crosses one.
  const thresholds = Array.from({ length: 101 }, (_, step) => step / 100);
  let sliding = false;
  let callbacks = 0;
  new IntersectionObserver(
    () => {
      if (sliding) {
        callbacks += 1;
      }
    },
    { threshold: thresholds },
  ).observe(box);

  // Waits for the first frames to settle, so the observer's first callback
  // falls outside the slide.
  setTimeout(() => {
    sliding = true;
    say("sliding");
    box.addEventListener(
      "animationend",
      () => {
        sliding = false;
        say(`slid callbacks=${callbacks}`);
      },
      { once: true },
    );
    box.style.animation = "guard-slide 1000ms linear";
  }, 2000);

  say("shell-loaded");
};
