import { mount } from "./layout.js";

export const Shell = (root, domicile) =>
  mount(root, domicile, "main { grid-template-rows: 1fr 1fr; }");
