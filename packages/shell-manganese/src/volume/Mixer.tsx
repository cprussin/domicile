import { Drilldown } from "@domicile-desktop/component-library/Drilldown";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import type {
  AudioCard,
  AudioChoice,
  AudioDevice,
  AudioStream,
} from "@domicile-desktop/sdk/audio";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { AudioMessage } from "@domicile-desktop/sdk/host-message";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import type { ReactNode } from "react";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import type { Direction } from "./Level";
import { Level } from "./Level";
import { useMeters } from "./useMeters";
import type { watchAudioLevels } from "./watch-audio-levels";

type Props = {
  audio: AudioMessage;
  /** Where every change is asked for, and the meters with it. */
  domicile: DomicileClient;
  /** How the meters are watched; injected so tests can drive them. */
  watchLevels?: typeof watchAudioLevels | undefined;
};

/** What can slide in over the two sliders. */
type Pane = "outputs" | "inputs" | "cards";

/**
 * The whole of the desk's sound, in the bar's panel — what pavucontrol was
 * for.
 *
 * **Two sliders**: the default output and the default microphone, each with
 * its meter and its port. Beside each, when there is more, a button slides in
 * the rest: the other outputs and what is playing, or the other inputs and
 * what is recording. Under them, the cards' profiles slide in the same way.
 * The defaults are not in what slides in; their ports are already here.
 *
 * **Every choice is a `Select`** — a port, a profile, where a stream goes.
 * Its list is drawn outside the panel, which the `Popover` keeps as its own.
 *
 * **Only what is on screen is metered.** Recordings have no meter of their
 * own; their input's is beside it.
 *
 * **The outputs' monitors are not inputs here**, as pavucontrol's default
 * leaves them out. They are still somewhere a recording can be moved to.
 */
export const Mixer = ({ audio, domicile, watchLevels }: Props) => {
  const [pane, setPane] = useState<Pane | undefined>(undefined);
  const output = audio.outputs.find((device) => device.default);
  const input = audio.inputs.find(
    (device) => device.default && !device.monitor,
  );
  const outputs = audio.outputs.filter((device) => device !== output);
  const inputs = audio.inputs.filter(
    (device) => device !== input && !device.monitor,
  );
  const levels = useMeters(
    domicile,
    metered(pane, { input, inputs, output, outputs, playback: audio.playback }),
    watchLevels,
  );
  const panes: Record<Pane, { title: string; content: ReactNode }> = {
    cards: {
      content: <Cards cards={audio.cards} domicile={domicile} />,
      title: "Cards",
    },
    inputs: {
      content: (
        <>
          <Devices
            devices={inputs}
            direction="input"
            domicile={domicile}
            levels={levels}
          />
          <Streams
            devices={audio.inputs}
            direction="input"
            domicile={domicile}
            label="Recording"
            levels={undefined}
            streams={audio.recording}
          />
        </>
      ),
      title: "Other inputs",
    },
    outputs: {
      content: (
        <>
          <Devices
            devices={outputs}
            direction="output"
            domicile={domicile}
            levels={levels}
          />
          <Streams
            devices={audio.outputs}
            direction="output"
            domicile={domicile}
            label="Playing"
            levels={levels}
            streams={audio.playback}
          />
        </>
      ),
      title: "Other outputs",
    },
  };
  return (
    <Drilldown
      detail={pane === undefined ? undefined : panes[pane]}
      onBack={() => {
        setPane(undefined);
      }}
    >
      <div className={mainStyles}>
        {output !== undefined && (
          <Default
            device={output}
            direction="output"
            domicile={domicile}
            label="Volume"
            meter={levels.get(output.id)}
            more={
              outputs.length + audio.playback.length > 0
                ? () => {
                    setPane("outputs");
                  }
                : undefined
            }
            moreLabel="Other outputs"
          />
        )}
        {input !== undefined && (
          <Default
            device={input}
            direction="input"
            domicile={domicile}
            label="Microphone"
            meter={levels.get(input.id)}
            more={
              inputs.length + audio.recording.length > 0
                ? () => {
                    setPane("inputs");
                  }
                : undefined
            }
            moreLabel="Other inputs"
          />
        )}
        {audio.cards.length > 0 && (
          <button
            className={cardsButtonStyles}
            onClick={() => {
              setPane("cards");
            }}
            type="button"
          >
            Cards
            <CaretRightIcon size={10} />
          </button>
        )}
      </div>
    </Drilldown>
  );
};

/** The ids on screen: the two defaults, and whatever has slid in. */
const metered = (
  pane: Pane | undefined,
  shown: {
    output: AudioDevice | undefined;
    input: AudioDevice | undefined;
    outputs: readonly AudioDevice[];
    inputs: readonly AudioDevice[];
    playback: readonly AudioStream[];
  },
) => {
  switch (pane) {
    case "outputs":
      return [...shown.outputs, ...shown.playback].map(({ id }) => id);
    case "inputs":
      return shown.inputs.map(({ id }) => id);
    case "cards":
      return [];
    case undefined:
      return [shown.output, shown.input].flatMap((device) =>
        device === undefined ? [] : [device.id],
      );
  }
};

type DefaultProps = {
  device: AudioDevice;
  direction: Direction;
  domicile: DomicileClient;
  /** What the slider is called: what it is for, rather than which it is. */
  label: string;
  meter: number | undefined;
  /** Slide in the rest, or `undefined` when there is none. */
  more: (() => void) | undefined;
  moreLabel: string;
};

/**
 * One of the two sliders, named over it for which device it is, with its
 * port and the way to the rest.
 */
const Default = ({
  device,
  direction,
  domicile,
  label,
  meter,
  more,
  moreLabel,
}: DefaultProps) => (
  <div className={rowStyles}>
    <span className={headStyles}>
      <span className={captionStyles}>{device.description}</span>
      <Port device={device} domicile={domicile} />
    </span>
    <span className={levelRowStyles}>
      <Level
        direction={direction}
        label={label}
        level={device.volume}
        meter={meter}
        muted={device.muted}
        onLevel={(level) => {
          domicile.setAudioVolume(device.id, level);
        }}
        onMuted={(muted) => {
          domicile.setAudioMuted(device.id, muted);
        }}
      />
      {more !== undefined && (
        <button
          aria-label={moreLabel}
          className={iconButtonStyles}
          onClick={more}
          title={moreLabel}
          type="button"
        >
          <CaretRightIcon size={12} />
        </button>
      )}
    </span>
  </div>
);

type DevicesProps = {
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  levels: ReadonlyMap<string, number>;
};

/** The devices that are not the default, each of which can be made it. */
const Devices = ({ devices, direction, domicile, levels }: DevicesProps) =>
  devices.length > 0 && (
    <ul className={listStyles}>
      {devices.map((device) => (
        <li className={rowStyles} key={device.id}>
          <span className={headStyles}>
            <button
              aria-label={`Make ${device.description} the default`}
              className={iconButtonStyles}
              onClick={() => {
                domicile.setDefaultAudioDevice(device.id);
              }}
              title="Make it the default"
              type="button"
            >
              <CheckCircleIcon size={14} />
            </button>
            <span className={nameStyles}>{device.description}</span>
            <Port device={device} domicile={domicile} />
          </span>
          <Level
            direction={direction}
            label={device.description}
            level={device.volume}
            meter={levels.get(device.id)}
            muted={device.muted}
            onLevel={(level) => {
              domicile.setAudioVolume(device.id, level);
            }}
            onMuted={(muted) => {
              domicile.setAudioMuted(device.id, muted);
            }}
          />
        </li>
      ))}
    </ul>
  );

type StreamsProps = {
  /** Where a stream can go: the outputs, or every input monitors and all. */
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  /** What they are, over them: `Playing`. */
  label: string;
  /** The meters, or `undefined` for streams that have none. */
  levels: ReadonlyMap<string, number> | undefined;
  streams: readonly AudioStream[];
};

const Streams = ({
  devices,
  direction,
  domicile,
  label,
  levels,
  streams,
}: StreamsProps) =>
  streams.length > 0 && (
    <section aria-label={label} className={listStyles}>
      <h3 className={sectionHeadingStyles}>{label}</h3>
      <ul className={listStyles}>
        {streams.map((stream) => {
          const name =
            stream.title === undefined
              ? stream.application
              : `${stream.application}: ${stream.title}`;
          return (
            <li className={rowStyles} key={stream.id}>
              <span className={headStyles}>
                <span className={nameStyles}>{name}</span>
                <Choice
                  label={`${name} ${direction}`}
                  onChoose={(device) => {
                    domicile.moveAudioStream(stream.id, device);
                  }}
                  options={devices.map((device) => ({
                    label: device.description,
                    value: device.id,
                  }))}
                  value={stream.device}
                />
              </span>
              <Level
                direction={direction}
                label={name}
                level={stream.volume}
                meter={levels?.get(stream.id)}
                muted={stream.muted}
                onLevel={(level) => {
                  domicile.setAudioVolume(stream.id, level);
                }}
                onMuted={(muted) => {
                  domicile.setAudioMuted(stream.id, muted);
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );

type CardsProps = {
  cards: readonly AudioCard[];
  domicile: DomicileClient;
};

const Cards = ({ cards, domicile }: CardsProps) => (
  <ul className={listStyles}>
    {cards.map((card) => (
      <li className={headStyles} key={card.id}>
        <span className={nameStyles}>{card.description}</span>
        <Choice
          label={`${card.description} profile`}
          onChoose={(profile) => {
            domicile.setAudioProfile(card.id, profile);
          }}
          options={card.profiles.map((profile) =>
            option(profile, "unavailable"),
          )}
          value={card.profile}
        />
      </li>
    ))}
  </ul>
);

type PortProps = {
  device: AudioDevice;
  domicile: DomicileClient;
};

/** A device's port, where it has more than one to choose. */
const Port = ({ device, domicile }: PortProps) =>
  device.ports.length > 1 && (
    <Choice
      label={`${device.description} port`}
      onChoose={(port) => {
        domicile.setAudioPort(device.id, port);
      }}
      options={device.ports.map((port) => option(port, "unplugged"))}
      value={device.port}
    />
  );

type ChoiceProps = {
  label: string;
  options: readonly SelectOption<string>[];
  /** What is chosen now, as the server last said. */
  value: string | undefined;
  /** Ask for another; what is chosen changes when the server says so. */
  onChoose: (value: string) => void;
};

/** A row's choice: a small `Select` at its end. */
const Choice = ({ label, onChoose, options, value }: ChoiceProps) => (
  <span className={choiceStyles}>
    <Select
      aria-label={label}
      onValueChange={(chosen) => {
        if (chosen !== null && chosen !== value) {
          onChoose(chosen);
        }
      }}
      options={options}
      placeholder="…"
      rounded
      size="xs"
      value={value ?? null}
    />
  </span>
);

/** A port or a profile as an option, saying so when it cannot be used now. */
const option = (
  choice: AudioChoice,
  unusable: string,
): SelectOption<string> => ({
  label: choice.available
    ? choice.description
    : `${choice.description} (${unusable})`,
  value: choice.name,
});

const mainStyles = flex({
  direction: "column",
  gap: 3,
  inlineSize: 72,
});

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const rowStyles = flex({
  direction: "column",
  gap: 0.5,
});

const headStyles = hstack({
  gap: 1.5,
  minBlockSize: 6,
});

const levelRowStyles = hstack({
  gap: 1,
});

// Ten pixels, the bar's own size, as the figures beside the sliders are.
const captionStyles = css({
  flexGrow: 1,
  fontSize: "0.625rem",
  minInlineSize: 0,
  opacity: 0.75,
  overflow: "hidden",
  paddingInlineStart: 8,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const nameStyles = css({
  flexGrow: 1,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const sectionHeadingStyles = css({
  fontSize: "0.625rem",
  fontWeight: "medium",
  letterSpacing: "wide",
  margin: 0,
  marginBlockStart: 2,
  opacity: 0.75,
  textTransform: "uppercase",
});

const choiceStyles = css({
  flexShrink: 1,
  maxInlineSize: 36,
  minInlineSize: 0,
});

// The bar's own button, in `currentcolor` — see `Level`.
const iconButtonStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 6,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 6,
  justifyContent: "center",
  padding: 0,
});

const cardsButtonStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
  },
  alignSelf: "flex-end",
  backgroundColor: "transparent",
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.625rem",
  gap: 1,
  opacity: 0.75,
  paddingBlock: 0.5,
  paddingInline: 2,
});
