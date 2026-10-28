// The shell guard-browser-brand.sh drives. Reports the brands the engine
// gives sites in `navigator.userAgentData`, which are also its `Sec-CH-UA`
// header:
//
//   GUARD brands <brand>,<brand>,...
//
// Sorted, with Chromium's random GREASE brand left out. `Chromium` is the
// control: every build sends it, so its absence means this page cannot see
// the brands.

export const HostShell = () => {
  console.log(
    `GUARD brands ${navigator.userAgentData.brands
      .map(({ brand }) => brand)
      .filter((brand) => !brand.includes("Brand"))
      .toSorted()
      .join(",")}`,
  );
};
