//! The `crate::lock::Verifier` for `lock.passphrase_hash`: libxcrypt's
//! `crypt_rn`, as `pam_unix` checks `/etc/shadow`.
//!
//! The hash is any method the machine's libxcrypt calls strong, such as
//! yescrypt (what `mkpasswd` makes) or SHA-512 crypt. `crypt_checksalt`
//! judges it when the config is read. A desk whose hash nothing can match, or
//! whose hash is quick to crack from a copy of the config, does not start.
//!
//! libcrypt is loaded at run time, as `crate::pam` loads libpam, because its
//! soname differs by distribution: `libcrypt.so.2` on NixOS, Fedora and Arch,
//! `libcrypt.so.1` on Debian and openSUSE. The flake puts `libxcrypt` on the
//! compositor's runpath.

use std::ffi::{c_char, c_int, c_void, CStr, CString};

use domicile_protocol::Passphrase;
use libloading::Library;
use thiserror::Error;

use crate::lock::{CouldNotCheck, Verdict, Verifier};

/// libxcrypt's sonames, tried in order.
const LIBRARIES: [&str; 2] = ["libcrypt.so.2", "libcrypt.so.1"];

/// `sizeof(struct crypt_data)` in `crypt.h`, part of libxcrypt's ABI.
const CRYPT_DATA_SIZE: usize = 32768;

// `crypt_checksalt`'s answers, from `crypt.h`.
const CRYPT_SALT_OK: c_int = 0;
const CRYPT_SALT_INVALID: c_int = 1;
const CRYPT_SALT_METHOD_DISABLED: c_int = 2;
const CRYPT_SALT_METHOD_LEGACY: c_int = 3;
const CRYPT_SALT_TOO_CHEAP: c_int = 4;

/// Why a desk with `lock.passphrase_hash` cannot use it. Each is fatal at
/// startup: see `crate::lock::chosen`. None prints the hash.
#[derive(Debug, Error)]
pub enum NoHash {
    #[error(
        "lock.passphrase_hash is set, and neither {} would load, so this desk has nothing to \
         open it with: {source}",
        LIBRARIES.join(" nor ")
    )]
    Library {
        #[source]
        source: libloading::Error,
    },

    #[error("{library} loaded but has no {symbol}: it is not libxcrypt 4.3 or later")]
    Symbol {
        library: &'static str,
        symbol: &'static str,
        #[source]
        source: libloading::Error,
    },

    #[error(
        "lock.passphrase_hash is not a hash this machine's libcrypt takes: {why}. Make one \
         with `mkpasswd`"
    )]
    Refused { why: &'static str },
}

/// A passphrase hash, checked with libxcrypt.
pub struct PassphraseHash {
    libcrypt: Libcrypt,
    hash: CString,
}

impl PassphraseHash {
    /// `hash`, if this machine's libxcrypt calls its method strong.
    pub fn checked(hash: &str) -> Result<PassphraseHash, NoHash> {
        let libcrypt = Libcrypt::load()?;
        let hash = CString::new(hash).map_err(|_| NoHash::Refused {
            why: "it contains a NUL",
        })?;
        // SAFETY: `hash` is a live NUL-terminated string.
        match unsafe { (libcrypt.checksalt)(hash.as_ptr()) } {
            CRYPT_SALT_OK => Ok(PassphraseHash { libcrypt, hash }),
            CRYPT_SALT_INVALID => Err(NoHash::Refused {
                why: "it is not a hash libcrypt can read",
            }),
            CRYPT_SALT_METHOD_DISABLED => Err(NoHash::Refused {
                why: "its method is turned off in this libcrypt",
            }),
            CRYPT_SALT_METHOD_LEGACY => Err(NoHash::Refused {
                why: "its method is too weak for a hash anyone can read",
            }),
            CRYPT_SALT_TOO_CHEAP => Err(NoHash::Refused {
                why: "its cost is too low for a hash anyone can read",
            }),
            _ => Err(NoHash::Refused {
                why: "crypt_checksalt gave an answer this compositor does not know",
            }),
        }
    }
}

impl Verifier for PassphraseHash {
    /// Hashes what was typed with the configured hash's method and salt, and
    /// compares the result in constant time.
    fn opens_the_desk(&self, passphrase: &Passphrase) -> Verdict {
        match CString::new(passphrase.as_str()) {
            // C reads only up to the NUL, so the prefix would also open the
            // desk. No real passphrase contains a NUL.
            Err(_) => Ok(false),
            Ok(typed) => {
                let mut data = vec![0u8; CRYPT_DATA_SIZE];
                // SAFETY: both strings are live and NUL-terminated, and `data`
                // is a zeroed `struct crypt_data` of the size passed.
                let hashed = unsafe {
                    (self.libcrypt.crypt_rn)(
                        typed.as_ptr(),
                        self.hash.as_ptr(),
                        data.as_mut_ptr().cast(),
                        CRYPT_DATA_SIZE as c_int,
                    )
                };
                if hashed.is_null() {
                    Err(CouldNotCheck(format!(
                        "crypt_rn failed: {}",
                        std::io::Error::last_os_error()
                    )))
                } else {
                    // SAFETY: a non-null answer is a NUL-terminated string in
                    // `data`, which is still alive.
                    let hashed = unsafe { CStr::from_ptr(hashed) };
                    Ok(same_bytes(hashed.to_bytes(), self.hash.as_bytes()))
                }
            }
        }
    }
}

/// Compares two byte strings in time that depends only on their lengths.
///
/// A `==` returns at the first differing byte, so its timing reveals how much
/// of a guess was right. `black_box` on the accumulator keeps the compiler
/// from adding that early exit back. The lengths are not hidden.
fn same_bytes(typed: &[u8], stated: &[u8]) -> bool {
    let differing = typed.iter().zip(stated).fold(0u8, |differing, (a, b)| {
        std::hint::black_box(differing | (a ^ b))
    });
    typed.len() == stated.len() && differing == 0
}

/// The libxcrypt entry points used here, and the library that keeps them
/// mapped.
struct Libcrypt {
    crypt_rn: CryptRn,
    checksalt: CryptChecksalt,
    /// Held so the two above stay mapped. Never read.
    _library: Library,
}

type CryptRn = unsafe extern "C" fn(
    phrase: *const c_char,
    setting: *const c_char,
    data: *mut c_void,
    size: c_int,
) -> *mut c_char;
type CryptChecksalt = unsafe extern "C" fn(setting: *const c_char) -> c_int;

impl Libcrypt {
    fn load() -> Result<Libcrypt, NoHash> {
        let (library, loaded) = loaded_libcrypt()?;
        // SAFETY: each type above is the prototype in `crypt.h`.
        let (crypt_rn, checksalt) = unsafe {
            (
                symbol::<CryptRn>(&loaded, library, "crypt_rn")?,
                symbol::<CryptChecksalt>(&loaded, library, "crypt_checksalt")?,
            )
        };
        Ok(Libcrypt {
            crypt_rn,
            checksalt,
            _library: loaded,
        })
    }
}

/// The first of [`LIBRARIES`] that loads, or why the last one did not.
fn loaded_libcrypt() -> Result<(&'static str, Library), NoHash> {
    let [newer, older] = LIBRARIES;
    // SAFETY: loading runs libxcrypt's initializers, which every program that
    // checks a password through PAM runs.
    unsafe { Library::new(newer) }
        .map(|loaded| (newer, loaded))
        .or_else(|_| unsafe { Library::new(older) }.map(|loaded| (older, loaded)))
        .map_err(|source| NoHash::Library { source })
}

/// One entry point out of `library`, or which one it lacks.
///
/// # Safety
///
/// `T` has to be the entry point's real type.
unsafe fn symbol<T: Copy>(
    loaded: &Library,
    library: &'static str,
    name: &'static str,
) -> Result<T, NoHash> {
    loaded
        .get::<T>(name.as_bytes())
        .map(|found| *found)
        .map_err(|source| NoHash::Symbol {
            library,
            symbol: name,
            source,
        })
}

#[cfg(test)]
mod tests {
    use domicile_protocol::Passphrase;

    use super::PassphraseHash;
    use crate::lock::Verifier;

    /// `mkpasswd "open sesame"`: yescrypt, its default.
    const YESCRYPT: &str =
        "$y$j9T$mMzyBSKNKxkbivH7ik1.T.$iM4gXKt2j/qEPlwG5bMwAYPJa15M//yqCKSEin8n0P/";

    /// `mkpasswd -m sha-512 "open sesame"`.
    const SHA_512: &str = "$6$TKDNO44JiV9JVKJ9$8lmxjhpdzQC0f55OosocrKR6J9E9cdnFvDJR9lq6Zk9ISdkYxA2sbYziBFQqFcfWEfuwZItqM9EY2YBuA2nnO0";

    #[test]
    fn only_the_passphrase_a_hash_was_made_from_opens_the_desk() {
        for hash in [YESCRYPT, SHA_512] {
            let verifier = PassphraseHash::checked(hash).expect("a hash libxcrypt takes");
            assert_eq!(
                verifier.opens_the_desk(&Passphrase::from("open sesame")),
                Ok(true),
                "{hash}"
            );
            // C reads up to a NUL, so the last one would open the desk if it
            // reached libcrypt.
            for wrong in ["open sesam", "open sesame!", "", "open sesame\0anything"] {
                assert_eq!(
                    verifier.opens_the_desk(&Passphrase::from(wrong)),
                    Ok(false),
                    "{wrong:?} against {hash}"
                );
            }
        }
    }
}
