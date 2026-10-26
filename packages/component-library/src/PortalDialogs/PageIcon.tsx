import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";

/** A browser window's page icon, or a globe without one. */
export const PageIcon = ({ icon }: { icon: string | undefined }) =>
  icon === undefined ? <GlobeIcon aria-hidden /> : <img alt="" src={icon} />;
