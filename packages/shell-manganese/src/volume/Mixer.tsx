import { Accordion } from "@domicile-desktop/component-library/Accordion";
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
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

import { css, cx } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import type { Direction } from "./Level";
import { Level } from "./Level";
import { useMeters } from "./useMeters";
import type { watchAudioLevels } from "./watch-audio-levels";

type Props = {
  audio: AudioMessage;
  /** Where changes are requested and meters read. */
  domicile: DomicileClient;
  /** How meters are watched; injected for tests. */
  watchLevels?: typeof watchAudioLevels | undefined;
};

/** A drawer under the sliders. */
type Drawer = "outputs" | "inputs" | "apps" | "cards";

/**
 * The full sound mixer, in the bar's panel; a replacement for pavucontrol.
 *
 * Two sliders, for the default output and input, each with meter and port.
 * Under each, a drawer of the other devices.
 *
 * Below that, a drawer of apps that are playing or recording, with their
 * streams, and a last drawer of card profiles.
 *
 * Every choice is a `Select`. Its list renders outside the panel, and the
 * `Popover` still treats it as part of the panel.
 *
 * Only visible devices are metered. Recording streams have no meter; their
 * input's meter shows instead.
 *
 * Output monitors are hidden from the inputs, as in pavucontrol, but remain
 * targets for moving a recording.
 */
export const Mixer = ({ audio, domicile, watchLevels }: Props) => {
  const [open, setOpen] = useState<readonly Drawer[]>([]);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const output = primary(audio.outputs);
  const input = primary(audio.inputs.filter((device) => !device.monitor));
  const outputs = audio.outputs.filter((device) => device !== output);
  const inputs = audio.inputs.filter(
    (device) => device !== input && !device.monitor,
  );
  const apps = byApp(audio.playback, audio.recording);
  const levels = useMeters(
    domicile,
    [
      ...[output, input].flatMap((device) =>
        device === undefined ? [] : [device.id],
      ),
      ...(open.includes("outputs") ? outputs : []).map(({ id }) => id),
      ...(open.includes("inputs") ? inputs : []).map(({ id }) => id),
      ...(open.includes("apps") ? audio.playback : []).map(({ id }) => id),
    ],
    watchLevels,
  );
  const drawer = (
    value: Drawer,
    label: string,
    content: ReactNode,
    size: "md" | "sm" = "md",
  ) => (
    <Accordion
      items={[{ content, label, value }]}
      onValueChange={(shown) => {
        setOpen((was) => [
          ...was.filter((other) => other !== value),
          ...(shown.includes(value) ? [value] : []),
        ]);
      }}
      size={size}
      value={open.includes(value) ? [value] : []}
    />
  );
  return (
    <Panel.Provider value={panel}>
      <div className={mainStyles} ref={setPanel}>
        {output !== undefined && (
          <section aria-label="Outputs" className={groupStyles}>
            <Default
              device={output}
              direction="output"
              domicile={domicile}
              label="Volume"
              meter={levels.get(output.id)}
            />
            {outputs.length > 0 && (
              <div className={nestedStyles}>
                {drawer(
                  "outputs",
                  "More outputs",
                  <Devices
                    devices={outputs}
                    direction="output"
                    domicile={domicile}
                    levels={levels}
                  />,
                  "sm",
                )}
              </div>
            )}
          </section>
        )}
        {input !== undefined && (
          <section aria-label="Inputs" className={groupStyles}>
            <Default
              device={input}
              direction="input"
              domicile={domicile}
              label="Microphone"
              meter={levels.get(input.id)}
            />
            {inputs.length > 0 && (
              <div className={nestedStyles}>
                {drawer(
                  "inputs",
                  "More inputs",
                  <Devices
                    devices={inputs}
                    direction="input"
                    domicile={domicile}
                    levels={levels}
                  />,
                  "sm",
                )}
              </div>
            )}
          </section>
        )}
        {apps.length > 0 && (
          <div className={groupStyles}>
            {drawer(
              "apps",
              "Apps",
              <Apps
                apps={apps}
                domicile={domicile}
                inputs={audio.inputs}
                levels={levels}
                outputs={audio.outputs}
              />,
            )}
          </div>
        )}
        {audio.cards.length > 0 && (
          <div className={groupStyles}>
            {drawer(
              "cards",
              "Cards",
              <Cards cards={audio.cards} domicile={domicile} />,
            )}
          </div>
        )}
      </div>
    </Panel.Provider>
  );
};

/**
 * The mixer's panel. Choice lists stay within its width, so none spills onto
 * the next monitor, and within the window's height, so a long one has room.
 */
const Panel = createContext<HTMLElement | null>(null);

/** A stream and its direction. */
type Flow = { stream: AudioStream; direction: Direction };

/** An app and its playback and recording streams. */
type App = { name: string; flows: readonly Flow[] };

/** Streams grouped by app, in first-seen app order. */
const byApp = (
  playback: readonly AudioStream[],
  recording: readonly AudioStream[],
): readonly App[] => {
  const apps = new Map<string, Flow[]>();
  for (const flow of [
    ...playback.map((stream) => ({ direction: "output" as const, stream })),
    ...recording.map((stream) => ({ direction: "input" as const, stream })),
  ]) {
    apps.set(flow.stream.application, [
      ...(apps.get(flow.stream.application) ?? []),
      flow,
    ]);
  }
  return [...apps].map(([name, flows]) => ({ flows, name }));
};

/**
 * The device the sliders control: the default, else the first device. The
 * server falls back the same way when its default is filtered out (a
 * monitor) or gone.
 */
const primary = (devices: readonly AudioDevice[]) =>
  devices.find((device) => device.default) ?? devices[0];

type DefaultProps = {
  device: AudioDevice;
  direction: Direction;
  domicile: DomicileClient;
  /** The slider's label: its purpose, not the device name. */
  label: string;
  meter: number | undefined;
};

/** One of the two default sliders, titled with its device, with its port. */
const Default = ({
  device,
  direction,
  domicile,
  label,
  meter,
}: DefaultProps) => (
  <div className={rowStyles}>
    <span className={cx(headStyles, captionLineStyles)}>
      <span className={captionStyles}>{device.description}</span>
      <Port device={device} domicile={domicile} />
    </span>
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
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  levels: ReadonlyMap<string, number>;
};

/** The non-default devices, each of which can be made the default. */
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

type AppsProps = {
  apps: readonly App[];
  domicile: DomicileClient;
  /** Where a recording can go: every input, monitors included. */
  inputs: readonly AudioDevice[];
  levels: ReadonlyMap<string, number>;
  /** Where a playback stream can go. */
  outputs: readonly AudioDevice[];
};

/**
 * Each app, named, with its streams: volume, mute, meter when playing, and the
 * device it plays to or records from.
 */
const Apps = ({ apps, domicile, inputs, levels, outputs }: AppsProps) => (
  <ul className={appsStyles}>
    {apps.map((app) => (
      <li className={appEntryStyles} key={app.name}>
        <h3 className={appStyles}>{app.name}</h3>
        <ul className={listStyles}>
          {app.flows.map(({ direction, stream }) => {
            // Skip a stream named after its app; the name adds nothing.
            const title =
              stream.title === stream.application ? undefined : stream.title;
            const name =
              title === undefined
                ? stream.application
                : `${stream.application}: ${title}`;
            return (
              <li className={rowStyles} key={stream.id}>
                <span className={cx(headStyles, captionLineStyles)}>
                  <span className={captionStyles}>
                    {title ??
                      (direction === "output" ? "Playing" : "Recording")}
                  </span>
                  <Choice
                    label={`${name} ${direction}`}
                    onChoose={(device) => {
                      domicile.moveAudioStream(stream.id, device);
                    }}
                    options={(direction === "output" ? outputs : inputs).map(
                      (device) => ({
                        label: device.description,
                        value: device.id,
                      }),
                    )}
                    value={stream.device}
                  />
                </span>
                <Level
                  direction={direction}
                  label={name}
                  level={stream.volume}
                  meter={
                    direction === "output" ? levels.get(stream.id) : undefined
                  }
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
      </li>
    ))}
  </ul>
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

/** A device's port picker, when it has more than one. */
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
  /** The current choice, as the server last reported. */
  value: string | undefined;
  /** Request another; the choice changes when the server confirms. */
  onChoose: (value: string) => void;
};

/** A quiet `Select` inline in a row, with its list kept within the panel. */
const Choice = ({ label, onChoose, options, value }: ChoiceProps) => {
  const panel = useContext(Panel)?.getBoundingClientRect();
  return (
    <span className={choiceStyles}>
      <Select
        aria-label={label}
        boundary={
          panel === undefined
            ? undefined
            : { height: innerHeight, width: panel.width, x: panel.x, y: 0 }
        }
        onValueChange={(chosen) => {
          if (chosen !== null && chosen !== value) {
            onChoose(chosen);
          }
        }}
        options={options}
        placeholder="…"
        quiet
        size="xs"
        value={value ?? null}
      />
    </span>
  );
};

/** A port or profile as an option, marked when unavailable. */
const option = (
  choice: AudioChoice,
  unusable: string,
): SelectOption<string> => ({
  label: choice.available
    ? choice.description
    : `${choice.description} (${unusable})`,
  value: choice.name,
});

// Wide enough for a device's name and its port to usually share a line.
const mainStyles = flex({
  direction: "column",
  inlineSize: 96,
});

// A divider between sections, so "More outputs" reads as part of the outputs.
const groupStyles = flex({
  _first: { paddingBlockStart: 0 },
  _last: { paddingBlockEnd: 0 },
  "& + &": {
    borderBlockStart:
      "1px solid color-mix(in oklab, currentcolor 15%, transparent)",
  },
  direction: "column",
  gap: 1,
  paddingBlock: 2,
});

// Indented to where the default's slider starts, past the mute button.
const nestedStyles = css({
  paddingInlineStart: 7,
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

// The choice wraps under the name when both don't fit, so neither is
// truncated.
const headStyles = hstack({
  columnGap: 1.5,
  flexWrap: "wrap",
  minBlockSize: 6,
  rowGap: 1,
});

const captionStyles = css({
  flex: "0 1 auto",
  minInlineSize: 0,
  opacity: 0.75,
  overflowWrap: "anywhere",
});

// Aligned with the slider below, past its mute button. Ten pixels, the bar's
// size, matching the slider figures.
const captionLineStyles = css({
  fontSize: "0.625rem",
  paddingInlineStart: 8,
});

const nameStyles = css({
  flex: "0 1 auto",
  minInlineSize: 0,
  overflowWrap: "anywhere",
});

// Long lists scroll vertically inside the drawer, so the panel stays on
// screen.
const appsStyles = flex({
  direction: "column",
  gap: 4,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "50vh",
  overflowX: "hidden",
  overflowY: "auto",
  padding: 0,
});

// App names sit close over their streams, which sit closer to each other than
// to the next app.
const appEntryStyles = flex({
  direction: "column",
  gap: 1,
});

const appStyles = css({
  fontSize: "inherit",
  fontWeight: "semibold",
  margin: 0,
});

// Never truncated; wraps under the name instead. Full opacity, unlike the
// caption, since it is clickable.
const choiceStyles = css({
  flex: "0 0 auto",
  maxInlineSize: "100%",
  minInlineSize: 0,
});

// The bar's button style, in `currentcolor`; see `Level`.
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
