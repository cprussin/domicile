import type { AccordionItem } from "@domicile-desktop/component-library/Accordion";
import { Accordion } from "@domicile-desktop/component-library/Accordion";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type {
  Audio,
  AudioCard,
  AudioChoice,
  AudioDevice,
  AudioStream,
} from "@domicile-desktop/system-audio/audio";
import type { SoundControls } from "@domicile-desktop/system-audio/react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { createContext, useContext, useState } from "react";
import { css, cx } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import { ask } from "./ask";
import type { Direction } from "./Level";
import { Level } from "./Level";
import { primary } from "./primary";
import { useMeters } from "./useMeters";

type Props = {
  audio: Audio;
  /** Where changes are requested and meters read. */
  server: SoundControls;
};

/** A drawer under the sliders. */
type Drawer = "outputs" | "inputs" | "apps" | "cards";

/**
 * The full sound mixer, in the bar's panel; a replacement for pavucontrol.
 *
 * Two sections, Output and Input, each with the default device's slider,
 * meter and port.
 *
 * Below them, drawers: the other outputs and inputs, the apps that are
 * playing or recording with their streams, and the card profiles.
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
export const Mixer = ({ audio, server }: Props) => {
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
    server,
    [
      ...[output, input].flatMap((device) =>
        device === undefined ? [] : [device.id],
      ),
      ...(open.includes("outputs") ? outputs : []).map(({ id }) => id),
      ...(open.includes("inputs") ? inputs : []).map(({ id }) => id),
      ...(open.includes("apps") ? audio.playback : []).map(({ id }) => id),
    ],
    audio.meters,
  );
  const drawers: AccordionItem[] = [
    ...(outputs.length > 0
      ? [
          {
            content: (
              <Devices
                devices={outputs}
                direction="output"
                levels={levels}
                server={server}
              />
            ),
            label: "More outputs",
            value: "outputs",
          },
        ]
      : []),
    ...(inputs.length > 0
      ? [
          {
            content: (
              <Devices
                devices={inputs}
                direction="input"
                levels={levels}
                server={server}
              />
            ),
            label: "More inputs",
            value: "inputs",
          },
        ]
      : []),
    ...(apps.length > 0
      ? [
          {
            content: (
              <Apps
                apps={apps}
                inputs={audio.inputs}
                levels={levels}
                outputs={audio.outputs}
                server={server}
              />
            ),
            label: "Apps",
            value: "apps",
          },
        ]
      : []),
    ...(audio.cards.length > 0
      ? [
          {
            content: <Cards cards={audio.cards} server={server} />,
            label: "Cards",
            value: "cards",
          },
        ]
      : []),
  ];
  return (
    <Panel.Provider value={panel}>
      <div className={mainStyles} ref={setPanel}>
        {output !== undefined && (
          <PanelSection label="Output">
            <Default
              device={output}
              direction="output"
              label="Volume"
              meter={levels.get(output.id)}
              server={server}
            />
          </PanelSection>
        )}
        {input !== undefined && (
          <PanelSection label="Input">
            <Default
              device={input}
              direction="input"
              label="Microphone"
              meter={levels.get(input.id)}
              server={server}
            />
          </PanelSection>
        )}
        {drawers.length > 0 && (
          <Accordion
            items={drawers}
            multiple
            onValueChange={(shown) => {
              setOpen(shown.filter(isDrawer));
            }}
            surface="filled"
            value={[...open]}
          />
        )}
      </div>
    </Panel.Provider>
  );
};

const DRAWERS: readonly Drawer[] = ["outputs", "inputs", "apps", "cards"];

const isDrawer = (value: string): value is Drawer =>
  DRAWERS.some((drawer) => drawer === value);

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

type DefaultProps = {
  device: AudioDevice;
  direction: Direction;
  server: SoundControls;
  /** The slider's label: its purpose, not the device name. */
  label: string;
  meter: number | undefined;
};

/** One of the two default sliders, titled with its device, with its port. */
const Default = ({ device, direction, server, label, meter }: DefaultProps) => (
  <div className={rowStyles}>
    <span className={cx(headStyles, captionLineStyles)}>
      <span className={captionStyles}>{device.description}</span>
      <Port device={device} server={server} />
    </span>
    <Level
      direction={direction}
      label={label}
      level={device.volume}
      meter={meter}
      muted={device.muted}
      onLevel={(level) => {
        ask(server.setVolume(device.id, level));
      }}
      onMuted={(muted) => {
        ask(server.setMuted(device.id, muted));
      }}
    />
  </div>
);

type DevicesProps = {
  devices: readonly AudioDevice[];
  direction: Direction;
  server: SoundControls;
  levels: ReadonlyMap<string, number>;
};

/** The non-default devices, each of which can be made the default. */
const Devices = ({ devices, direction, levels, server }: DevicesProps) =>
  devices.length > 0 && (
    <ul className={listStyles}>
      {devices.map((device) => (
        <li className={rowStyles} key={device.id}>
          <span className={headStyles}>
            <Tooltip
              content="Make it the default"
              tone="overPhoto"
              trigger={
                <IconButton
                  label={`Make ${device.description} the default`}
                  onClick={() => {
                    ask(server.setDefault(device.id));
                  }}
                  size="sm"
                >
                  <CheckCircleIcon aria-hidden size={14} />
                </IconButton>
              }
            />
            <span className={nameStyles}>{device.description}</span>
            <Port device={device} server={server} />
          </span>
          <Level
            direction={direction}
            label={device.description}
            level={device.volume}
            meter={levels.get(device.id)}
            muted={device.muted}
            onLevel={(level) => {
              ask(server.setVolume(device.id, level));
            }}
            onMuted={(muted) => {
              ask(server.setMuted(device.id, muted));
            }}
          />
        </li>
      ))}
    </ul>
  );

type AppsProps = {
  apps: readonly App[];
  server: SoundControls;
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
const Apps = ({ apps, inputs, levels, outputs, server }: AppsProps) => (
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
                      ask(server.moveStream(stream.id, device));
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
                    ask(server.setVolume(stream.id, level));
                  }}
                  onMuted={(muted) => {
                    ask(server.setMuted(stream.id, muted));
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
  server: SoundControls;
};

const Cards = ({ cards, server }: CardsProps) => (
  <ul className={listStyles}>
    {cards.map((card) => (
      <li className={headStyles} key={card.id}>
        <span className={nameStyles}>{card.description}</span>
        <Choice
          label={`${card.description} profile`}
          onChoose={(profile) => {
            ask(server.setProfile(card.id, profile));
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
  server: SoundControls;
};

/** A device's port picker, when it has more than one. */
const Port = ({ device, server }: PortProps) =>
  device.ports.length > 1 && (
    <Choice
      label={`${device.description} port`}
      onChoose={(port) => {
        ask(server.setPort(device.id, port));
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

// The defaults' sections, then the drawers, a step apart.
const mainStyles = flex({
  direction: "column",
  gap: 3,
  minInlineSize: 0,
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
  color: "textSoft",
  flex: "0 1 auto",
  minInlineSize: 0,
  overflowWrap: "anywhere",
});

// Lined up with the slider below, past its mute button and the room for its
// thumb.
const captionLineStyles = css({
  paddingInlineStart: 9.5,
  textStyle: "panelDetail",
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
  gap: 3,
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
  margin: 0,
  textStyle: "panelLabel",
});

// Never truncated; wraps under the name instead. Full opacity, unlike the
// caption, since it is clickable.
const choiceStyles = css({
  flex: "0 0 auto",
  maxInlineSize: "100%",
  minInlineSize: 0,
});
