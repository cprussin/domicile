import { Button } from "@domicile/component-library/Button";
import { ModalDialog } from "@domicile/component-library/ModalDialog";
import { Select } from "@domicile/component-library/Select";
import { Tabs } from "@domicile/component-library/Tabs";
import type {
  AudioCard,
  AudioChoice,
  AudioDevice,
  AudioStream,
} from "@domicile/sdk/audio";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { AudioMessage } from "@domicile/sdk/host-message";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import type { Direction } from "./Level";
import { Level } from "./Level";

type Props = {
  audio: AudioMessage;
  /** Where every change is asked for. */
  domicile: DomicileClient;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The monitor it opens over: the one whose bar opened it. */
  screen: string;
};

/**
 * The whole of the desk's sound, as pavucontrol has it: what is playing and
 * recording, each with its volume and the device it goes to; every output and
 * input, with its volume, its port, and which is the default; and every card's
 * profile — which is how a card turns on its HDMI output or a headset its
 * microphone.
 *
 * **The outputs' monitors are not inputs here**, as pavucontrol's default
 * leaves them out: a monitor is not a device anybody turns up. It is still
 * somewhere a recording can be moved to, which is what it is for.
 *
 * A dialog rather than the bar's panel, because a panel closes when focus
 * leaves it and every `Select` here opens a list of its own outside it.
 */
export const Mixer = ({
  audio,
  domicile,
  onOpenChange,
  open,
  screen,
}: Props) => (
  <ModalDialog
    onOpenChange={onOpenChange}
    open={open}
    screen={screen}
    size="lg"
    title="Sound"
  >
    <Tabs
      defaultValue="playback"
      size="sm"
      tabs={[
        {
          content: (
            <Streams
              devices={audio.outputs}
              direction="output"
              domicile={domicile}
              empty="Nothing is playing."
              streams={audio.playback}
              verb="plays on"
            />
          ),
          label: "Playback",
          value: "playback",
        },
        {
          content: (
            <Streams
              devices={audio.inputs}
              direction="input"
              domicile={domicile}
              empty="Nothing is recording."
              streams={audio.recording}
              verb="records from"
            />
          ),
          label: "Recording",
          value: "recording",
        },
        {
          content: (
            <Devices
              devices={audio.outputs}
              direction="output"
              domicile={domicile}
              empty="No outputs."
            />
          ),
          label: "Outputs",
          value: "outputs",
        },
        {
          content: (
            <Devices
              devices={audio.inputs.filter((input) => !input.monitor)}
              direction="input"
              domicile={domicile}
              empty="No inputs."
            />
          ),
          label: "Inputs",
          value: "inputs",
        },
        {
          content: (
            <Cards
              cards={audio.cards}
              domicile={domicile}
              empty="No sound cards."
            />
          ),
          label: "Cards",
          value: "cards",
        },
      ]}
    />
  </ModalDialog>
);

type StreamsProps = {
  /** Where a stream can go: the outputs, or every input monitors and all. */
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  empty: string;
  streams: readonly AudioStream[];
  /** How a stream's device is named: what it `plays on`. */
  verb: string;
};

const Streams = ({
  devices,
  direction,
  domicile,
  empty,
  streams,
  verb,
}: StreamsProps) => (
  <List count={streams.length} empty={empty}>
    {streams.map((stream) => {
      const name =
        stream.title === undefined
          ? stream.application
          : `${stream.application}: ${stream.title}`;
      return (
        <li className={rowStyles} key={stream.id}>
          <span className={headStyles}>
            <span className={nameStyles}>{name}</span>
            <Select
              aria-label={`${name} ${verb}`}
              onValueChange={(device) => {
                if (device !== null) {
                  domicile.moveAudioStream(stream.id, device);
                }
              }}
              options={devices.map((device) => ({
                label: device.description,
                value: device.id,
              }))}
              size="sm"
              value={stream.device ?? null}
              width={56}
            />
          </span>
          <Level
            direction={direction}
            label={name}
            level={stream.volume}
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
  </List>
);

type DevicesProps = {
  devices: readonly AudioDevice[];
  direction: Direction;
  domicile: DomicileClient;
  empty: string;
};

const Devices = ({ devices, direction, domicile, empty }: DevicesProps) => (
  <List count={devices.length} empty={empty}>
    {devices.map((device) => (
      <li className={rowStyles} key={device.id}>
        <span className={headStyles}>
          <Button
            disabled={device.default}
            label={
              device.default
                ? `${device.description} is the default`
                : `Make ${device.description} the default`
            }
            onClick={() => {
              domicile.setDefaultAudioDevice(device.id);
            }}
            size="sm"
            variant="ghost"
          >
            <CheckCircleIcon weight={device.default ? "fill" : "regular"} />
          </Button>
          <span className={nameStyles}>{device.description}</span>
          {device.ports.length > 1 && (
            <Select
              aria-label={`${device.description} port`}
              onValueChange={(port) => {
                if (port !== null) {
                  domicile.setAudioPort(device.id, port);
                }
              }}
              options={device.ports.map((port) => choice(port, "unplugged"))}
              size="sm"
              value={device.port ?? null}
              width={56}
            />
          )}
        </span>
        <Level
          direction={direction}
          label={device.description}
          level={device.volume}
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
  </List>
);

type CardsProps = {
  cards: readonly AudioCard[];
  domicile: DomicileClient;
  empty: string;
};

const Cards = ({ cards, domicile, empty }: CardsProps) => (
  <List count={cards.length} empty={empty}>
    {cards.map((card) => (
      <li className={headStyles} key={card.id}>
        <span className={nameStyles}>{card.description}</span>
        <Select
          aria-label={`${card.description} profile`}
          onValueChange={(profile) => {
            if (profile !== null) {
              domicile.setAudioProfile(card.id, profile);
            }
          }}
          options={card.profiles.map((profile) =>
            choice(profile, "unavailable"),
          )}
          size="sm"
          value={card.profile ?? null}
          width={72}
        />
      </li>
    ))}
  </List>
);

/** A port or a profile as an option, saying so when it cannot be used now. */
const choice = (option: AudioChoice, unusable: string) => {
  const label = option.available
    ? option.description
    : `${option.description} (${unusable})`;
  return { label, textLabel: label, value: option.name };
};

/** The rows, or what it means that there are none. */
const List = ({
  children,
  count,
  empty,
}: {
  children: ReactNode;
  count: number;
  empty: string;
}) =>
  count === 0 ? (
    <p className={emptyStyles}>{empty}</p>
  ) : (
    <ul className={listStyles}>{children}</ul>
  );

const listStyles = flex({
  direction: "column",
  gap: 3,
  listStyle: "none",
  margin: 0,
  maxBlockSize: "60vh",
  overflowY: "auto",
  paddingBlock: 3,
  paddingInline: 0,
});

const rowStyles = flex({
  direction: "column",
  gap: 1,
});

const headStyles = hstack({
  gap: 2,
  justify: "space-between",
});

const nameStyles = css({
  flexGrow: 1,
  fontSize: "sm",
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const emptyStyles = css({
  color: "muted",
  fontSize: "sm",
  paddingBlock: 3,
});
