import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type { BrowserProfile } from "@domicile-desktop/sdk/desktop/browser";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import type { CSSProperties } from "react";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";

type Props = {
  /** Moves the page to profile `id`, in place. */
  onMove: (id: string) => void;
  /** Opens the page's address in a new window of profile `id`. */
  onOpenInNew: (id: string) => void;
  /** The page's profile. */
  profile: BrowserProfile;
  /** Every profile, in the config's order. */
  profiles: readonly BrowserProfile[];
  /**
   * The page's address. Must come from the same report as the page's other
   * address bar parts (see `useShownPage`).
   */
  url: string;
};

/**
 * The profile button at the start of the address bar: the page's profile in
 * its color, with a menu to move the page to another profile or open it in a
 * new window of one. See docs/architecture/BROWSER-PROFILES.md.
 */
export const ProfileMenu = ({
  onMove,
  onOpenInNew,
  profile,
  profiles,
  url,
}: Props) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      align="start"
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      title={
        <span className={headingStyles}>
          <span aria-hidden className={dotStyles} style={colored(profile)} />
          {profile.name}
        </span>
      }
      tooltip="Browser profile"
      trigger={
        <button
          aria-label={`Browser profile: ${profile.name}`}
          className={chipStyles}
          style={colored(profile)}
          type="button"
        >
          {profile.name}
          <CaretDownIcon size={11} weight="bold" />
        </button>
      }
      wide
    >
      <PanelSection label="Profiles">
        <List>
          {profiles.map((each) => {
            const current = each.id === profile.id;
            const row = {
              actions: (
                <Tooltip
                  content={`Open in a new ${each.name} window`}
                  trigger={
                    <IconButton
                      label={`Open in a new ${each.name} window`}
                      onClick={() => {
                        setOpen(false);
                        onOpenInNew(each.id);
                      }}
                      size="sm"
                    >
                      <ArrowSquareOutIcon />
                    </IconButton>
                  }
                />
              ),
              end: current ? (
                <CheckIcon aria-label="Current" className={checkStyles} />
              ) : undefined,
              icon: (
                <span aria-hidden className={dotStyles} style={colored(each)} />
              ),
              label: each.name,
            };
            return (
              <ListRow
                key={each.id}
                {...row}
                name={
                  current
                    ? `${each.name}, this page's profile`
                    : `Move this page to ${each.name}`
                }
                onPress={() => {
                  setOpen(false);
                  if (!current) {
                    onMove(each.id);
                  }
                }}
              />
            );
          })}
        </List>
      </PanelSection>
      <span className={siteStyles}>{hostOf(url)}</span>
    </Popover>
  );
};

/** `url`'s host, or `url` itself when it has none. */
const hostOf = (url: string): string => {
  try {
    const { host } = new URL(url);
    return host === "" ? url : host;
  } catch {
    return url;
  }
};

/**
 * Inline style handing the profile's color to the styles below as
 * `--profile-color`. Inline because the color is the config's, at runtime.
 */
const colored = (
  profile: BrowserProfile,
): CSSProperties & Record<`--${string}`, string> => ({
  "--profile-color": profile.color,
});

// A solid capsule in the profile's color before the address, as the private
// label was, so the page's profile shows on every page.
const chipStyles = hstack({
  _focusVisible: { outline: "2px solid {colors.accent}", outlineOffset: 1 },
  backgroundColor: "var(--profile-color)",
  blockSize: 6,
  border: "none",
  borderRadius: "full",
  color: "white",
  cursor: "default",
  flex: "none",
  fontSize: "sm",
  fontWeight: "semibold",
  gap: 1,
  paddingInlineEnd: 2,
  paddingInlineStart: 2.5,
});

const dotStyles = css({
  backgroundColor: "var(--profile-color)",
  blockSize: 2.5,
  borderRadius: "full",
  display: "inline-block",
  flex: "none",
  inlineSize: 2.5,
});

const headingStyles = hstack({ gap: 2 });

const checkStyles = css({ color: "accent" });

const siteStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
