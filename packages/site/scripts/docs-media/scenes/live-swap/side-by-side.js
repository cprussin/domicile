import { mount } from "./layout.js";

export const Shell = (root, domicile) =>
  mount(root, domicile, "main { grid-template-columns: 1fr 1fr; }");
