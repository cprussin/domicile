import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
import { css } from "@domicile-desktop/manganese/css";
import "./style.css";

const Mail = () => <span className={css({ color: "rgb(1, 2, 3)" })}>mail</span>;

export const Shell = runManganese({
  bar: { ...DEFAULT_BAR, center: [<Mail key="mail" />] },
});
