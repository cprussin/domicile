import { Builder } from "../make/Builder";
import { Section } from "../page/Section";

/** "Make your own desktop": the page's live builder. */
export const Make = () => (
  <Section
    id="make"
    lede="Try it here. Start from a window model, then change anything: it's a web page, so Tailwind, shadcn/ui, Framer Motion and three.js all work. When you like it, run it for real."
    title="Make your own desktop."
  >
    <Builder />
  </Section>
);
