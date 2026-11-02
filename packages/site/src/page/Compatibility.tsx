import { css } from "../../styled-system/css";

/** One line on what Domicile runs on, beside the install steps. */
export const Compatibility = () => (
  <p className={noteStyles}>
    Runs on <code>x86_64</code> Linux. Wayland apps only, with no Xwayland.
    Checked on NVIDIA, AMD and Intel GPUs.{" "}
    <a className={linkStyles} href="/docs/manganese/compatibility">
      What it runs on
    </a>
  </p>
);

const noteStyles = css({ color: "muted", fontSize: "sm" });

const linkStyles = css({ color: "foreground", textDecoration: "underline" });
