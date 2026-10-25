import { redirect } from "next/navigation";

import { PAGES } from "../../docs/pages";

/** domicile-desktop.com/docs: the first page. */
const DocsIndex = () => redirect(`/docs/${PAGES[0]?.slug ?? ""}`);

export default DocsIndex;
