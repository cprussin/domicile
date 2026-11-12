import { describe, expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";

import type { Press, PressOn } from "./handed-drag";
import { useHandedPress } from "./useHandedPress";

const PRESS: Press = { button: 0, clientX: 40, clientY: 12, pointerId: 3 };

/** A grab's sheet that starts its drag from `handed`. */
const Sheet = ({
  handed,
  onPress,
}: {
  handed: Press | undefined;
  onPress: (press: PressOn) => void;
}) => <div data-testid="sheet" ref={useHandedPress(handed, onPress)} />;

describe("useHandedPress", () => {
  it("starts the drag from the handed press, on the sheet", () => {
    const onPress = mock((_: PressOn) => undefined);
    const { getByTestId } = render(<Sheet handed={PRESS} onPress={onPress} />);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0]?.[0]).toEqual({
      ...PRESS,
      currentTarget: getByTestId("sheet"),
    });
  });

  it("starts it once, however often the sheet redraws", () => {
    const onPress = mock((_: PressOn) => undefined);
    const { rerender } = render(<Sheet handed={PRESS} onPress={onPress} />);

    rerender(<Sheet handed={PRESS} onPress={() => undefined} />);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("starts nothing without a press", () => {
    const onPress = mock((_: PressOn) => undefined);
    render(<Sheet handed={undefined} onPress={onPress} />);

    expect(onPress).not.toHaveBeenCalled();
  });
});
