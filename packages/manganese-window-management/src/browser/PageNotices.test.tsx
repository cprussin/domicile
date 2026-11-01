import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { PageNotices } from "./PageNotices";

describe(PageNotices, () => {
  it("shows a zoom after a finished download's notice faded without it", () => {
    const { rerender } = render(
      <PageNotices downloadsFinished={1} zoom={1} zoomsAnnounced={0} />,
    );
    fireEvent.animationEnd(screen.getByRole("status"));

    rerender(
      <PageNotices downloadsFinished={1} zoom={1.1} zoomsAnnounced={1} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("110%");
    expect(screen.queryByText("Download finished")).toBeNull();
  });
});
