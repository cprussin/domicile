import type {
  AudioCard,
  AudioChoice,
  AudioDevice,
  AudioStream,
} from "@domicile/chrome-sdk/audio";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { AudioMessage } from "@domicile/chrome-sdk/host-message";
import type { AccordionItem } from "@domicile/component-library/Accordion";
import { Accordion } from "@domicile/component-library/Accordion";
import type { DrilldownDetail } from "@domicile/component-library/Drilldown";
import { Drilldown } from "@domicile/component-library/Drilldown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { useState } from "react";

import { css, cva } from "../../styled-system/css";
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

/** One thing a section can be opened to show. */
type Section = "outputs" | "inputs" | "playback" | "recording" | "cards";

/**
 * A list of choices slid in over the mixer — a port, a profile, the device a
 * stream goes to — and what choosing one does.
 */
type Chooser = {
  title: string;
  options: readonly { value: string; label: string }[];
  current: string | undefined;
  choose: (value: string) => void;
};

/**
 * The whole of the desk's sound, in the bar's panel: the default output and
 * microphone at the top, each with its meter, and under them a section for
 * every output, every input, what is playing and recording, and every card's
 * profile — what pavucontrol was for.
 *
 * **One panel and nothing over it.** A section opens in place; a choice — a
 * port, a profile, where a stream goes — slides in from the side and back out
 * once it is made. A `Select` would open a popup of its own, which takes the
 * focus out of the panel and so shuts it.
 *
 * **Only what is on screen is metered**: the two at the top, and whatever the
 * open section shows. Recordings have no meter of their own; their input's is
 * in its section.
 *
 * **The outputs' monitors are not inputs here**, as pavucontrol's default
 * leaves them out. They are still somewhere a recording can be moved to.
 */
export const Mixer = ({ audio, domicile, watchLevels }: Props) => {
  const [opened, setOpened] = useState<readonly string[]>([]);
  const [chooser, setChooser] = useState<Chooser | undefined>(undefined);
  const output = audio.outputs.find((device) => device.default);
  const input = audio.inputs.find(
    (device) => device.default && !device.monitor,
  );
  const inputs = audio.inputs.filter((device) => !device.monitor);
  // What each section meters while it is open. Recordings and cards have
  // nothing of their own to meter.
  const metered: readonly { section: Section; ids: readonly string[] }[] = [
    { ids: audio.outputs.map((device) => device.id), section: "outputs" },
    { ids: inputs.map((device) => device.id), section: "inputs" },
    { ids: audio.playback.map((stream) => stream.id), section: "playback" },
  ];
  const levels = useMeters(
    domicile,
    unique([
      ...[output, input].flatMap((device) =>
        device === undefined ? [] : [device.id],
      ),
      ...metered
        .filter(({ section }) => opened.includes(section))
        .flatMap(({ ids }) => ids),
    ]),
    watchLevels,
  );
  const choose = (next: Chooser) => {
    setChooser({
      ...next,
      choose: (value) => {
        next.choose(value);
        setChooser(undefined);
      },
    });
  };
  const sections: readonly (AccordionItem & {
    value: Section;
    count: number;
  })[] = [
    {
      content: (
        <Devices
          choose={choose}
          devices={audio.outputs}
          direction="output"
          domicile={domicile}
          levels={levels}
        />
      ),
      count: audio.outputs.length,
      label: "Outputs",
      value: "outputs",
    },
    {
      content: (
        <Devices
          choose={choose}
          devices={inputs}
          direction="input"
          domicile={domicile}
          levels={levels}
        />
      ),
      count: inputs.length,
      label: "Inputs",
      value: "inputs",
    },
    {
      content: (
        <Streams
          choose={choose}
          devices={audio.outputs}
          direction="output"
          domicile={domicile}
          levels={levels}
          streams={audio.playback}
          verb="plays on"
        />
      ),
      count: audio.playback.length,
      label: "Playback",
      value: "playback",
    },
    {
      content: (
        <Streams
          choose={choose}
          devices={audio.inputs}
          direction="input"
          domicile={domicile}
          levels={undefined}
          streams={audio.recording}
          verb="records from"
        />
      ),
      count: audio.recording.length,
      label: "Recording",
      value: "recording",
    },
    {
      content: (
        <Cards cards={audio.cards} choose={choose} domicile={domicile} />
      ),
      count: audio.cards.length,
      label: "Cards",
      value: "cards",
    },
  ];
  return (
    <Drilldown
      detail={chooser === undefined ? undefined : choices(chooser)}
      onBack={() => {
        setChooser(undefined);
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
          />
        )}
        {input !== undefined && (
          <Default
            device={input}
            direction="input"
            domicile={domicile}
            label="Microphone"
            meter={levels.get(input.id)}
          />
        )}
        <Accordion
          items={sections.filter((section) => section.count > 0)}
          multiple
          onValueChange={setOpened}
          value={[...opened]}
        />
      </div>
    </Drilldown>
  );
};

type DefaultProps = {
  device: AudioDevice;
  direction: Direction;
  domicile: DomicileClient;
  /** What the slider is called: what it is for, rather than which it is. */
  label: string;
  meter: number | undefined;
};

/** One of the two always at the top, named under it for which device it is. */
const Default = ({
  device,
  direction,
  domicile,
  label,
  meter,
}: DefaultProps) => (
  <div className={defaultStyles}>
    <span className={captionStyles}>{device.description}</span>
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
  </div>
);

type DevicesProps = {
  choose: (chooser: Chooser) => void;
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  levels: ReadonlyMap<string, number>;
};

const Devices = ({
  choose,
  devices,
  direction,
  domicile,
  levels,
}: DevicesProps) => (
  <ul className={listStyles}>
    {devices.map((device) => (
      <li className={rowStyles} key={device.id}>
        <span className={headStyles}>
          <button
            aria-label={
              device.default
                ? `${device.description} is the default`
                : `Make ${device.description} the default`
            }
            className={iconButtonStyles}
            disabled={device.default}
            onClick={() => {
              domicile.setDefaultAudioDevice(device.id);
            }}
            type="button"
          >
            <CheckCircleIcon
              size={14}
              weight={device.default ? "fill" : "regular"}
            />
          </button>
          <span className={nameStyles}>{device.description}</span>
          {device.ports.length > 1 && (
            <Pick
              label={`${device.description} port: ${described(device.ports, device.port)}`}
              onPick={() => {
                choose({
                  choose: (port) => {
                    domicile.setAudioPort(device.id, port);
                  },
                  current: device.port,
                  options: device.ports.map((port) =>
                    option(port, "unplugged"),
                  ),
                  title: `${device.description} port`,
                });
              }}
              shown={described(device.ports, device.port)}
            />
          )}
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
  choose: (chooser: Chooser) => void;
  /** Where a stream can go: the outputs, or every input monitors and all. */
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  /** The meters, or `undefined` for streams that have none. */
  levels: ReadonlyMap<string, number> | undefined;
  streams: readonly AudioStream[];
  /** How a stream's device is named: what it `plays on`. */
  verb: string;
};

const Streams = ({
  choose,
  devices,
  direction,
  domicile,
  levels,
  streams,
  verb,
}: StreamsProps) => (
  <ul className={listStyles}>
    {streams.map((stream) => {
      const name =
        stream.title === undefined
          ? stream.application
          : `${stream.application}: ${stream.title}`;
      // A device the server listed after the stream is settled by the next
      // reading; until then there is nothing to name.
      const on =
        devices.find((device) => device.id === stream.device)?.description ??
        "…";
      return (
        <li className={rowStyles} key={stream.id}>
          <span className={headStyles}>
            <span className={nameStyles}>{name}</span>
            <Pick
              label={`${name} ${verb} ${on}`}
              onPick={() => {
                choose({
                  choose: (device) => {
                    domicile.moveAudioStream(stream.id, device);
                  },
                  current: stream.device,
                  options: devices.map((device) => ({
                    label: device.description,
                    value: device.id,
                  })),
                  title: name,
                });
              }}
              shown={on}
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
);

type CardsProps = {
  cards: readonly AudioCard[];
  choose: (chooser: Chooser) => void;
  domicile: DomicileClient;
};

const Cards = ({ cards, choose, domicile }: CardsProps) => (
  <ul className={listStyles}>
    {cards.map((card) => (
      <li className={headStyles} key={card.id}>
        <span className={nameStyles}>{card.description}</span>
        <Pick
          label={`${card.description} profile: ${described(card.profiles, card.profile)}`}
          onPick={() => {
            choose({
              choose: (profile) => {
                domicile.setAudioProfile(card.id, profile);
              },
              current: card.profile,
              options: card.profiles.map((profile) =>
                option(profile, "unavailable"),
              ),
              title: `${card.description} profile`,
            });
          }}
          shown={described(card.profiles, card.profile)}
        />
      </li>
    ))}
  </ul>
);

type PickProps = {
  /** What the button says to a screen reader: `Speakers port: Headphones`. */
  label: string;
  /** What is chosen now. */
  shown: string;
  onPick: () => void;
};

/** A row's current choice, which opens the list of the others. */
const Pick = ({ label, onPick, shown }: PickProps) => (
  <button
    aria-label={label}
    className={pickStyles}
    onClick={onPick}
    type="button"
  >
    <span className={pickTextStyles}>{shown}</span>
    <CaretRightIcon size={10} />
  </button>
);

/** A chooser as the detail the mixer slides in. */
const choices = (chooser: Chooser): DrilldownDetail => ({
  content: (
    <ul className={listStyles}>
      {chooser.options.map((choice) => (
        <li key={choice.value}>
          <button
            aria-pressed={choice.value === chooser.current}
            className={choiceStyles({
              current: choice.value === chooser.current,
            })}
            onClick={() => {
              chooser.choose(choice.value);
            }}
            type="button"
          >
            <span className={nameStyles}>{choice.label}</span>
            {choice.value === chooser.current && <CheckIcon size={12} />}
          </button>
        </li>
      ))}
    </ul>
  ),
  title: chooser.title,
});

/** A port or a profile as an option, saying so when it cannot be used now. */
const option = (choice: AudioChoice, unusable: string) => ({
  label: choice.available
    ? choice.description
    : `${choice.description} (${unusable})`,
  value: choice.name,
});

/** The description of the choice named `name`, or a dash for none. */
const described = (choices: readonly AudioChoice[], name: string | undefined) =>
  choices.find((choice) => choice.name === name)?.description ?? "—";

/** `ids` once each, in the order first given. */
const unique = (ids: readonly string[]) => [...new Set(ids)];

const mainStyles = flex({
  direction: "column",
  gap: 2,
  inlineSize: 72,
});

const defaultStyles = flex({
  direction: "column",
  gap: 0.5,
});

// Ten pixels, the bar's own size, as the figures beside the sliders are.
const captionStyles = css({
  fontSize: "0.625rem",
  opacity: 0.75,
  overflow: "hidden",
  paddingInlineStart: 8,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "50vh",
  overflowY: "auto",
  padding: 0,
});

const rowStyles = flex({
  direction: "column",
  gap: 0.5,
});

const headStyles = hstack({
  gap: 1.5,
});

const nameStyles = css({
  flexGrow: 1,
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// The bar's own button, in `currentcolor` — see `Level`.
const iconButtonStyles = css({
  _disabled: {
    cursor: "default",
  },
  _hoverEnabled: {
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

const pickStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, currentcolor 16%, transparent)",
  },
  backgroundColor: "color-mix(in oklab, currentcolor 8%, transparent)",
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  flexShrink: 0,
  font: "inherit",
  gap: 1,
  maxInlineSize: 32,
  paddingBlock: 0.5,
  paddingInline: 2,
});

const pickTextStyles = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const choiceStyles = cva({
  base: hstack.raw({
    _hover: {
      backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
    },
    backgroundColor: "transparent",
    borderRadius: "md",
    borderStyle: "none",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    gap: 2,
    inlineSize: "100%",
    paddingBlock: 1.5,
    paddingInline: 2,
    textAlign: "start",
  }),
  variants: {
    current: {
      false: {},
      true: {
        backgroundColor: "color-mix(in oklab, currentcolor 8%, transparent)",
        fontWeight: "medium",
      },
    },
  },
});
