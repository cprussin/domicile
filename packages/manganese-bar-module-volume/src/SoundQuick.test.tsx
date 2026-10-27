import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { device, heldSound, laptop } from "./fixture";
import { SoundGlyph, SoundRow, useSoundGestures } from "./SoundQuick";

/** A test-controlled check for a sound card. */
const heldHardware = () => {
  const listeners: ((present: Result<boolean, SystemError>) => void)[] = [];
  return {
    hardware: sharedWatch(
      (onPresent: (present: Result<boolean, SystemError>) => void) => {
        listeners.push(onPresent);
        return () => undefined;
      },
    ),
    report: (present: Result<boolean, SystemError>) => {
      act(() => {
        for (const onPresent of listeners) {
          onPresent(present);
        }
      });
    },
  };
};

describe(SoundGlyph, () => {
  it("shows the speaker at the default output's volume, and muted", () => {
    const sound = heldSound();
    render(
      <SoundGlyph audio={sound.audio} hardware={heldHardware().hardware} />,
    );
    sound.report(laptop);
    expect(screen.getByRole("img", { name: "Volume 50%" })).toBeVisible();

    sound.report({
      ...laptop,
      outputs: [device({ default: true, muted: true })],
    });

    expect(screen.getByRole("img", { name: "Volume muted" })).toBeVisible();
  });

  it("says when there is a sound card but no sound server", () => {
    const sound = heldSound();
    const hardware = heldHardware();
    render(<SoundGlyph audio={sound.audio} hardware={hardware.hardware} />);
    hardware.report(Ok(true));
    expect(
      screen.getByRole("img", { name: "Sound unavailable" }),
    ).toBeVisible();
  });

  it("shows nothing without a sound card", () => {
    const sound = heldSound();
    const hardware = heldHardware();
    const { container } = render(
      <SoundGlyph audio={sound.audio} hardware={hardware.hardware} />,
    );
    hardware.report(Ok(false));
    expect(container).toBeEmptyDOMElement();
  });
});

/** A button with the sound gestures, as the quick settings button has them. */
const Gestured = ({ sound }: { sound: ReturnType<typeof heldSound> }) => (
  <button type="button" {...useSoundGestures(sound.audio, sound.server)}>
    Quick settings
  </button>
);

describe(useSoundGestures, () => {
  it("turns the default output with the wheel and mutes it with a middle click", () => {
    const sound = heldSound();
    render(<Gestured sound={sound} />);
    sound.report(laptop);
    const button = screen.getByRole("button", { name: "Quick settings" });

    fireEvent.wheel(button, { deltaY: -100 });
    fireEvent(button, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(sound.asked).toEqual([
      ["setVolume", "output:speakers", 0.55],
      ["setMuted", "output:speakers", true],
    ]);
  });
});

describe(SoundRow, () => {
  it("sets the default output's volume and opens the mixer", async () => {
    const sound = heldSound();
    const opened = Promise.withResolvers<true>();
    render(
      <SoundRow
        audio={sound.audio}
        onMore={() => {
          opened.resolve(true);
        }}
        server={sound.server}
      />,
    );
    sound.report(laptop);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Volume" }), {
      key: "ArrowRight",
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Sound details" }),
    );

    expect(sound.asked).toEqual([["setVolume", "output:speakers", 0.51]]);
    expect(await opened.promise).toBe(true);
  });

  it("has no details on a locked desktop", () => {
    const sound = heldSound();
    render(<SoundRow audio={sound.audio} server={sound.server} />);
    sound.report(laptop);
    expect(screen.queryByRole("button", { name: "Sound details" })).toBeNull();
  });
});
