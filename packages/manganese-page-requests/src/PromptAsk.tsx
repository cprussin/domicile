import { Button } from "@domicile-desktop/component-library/Button";
import {
  ChoiceList,
  RadioRow,
} from "@domicile-desktop/component-library/ChoiceRow";
import { Field } from "@domicile-desktop/component-library/Field";
import { Input } from "@domicile-desktop/component-library/Input";
import { CertificateIcon } from "@phosphor-icons/react/dist/ssr/Certificate";
import type { ReactNode, RefCallback } from "react";
import { useState } from "react";

import { css } from "../styled-system/css";
import { PageModal } from "./PageModal";
import { hostOf } from "./site-host";
import type { PromptRequest } from "./usePromptRequest";

type Props = {
  /** Gets the element to focus: the PIN field, or the answer button. */
  ref?: RefCallback<HTMLElement> | undefined;
  request: PromptRequest;
};

/**
 * Asks a question the browser would ask with a dialog of its own, over the
 * page that asked: file access, a certificate to sign in with, Bluetooth
 * pairing, or an extension's permissions.
 *
 * A `PageModal`: Enter answers yes and Escape no. Takes no focus itself: the
 * caller focuses `ref`'s element as its own focus rules allow.
 */
export const PromptAsk = ({ ref, request }: Props) => {
  const [choice, setChoice] = useState(0);
  const [text, setText] = useState("");
  const words = wordsFor(request);
  return (
    <PageModal
      footer={
        <>
          <Button onClick={request.dismiss} variant="outline">
            {words.no}
          </Button>
          <Button
            ref={request.kind === "bluetooth-pin" ? undefined : ref}
            type="submit"
            variant="accent"
          >
            {words.yes}
          </Button>
        </>
      }
      message={words.message}
      onDismiss={request.dismiss}
      onSubmit={() => {
        request.accept(choice, text);
      }}
      title={words.title}
    >
      {detailsFor(request, { choice, ref, setChoice, setText, text })}
    </PageModal>
  );
};

type Words = { message: string; no: string; title: string; yes: string };

/** The dialog's title, text and answers. */
const wordsFor = (request: PromptRequest): Words => {
  const site = hostOf(request.origin) ?? "This site";
  const { subject } = request;
  switch (request.kind) {
    case "file-view": {
      return {
        message: `${site} will be able to see it until you close all its windows.`,
        no: "Don't allow",
        title: `Let ${site} view ${subject}?`,
        yes: "Allow",
      };
    }
    case "file-edit": {
      return {
        message: `${site} will be able to save changes to it until you close all its windows.`,
        no: "Don't allow",
        title: `Let ${site} edit ${subject}?`,
        yes: "Allow",
      };
    }
    case "file-restricted": {
      return {
        message: `It holds system files, so ${site} can't open it.`,
        no: "Cancel",
        title: "Pick a different folder",
        yes: "Pick another",
      };
    }
    case "file-dangerous": {
      return {
        message: "This kind of file can harm your computer.",
        no: "Cancel",
        title: `Save ${subject} anyway?`,
        yes: "Save anyway",
      };
    }
    case "client-certificate": {
      return {
        message: `${site} asks for a certificate to sign you in.`,
        no: "Cancel",
        title: "Choose a certificate",
        yes: "Sign in",
      };
    }
    case "bluetooth-pin": {
      return {
        message: "Enter the PIN for this device.",
        no: "Cancel",
        title: `Pair with ${subject}`,
        yes: "Pair",
      };
    }
    case "bluetooth-confirm": {
      return {
        message:
          request.pin === ""
            ? `${site} wants to pair with this device.`
            : `Check that ${subject} shows ${request.pin}.`,
        no: "Cancel",
        title: `Pair with ${subject}?`,
        yes: "Pair",
      };
    }
    case "extension-install": {
      return {
        message: permissionsLead(request),
        no: "Cancel",
        title: `Add ${subject}?`,
        yes: "Add extension",
      };
    }
    case "extension-permissions": {
      return {
        message:
          request.details.length > 0
            ? "It's asking to:"
            : "It's asking for more access.",
        no: "Don't allow",
        title: `${subject} wants more permissions`,
        yes: "Allow",
      };
    }
    case "extension-re-enable": {
      return {
        message: permissionsLead(request),
        no: "Cancel",
        title: `Turn ${subject} back on?`,
        yes: "Turn on",
      };
    }
    case "resend-form": {
      return {
        message:
          "Reloading sends what you entered on this page again, which could repeat something like a purchase or a post.",
        no: "Cancel",
        title: "Send the form again?",
        yes: "Send again",
      };
    }
    case "unresponsive": {
      return {
        message: `${subject === "" ? site : subject} isn't responding. You can wait for it, or close it and reload later.`,
        no: "Wait",
        title: "This page isn't responding",
        yes: "Close page",
      };
    }
  }
};

const permissionsLead = (request: PromptRequest): string =>
  request.details.length > 0 ? "It can:" : "It needs no special permissions.";

type Answers = {
  choice: number;
  ref: Props["ref"];
  setChoice: (choice: number) => void;
  setText: (text: string) => void;
  text: string;
};

/** What goes between the text and the answers. */
const detailsFor = (
  request: PromptRequest,
  { choice, ref, setChoice, setText, text }: Answers,
): ReactNode => {
  switch (request.kind) {
    case "file-view":
    case "file-edit":
    case "file-dangerous": {
      return request.details.map((path) => (
        <p className={pathStyles} key={path}>
          {path}
        </p>
      ));
    }
    case "client-certificate": {
      return (
        <ChoiceList<number>
          aria-label="Certificates"
          onValueChange={setChoice}
          value={choice}
        >
          {request.details.map((certificate, index) => {
            const [name = "", issuer] = certificate.split("\n");
            return (
              <RadioRow
                detail={
                  issuer === undefined ? undefined : `Issued by ${issuer}`
                }
                icon={<CertificateIcon weight="duotone" />}
                // Certificates may share a name; their order is fixed.
                key={index}
                name={name}
                value={index}
              />
            );
          })}
        </ChoiceList>
      );
    }
    case "bluetooth-pin": {
      return (
        <Field label="PIN">
          <Input
            autoComplete="off"
            onValueChange={setText}
            ref={ref}
            value={text}
          />
        </Field>
      );
    }
    case "extension-install":
    case "extension-permissions":
    case "extension-re-enable": {
      return (
        request.details.length > 0 && (
          <ul className={permissionsStyles}>
            {request.details.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )
      );
    }
    case "file-restricted":
    case "bluetooth-confirm":
    case "resend-form":
    case "unresponsive": {
      return undefined;
    }
  }
};

// The file's path on one line, as ExternalAppAsk shows the link it opens.
const pathStyles = css({
  color: "muted",
  fontFamily: "mono",
  fontSize: "xs",
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const permissionsStyles = css({
  display: "flex",
  flexDirection: "column",
  fontSize: "sm",
  gap: 1,
  margin: 0,
  paddingInlineStart: 5,
});
