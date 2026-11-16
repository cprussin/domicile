// The stand-in for Electron's `safeStorage`: Chromium's OSCrypt for Linux,
// byte for byte, so what an app encrypted while it ran on its own Electron
// still decrypts here, and the other way round.
//
// The key comes from a password the Secret Service keeps for the app
// ("Chromium Safe Storage", `application` set to the app's name), as
// Electron's comes. With no Secret Service, Electron's backend is
// `basic_text`, and encryption is only there once the app opts into its
// hardcoded password with `setUsePlainTextEncryption`.

import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";

/** The app's Secret Service password, or none when there's no Secret Service. */
export type SafeStoragePassword = { readonly password: string | undefined };

export type SafeStorageDependencies = {
  /**
   * Reads the password, creating it the first time, blocking as Electron
   * does: it may ask the user to unlock their keyring. Called once, when
   * the app first needs it.
   */
  readonly password: () => SafeStoragePassword;
};

/** OSCrypt's key for `password`: PBKDF2-HMAC-SHA1, one round, "saltysalt". */
const keyOf = (password: string) =>
  pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");

/** Sixteen spaces, OSCrypt's IV. */
const IV = Buffer.alloc(16, " ");

/** The hardcoded password Chromium's `basic_text` backend uses. */
const V10_KEY = keyOf("peanuts");

/** The empty password Chromium also tries, for data from a keyring bug. */
const EMPTY_KEY = keyOf("");

const encrypt = (key: Buffer, prefix: string, text: string) => {
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  return Buffer.concat([
    Buffer.from(prefix),
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
};

/** `ciphertext` decrypted with `key`, or undefined when it isn't its key. */
const decrypt = (key: Buffer, ciphertext: Buffer) => {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A wrong key shows as bad padding: the caller tries the next key, then
    // throws as Electron does.
    return undefined;
  }
};

/**
 * The app's password, or none when the Secret Service fails, as Electron then
 * has no key: the app goes on, without encryption, rather than crash. Said on
 * stderr, as the failure is the desktop's keyring's, not the app's.
 */
const readPassword = (
  dependencies: SafeStorageDependencies,
): SafeStoragePassword => {
  try {
    return dependencies.password();
  } catch (why) {
    // biome-ignore lint/suspicious/noConsole: the desktop's keyring failed, which only the log can say
    console.error(
      `electron-host: safeStorage has no key, as reading it failed: ${why instanceof Error ? why.message : String(why)}`,
    );
    return { password: undefined };
  }
};

/** Builds Electron's `safeStorage` for one app. */
export const createSafeStorage = (dependencies: SafeStorageDependencies) => {
  let password: SafeStoragePassword | undefined;
  let usePlainText = false;
  const keyring = () => {
    password ??= readPassword(dependencies);
    return password.password === undefined
      ? undefined
      : keyOf(password.password);
  };

  const isEncryptionAvailable = () => keyring() !== undefined || usePlainText;

  return {
    decryptString: (encrypted: Buffer) => {
      if (!Buffer.isBuffer(encrypted)) {
        throw new TypeError(
          "Expected the first argument of decryptString() to be a buffer",
        );
      }
      const prefix = encrypted.subarray(0, 3).toString("latin1");
      const body = encrypted.subarray(3);
      const key = prefix === "v11" ? keyring() : V10_KEY;
      const plain =
        (prefix === "v10" || prefix === "v11") && key !== undefined
          ? (decrypt(key, body) ?? decrypt(EMPTY_KEY, body))
          : undefined;
      if (plain === undefined) {
        throw new Error(
          "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
        );
      }
      return plain;
    },

    encryptString: (plainText: string) => {
      const key = keyring();
      if (key !== undefined) {
        return encrypt(key, "v11", plainText);
      } else if (usePlainText) {
        return encrypt(V10_KEY, "v10", plainText);
      } else {
        throw new Error(
          "Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.",
        );
      }
    },

    /** Electron's name for where the key is kept. */
    getSelectedStorageBackend: () =>
      keyring() === undefined ? "basic_text" : "gnome_libsecret",

    isAsyncEncryptionAvailable: () => Promise.resolve(isEncryptionAvailable()),

    isEncryptionAvailable,

    setUsePlainTextEncryption: (use: boolean) => {
      usePlainText = use;
    },
  };
};
