// What `mount` shows in place of an app that threw while drawing, so the
// failure is on screen and not an empty page.

import type { ReactNode } from "react";
import { Component } from "react";

type Props = { children: ReactNode };
type State = { error: unknown };

/** Shows the error a child throws while drawing, in place of the children. */
export class FailureBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    return error === undefined ? (
      this.props.children
    ) : (
      <div role="alert">
        <p>Something went wrong, and this can't be shown.</p>
        <pre>{error instanceof Error ? error.message : String(error)}</pre>
      </div>
    );
  }
}
