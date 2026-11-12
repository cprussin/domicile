// The sites an extension's site access names, by the rule the config and the
// engine check (`domicile-config`'s `is_site`, the engine's `SitePattern`).

/** A label: letters, digits and hyphens, not at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** A hex number, which a URL reads as part of an address. */
const HEX = /^0x[0-9a-f]*$/i;

/** A part of a dotted IPv4 address: 0 to 999 with no leading zero. */
const OCTET = /^(?:0|[1-9][0-9]{0,2})$/;

/**
 * Whether `site` is a host, or `*.host` for its subdomains: dot-separated
 * labels of letters, digits and inner hyphens, the last with a letter and not
 * a hex number, or a dotted IPv4 address (without `*.`).
 */
export const isSite = (site: string): boolean =>
  site.startsWith("*.")
    ? isHostName(site.slice(2))
    : isHostName(site) || isIPv4(site);

/** Whether `host` is labels, the last with a letter rather than a number. */
const isHostName = (host: string): boolean => {
  const labels = host.split(".");
  const last = labels.at(-1) ?? "";
  return (
    labels.every((label) => LABEL.test(label)) &&
    /[a-z]/i.test(last) &&
    !HEX.test(last)
  );
};

/** Whether `host` is four numbers from 0 to 255, with no leading zero. */
const isIPv4 = (host: string): boolean => {
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => OCTET.test(part) && Number(part) <= 255)
  );
};
