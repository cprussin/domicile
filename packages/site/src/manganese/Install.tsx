import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { CodeBlock } from "../code/CodeBlock";
import type { Language } from "../code/highlight";
import { repoFile } from "../page/repo";
import { Section } from "../page/Section";
import { Tabs } from "../page/Tabs";

// The apt and rpm repositories at packages.domicile-desktop.com are not up
// yet (cprussin/domicile#1399); their lines say so.
const DISTROS: readonly {
  id: string;
  name: string;
  code: string;
  language: Language;
  note: string;
}[] = [
  {
    code: "nix run github:cprussin/domicile/stable#manganese",
    id: "nix",
    language: "bash",
    name: "Nix",
    note: "Runs manganese in a window on your current desktop.",
  },
  {
    code: 'imports = [domicile.nixosModules.default];\nprograms.domicile.enable = true;\nservices.displayManager.defaultSession = "domicile";',
    id: "nixos",
    language: "plain",
    name: "NixOS",
    note: "Adds the login session, PAM and the domicile group. homeManagerModules.default writes your config.",
  },
  {
    code: "# add the packages.domicile-desktop.com apt source\nsudo apt install domicile",
    id: "deb",
    language: "bash",
    name: "Debian / Ubuntu",
    note: "For Debian 13+ and Ubuntu 24.04+. Then join the domicile group and pick the Domicile session at login.",
  },
  {
    code: "# add the packages.domicile-desktop.com .repo file\nsudo dnf install domicile",
    id: "fedora",
    language: "bash",
    name: "Fedora",
    note: "For Fedora and RHEL 10+. Then join the domicile group and pick the Domicile session at login.",
  },
  {
    code: "# add the packages.domicile-desktop.com .repo file\nsudo zypper install domicile",
    id: "suse",
    language: "bash",
    name: "openSUSE",
    note: "For Tumbleweed. Then join the domicile group and pick the Domicile session at login.",
  },
  {
    code: "yay -S domicile-bin",
    id: "arch",
    language: "bash",
    name: "Arch",
    note: "From the AUR. Then join the domicile group and pick the Domicile session at login.",
  },
];

/** How to install, per distribution. */
export const Install = () => (
  <Section
    id="install"
    lede="Try it in a window on your current desktop, or log in to it."
    title="Install"
  >
    <Tabs
      aria-label="Distribution"
      defaultValue="nix"
      size="lg"
      tabs={DISTROS.map((distro) => ({
        content: (
          <div className={panelStyles}>
            <CodeBlock code={distro.code} language={distro.language} />
            <p className={noteStyles}>{distro.note}</p>
            <a
              className={linkStyles}
              href={repoFile("docs/RUNNING-A-DESKTOP.md")}
            >
              Full install guide →
            </a>
          </div>
        ),
        label: distro.name,
        value: distro.id,
      }))}
    />
  </Section>
);

const panelStyles = flex({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "xl",
  direction: "column",
  gap: 3.5,
  marginBlockStart: 4,
  padding: 6,
});

const noteStyles = css({ color: "muted", fontSize: "sm" });

const linkStyles = css({
  color: "accent",
  fontSize: "sm",
  fontWeight: "semibold",
});
