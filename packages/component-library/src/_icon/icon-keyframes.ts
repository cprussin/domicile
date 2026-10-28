/**
 * Keyframes for the parts of animated icons. Lengths are on the icons'
 * 256-unit grid, which `transform-box: view-box` makes their `px`.
 */
export const iconKeyframes = {
  // A Wi-Fi arc dims and comes back.
  iconArcRipple: {
    "0%, 100%": { opacity: "1" },
    "50%": { opacity: "0.4" },
  },
  // A Wi-Fi arc while connecting: dim, lit, dim, on a loop.
  iconArcSearch: {
    "0%, 100%": { opacity: "0.25" },
    "50%": { opacity: "1" },
  },
  // A plus's arm reaches out along its direction, and back.
  iconArmReach: {
    "0%, 100%": { transform: "none" },
    "50%": {
      transform:
        "scale(calc(1 + var(--part-x) * 0.18), calc(1 + var(--part-y) * 0.18))",
    },
  },
  // An arm swings `--swing` the way its direction says, and back: an X
  // snipping, a caret's point sharpening.
  iconArmSwing: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "rotate(calc(var(--part-x) * var(--swing)))" },
  },
  // A reload arrow winds forward, and back.
  iconArrowWind: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "rotate(40deg)" },
  },
  // The bell's clapper, lagging the swing.
  iconBellClapper: {
    "0%, 100%": { transform: "none" },
    "20%": { transform: "translateX(-10px)" },
    "40%": { transform: "translateX(9px)" },
    "60%": { transform: "translateX(-6px)" },
    "80%": { transform: "translateX(3px)" },
  },
  // The bell pointed at: one small swing.
  iconBellNudge: {
    "0%, 100%": { transform: "none" },
    "35%": { transform: "rotate(7deg)" },
    "70%": { transform: "rotate(-4deg)" },
  },
  // The bell on a new notification, swinging from its top.
  iconBellSwing: {
    "0%, 100%": { transform: "none" },
    "20%": { transform: "rotate(14deg)" },
    "40%": { transform: "rotate(-11deg)" },
    "60%": { transform: "rotate(7deg)" },
    "80%": { transform: "rotate(-4deg)" },
  },
  // The bolt strikes down from its top, then flickers.
  iconBoltStrike: {
    "0%": { clipPath: "inset(0 0 100% 0)", opacity: "1" },
    "45%": { clipPath: "inset(0)", opacity: "1" },
    "70%": { clipPath: "inset(0)", opacity: "0.45" },
    "100%": { clipPath: "inset(0)", opacity: "1" },
  },
  // A chat bubble tips on its tail.
  iconBubbleTip: {
    "0%, 100%": { transform: "none" },
    "35%": { transform: "rotate(-8deg)" },
    "70%": { transform: "rotate(3deg)" },
  },
  // The microphone's capsule bobs.
  iconCapsuleBob: {
    "0%, 100%": { transform: "none" },
    "40%": { transform: "translateY(-10px)" },
    "75%": { transform: "translateY(2px)" },
  },
  // The check draws from its start.
  iconCheckDraw: {
    "0%": { clipPath: "inset(0 100% 0 0)" },
    "100%": { clipPath: "inset(0)" },
  },
  // The sun's core, going and coming back.
  iconCoreIn: {
    "0%": { opacity: "0", transform: "scale(0.6)" },
    "100%": { opacity: "1", transform: "none" },
  },
  iconCoreOut: {
    "0%": { opacity: "1", transform: "none" },
    "100%": { opacity: "0", transform: "scale(0.6)" },
  },
  // A Bluetooth dot blinks.
  iconDotBlink: {
    "0%, 100%": { opacity: "1" },
    "50%": { opacity: "0.25" },
  },
  // A download's arrow drops into its tray.
  iconDownloadDrop: {
    "0%": { opacity: "0", transform: "translateY(-60px)" },
    "70%": { opacity: "1", transform: "translateY(10px)" },
    "100%": { opacity: "1", transform: "none" },
  },
  // The gear turns one tooth. Its six teeth make the end look like the start.
  iconGearTurn: {
    "0%": { transform: "none" },
    "100%": { transform: "rotate(60deg)" },
  },
  // A lock's keyhole swells as its shackle shuts.
  iconKeyholePulse: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "scale(1.35)" },
  },
  // A key presses down.
  iconKeyPress: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "translateY(7px)" },
  },
  // A chat line writes in from its start.
  iconLineWrite: {
    "0%": { transform: "scaleX(0)" },
    "100%": { transform: "none" },
  },
  // The moon, turning into place and away.
  iconMoonIn: {
    "0%": { opacity: "0", transform: "rotate(-60deg) scale(0.6)" },
    "100%": { opacity: "1", transform: "none" },
  },
  iconMoonOut: {
    "0%": { opacity: "1", transform: "none" },
    "100%": { opacity: "0", transform: "rotate(-60deg) scale(0.6)" },
  },
  // The moon rocks.
  iconMoonRock: {
    "0%, 100%": { transform: "none" },
    "35%": { transform: "rotate(-12deg)" },
    "70%": { transform: "rotate(5deg)" },
  },
  // A part moves `--spread` out along its direction (see `IconPart`), and
  // back.
  iconPartSpread: {
    "0%, 100%": { transform: "none" },
    "50%": {
      transform:
        "translate(calc(var(--part-x) * var(--spread)), calc(var(--part-y) * var(--spread)))",
    },
  },
  // The eye's pupil looks one way, then the other.
  iconPupilGlance: {
    "0%, 100%": { transform: "none" },
    "20%, 40%": { transform: "translateX(-14px)" },
    "60%, 80%": { transform: "translateX(12px)" },
  },
  // A sun ray, folding in and coming back out.
  iconRayIn: {
    "0%": { opacity: "0", transform: "scale(0.5) rotate(30deg)" },
    "100%": { opacity: "1", transform: "none" },
  },
  iconRayOut: {
    "0%": { opacity: "1", transform: "none" },
    "100%": { opacity: "0", transform: "scale(0.5) rotate(30deg)" },
  },
  // A sun ray draws in and back.
  iconRayPulse: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "scale(0.88)" },
  },
  // A lock's shackle lifts a little, and back.
  iconShackleLift: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "translateY(-14px)" },
  },
  // A lock's shackle snaps shut from open.
  iconShackleShut: {
    "0%": { transform: "translateY(-30px)" },
    "70%": { transform: "translateY(4px)" },
    "100%": { transform: "none" },
  },
  // A download's tray gives under the arrow landing in it.
  iconTrayGive: {
    "0%, 100%": { transform: "none" },
    "70%": { transform: "scaleY(0.86)" },
  },
  // A speaker wave pulls in, for quieter.
  iconWavePull: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "translateX(-5px)" },
  },
  // A speaker wave pushes out, for louder or pointed at.
  iconWavePush: {
    "0%, 100%": { transform: "none" },
    "50%": { transform: "translateX(8px)" },
  },
};
