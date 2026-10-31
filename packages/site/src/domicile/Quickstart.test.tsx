import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Quickstart } from "./Quickstart";

const html = renderToStaticMarkup(<Quickstart />);

test("installs from the install guide, repository setup included", () => {
  expect(html).toContain(
    "https://packages.domicile-desktop.com/apt current main",
  );
  for (const distro of ["Fedora", "openSUSE", "Arch", "NixOS"]) {
    expect(html).toContain(`>${distro}<`);
  }
});

test("ends with making the shell the login session's", () => {
  const text = html.replace(/<[^>]+>/g, "");
  expect(text).toContain("~/.config/domicile/domicile.json");
  expect(text).toContain("{ &quot;shell&quot;: &quot;./shell.tsx&quot; }");
});
