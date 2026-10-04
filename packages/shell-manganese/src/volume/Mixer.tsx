import { Accordion } from "@domicile-desktop/component-library/Accordion";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import type {
  AudioCard,
  AudioChoice,
  AudioDevice,
  AudioStream,
} from "@domicile-desktop/sdk/audio";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import type { ReactNode } from "react";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import type { Direction } from "./Level";
import { Level } from "./Level";
import { useMeters } from "./useMeters";
import type { Audio } from "./watch-audio";
import type { watchAudioLevels } from "./watch-audio-levels";

type Props = {
  audio: Audio;
  /** Where every change is asked for, and the meters with it. */
  domicile: DomicileHost;
  /** How the meters are watched; injected so tests can drive them. */
  watchLevels?: typeof watchAudioLevels | undefined;
};

/** A drawer under the sliders, open or shut. */
type Drawer = "outputs" | "inputs" | "apps" | "cards";

/**
 * The whole of the desk's sound, in the bar's panel — what pavucontrol was
 * for.
 *
 * **Two sliders**: the default output and the default microphone, each with
 * its meter and its port, and under each, when there are others, a drawer of
 * them: More outputs, More inputs. The defaults are not in the drawers; their
 * ports are already here.
 *
 * **Apps in a drawer** under those: each app that is playing or recording,
 * with its streams under it, and the cards' profiles in a last one.
 *
 * **Every choice is a `Select`** — a port, a profile, where a stream goes.
 * Its list is drawn outside the panel, which the `Popover` keeps as its own.
 *
 * **Only what is on screen is metered.** Recordings have no meter of their
 * own; their input's is beside the microphone's slider or among the others.
 *
 * **The outputs' monitors are not inputs here**, as pavucontrol's default
 * leaves them out. They are still somewhere a recording can be moved to.
 */
export const Mixer = ({ audio, domicile, watchLevels }: Props) => {
  const [open, setOpen] = useState<readonly Drawer[]>([]);
  const output = audio.outputs.find((device) => device.default);
  const input = audio.inputs.find(
    (device) => device.default && !device.monitor,
  );
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
    <div className={mainStyles}>
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
  );
};

/** A stream, and which way it goes. */
type Flow = { stream: AudioStream; direction: Direction };

/** An app, and what it is playing and recording. */
type App = { name: string; flows: readonly Flow[] };

/** The streams under the app each is from, in the order the apps first come. */
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

type DefaultProps = {
  device: AudioDevice;
  direction: Direction;
  domicile: DomicileHost;
  /** What the slider is called: what it is for, rather than which it is. */
  label: string;
  meter: number | undefined;
};

/** One of the two sliders, named over it for which device it is, with its port. */
const Default = ({
  device,
  direction,
  domicile,
  label,
  meter,
}: DefaultProps) => (
  <div className={rowStyles}>
    <span className={headStyles}>
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
  domicile: DomicileHost;
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

type AppsProps = {
  apps: readonly App[];
  domicile: DomicileHost;
  /** Where a recording can go: every input, monitors and all. */
  inputs: readonly AudioDevice[];
  levels: ReadonlyMap<string, number>;
  /** Where a stream that plays can go. */
  outputs: readonly AudioDevice[];
};

/**
 * Each app, named, and each of its streams under it: its volume, mute, meter
 * when it plays, and where it plays or records from.
 */
const Apps = ({ apps, domicile, inputs, levels, outputs }: AppsProps) => (
  <ul className={appsStyles}>
    {apps.map((app) => (
      <li className={appEntryStyles} key={app.name}>
        <h3 className={appStyles}>{app.name}</h3>
        <ul className={listStyles}>
          {app.flows.map(({ direction, stream }) => {
            // An app that names its stream after itself has said nothing.
            const title =
              stream.title === stream.application ? undefined : stream.title;
            const name =
              title === undefined
                ? stream.application
                : `${stream.application}: ${title}`;
            return (
              <li className={rowStyles} key={stream.id}>
                <span className={headStyles}>
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
  domicile: DomicileHost;
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
  domicile: DomicileHost;
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
  inlineSize: 72,
});

// A hairline between the outputs, the inputs, the apps and the cards, so
// "More outputs" reads as the outputs' and not as a section of its own.
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

// Under the default, from where its slider starts: past the mute button.
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

const headStyles = hstack({
  gap: 1.5,
  minBlockSize: 6,
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

// A long list scrolls inside the drawer, so the panel stays on screen.
const appsStyles = flex({
  direction: "column",
  gap: 4,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "50vh",
  overflowY: "auto",
  padding: 0,
});

// An app's name close over its streams, which are closer to each other than
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
