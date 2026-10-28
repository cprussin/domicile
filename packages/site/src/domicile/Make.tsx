import { Builder } from "../make/Builder";
import { Section } from "../page/Section";

/** "Make your own desktop": the page's live builder. */
export const Make = () => (
  <Section
    id="make"
    lede="Start from a window model, then change anything. It's a web page, so the whole world of React and CSS is yours: Tailwind, shadcn/ui, Framer Motion, three.js, anything on npm. When you like it, run it for real."
    title="Make your own desktop."
  >
    <Builder />
  </Section>
);
