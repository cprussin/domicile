// The downloads panel holding 30 finished downloads.

import { Downloads } from "@domicile-desktop/manganese-bar-module-downloads";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { Bar } from "../Bar";

const HOST = new FakeDomicileHost();
HOST.set({
  downloads: Array.from({ length: 30 }, (_, index) => ({
    id: index.toString(),
    page: "https://example.com/",
    path: `/home/user/Downloads/report-${(index + 1).toString().padStart(2, "0")}.pdf`,
    receivedBytes: 1_000_000,
    state: "complete",
    totalBytes: 1_000_000,
    window: "",
  })),
});

export const DownloadsScene = () => (
  <DomicileProvider domicile={desktop(HOST.host)}>
    <Bar>
      <Downloads />
    </Bar>
  </DomicileProvider>
);
