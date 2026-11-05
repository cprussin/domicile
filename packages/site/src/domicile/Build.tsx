import { Section } from "../page/Section";
import { HeroMedia } from "./HeroMedia";

/** The developer platform: a desktop, and the code that draws it. */
export const Build = () => (
  <Section
    id="build"
    lede="When the browser engine is the desktop, the whole web platform is there to build one with: HTML and CSS, JavaScript or TypeScript, React or any other framework, and anything on npm. Here's a whole desktop, with the code that draws it."
    title="Build something weird."
  >
    <HeroMedia />
  </Section>
);
