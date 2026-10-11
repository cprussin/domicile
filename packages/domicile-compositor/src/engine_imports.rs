//! Which buffers the engine has imported, which it is still importing, and the
//! frame each surface holds back for an import.
//!
//! An import is a round trip through the browser to the GPU process, so the
//! compositor does not wait for one. A frame whose buffer is new waits here
//! and goes up when the import finishes. A newer frame replaces it, as in
//! `engine_waiting`.

use std::collections::HashMap;
use std::hash::Hash;

use crate::engine::{BufferId, Request, SurfaceId};

/// The imports, by buffer `K`, and the frames `F` waiting on them.
#[derive(Debug)]
pub struct Imports<K, F> {
    done: HashMap<K, (SurfaceId, BufferId)>,
    importing: HashMap<Request, Importing<K>>,
    waiting: HashMap<SurfaceId, (K, F)>,
    last_request: Request,
}

/// An import the engine has not answered.
#[derive(Debug)]
struct Importing<K> {
    surface: SurfaceId,
    /// `None` once the buffer is gone, so the answer is forgotten.
    key: Option<K>,
}

/// Where a frame goes. See [`Imports::route`].
#[derive(Debug, PartialEq)]
pub enum Route<F> {
    /// Its buffer is imported as `id`, so submit it. Release `replaced`, an
    /// older frame that was waiting.
    Submit {
        id: BufferId,
        frame: F,
        replaced: Option<F>,
    },
    /// It waits for its buffer's import. Release `replaced`. Ask the engine to
    /// import the buffer as `start`, if set.
    Wait {
        replaced: Option<F>,
        start: Option<Request>,
    },
}

/// What a finished import lets through. See [`Imports::finished`].
#[derive(Debug, PartialEq)]
pub struct Finished<F> {
    /// An id imported for a buffer or surface that went meanwhile. Tell the
    /// engine to forget it.
    pub forget: Option<(SurfaceId, BufferId)>,
    /// The frames that waited on it.
    pub then: Vec<Then<F>>,
}

/// A frame whose import finished.
#[derive(Debug, PartialEq)]
pub enum Then<F> {
    /// Submit it, showing `id`.
    Submit {
        surface: SurfaceId,
        id: BufferId,
        frame: F,
    },
    /// The engine refused its buffer. Release it.
    Refused { surface: SurfaceId, frame: F },
}

/// What [`Imports::forget`] took out.
#[derive(Debug, PartialEq)]
pub struct Forgotten<F> {
    /// The buffer's import, for the engine to forget.
    pub id: Option<(SurfaceId, BufferId)>,
    /// Frames that waited on it, to release.
    pub waited: Vec<(SurfaceId, F)>,
}

/// What [`Imports::surface_gone`] took out.
#[derive(Debug, PartialEq)]
pub struct Gone<F> {
    /// The surface's imports, for the engine to forget.
    pub ids: Vec<BufferId>,
    /// The frame that waited on the surface, to release.
    pub waited: Option<F>,
}

impl<K, F> Default for Imports<K, F> {
    fn default() -> Self {
        Imports {
            done: HashMap::new(),
            importing: HashMap::new(),
            waiting: HashMap::new(),
            last_request: 0,
        }
    }
}

impl<K: Clone + Eq + Hash, F> Imports<K, F> {
    /// Whether `key` is imported.
    pub fn knows(&self, key: &K) -> bool {
        self.done.contains_key(key)
    }

    /// Records an import that finished while the caller waited.
    pub fn imported(&mut self, key: K, surface: SurfaceId, id: BufferId) {
        self.done.insert(key, (surface, id));
    }

    /// Decides whether `frame`, showing buffer `key`, goes up now or waits for
    /// an import.
    pub fn route(&mut self, surface: SurfaceId, key: K, frame: F) -> Route<F> {
        match self.done.get(&key) {
            Some((_, id)) => Route::Submit {
                id: *id,
                frame,
                replaced: self.waiting.remove(&surface).map(|(_, frame)| frame),
            },
            None => {
                let start = (!self.is_importing(&key)).then(|| self.start(surface, key.clone()));
                Route::Wait {
                    replaced: self
                        .waiting
                        .insert(surface, (key, frame))
                        .map(|(_, frame)| frame),
                    start,
                }
            }
        }
    }

    /// Records the engine's answer to `request`: the buffer's id, or `None` if
    /// it refused the buffer.
    pub fn finished(&mut self, request: Request, buffer: Option<BufferId>) -> Finished<F> {
        let importing = self
            .importing
            .remove(&request)
            .expect("the engine answers only the imports it was asked for");
        let Some(key) = importing.key else {
            return Finished {
                forget: buffer.map(|id| (importing.surface, id)),
                then: Vec::new(),
            };
        };
        if let Some(id) = buffer {
            self.done.insert(key.clone(), (importing.surface, id));
        }
        let surfaces: Vec<SurfaceId> = self
            .waiting
            .iter()
            .filter(|(_, (waits_on, _))| *waits_on == key)
            .map(|(surface, _)| *surface)
            .collect();
        let then = surfaces
            .into_iter()
            .map(|surface| {
                let (_, frame) = self.waiting.remove(&surface).expect("just found");
                match buffer {
                    Some(id) => Then::Submit { surface, id, frame },
                    None => Then::Refused { surface, frame },
                }
            })
            .collect();
        Finished { forget: None, then }
    }

    /// Drops buffer `key`'s import, for a destroyed `wl_buffer` or a freed
    /// upload. An import still running is forgotten when it finishes.
    pub fn forget(&mut self, key: &K) -> Forgotten<F> {
        for importing in self.importing.values_mut() {
            if importing.key.as_ref() == Some(key) {
                importing.key = None;
            }
        }
        Forgotten {
            id: self.done.remove(key),
            waited: self
                .waiting
                .extract_if(|_, (waits_on, _)| waits_on == key)
                .map(|(surface, (_, frame))| (surface, frame))
                .collect(),
        }
    }

    /// Drops everything of `surface`'s, for a window that went.
    pub fn surface_gone(&mut self, surface: SurfaceId) -> Gone<F> {
        for importing in self.importing.values_mut() {
            if importing.surface == surface {
                importing.key = None;
            }
        }
        Gone {
            ids: self
                .done
                .extract_if(|_, (of, _)| *of == surface)
                .map(|(_, (_, id))| id)
                .collect(),
            waited: self.waiting.remove(&surface).map(|(_, frame)| frame),
        }
    }

    /// Drops every import, for a lost engine, and returns the frames that
    /// waited.
    pub fn clear(&mut self) -> Vec<(SurfaceId, F)> {
        self.done.clear();
        self.importing.clear();
        self.waiting
            .drain()
            .map(|(surface, (_, frame))| (surface, frame))
            .collect()
    }

    fn is_importing(&self, key: &K) -> bool {
        self.importing
            .values()
            .any(|importing| importing.key.as_ref() == Some(key))
    }

    fn start(&mut self, surface: SurfaceId, key: K) -> Request {
        self.last_request += 1;
        self.importing.insert(
            self.last_request,
            Importing {
                surface,
                key: Some(key),
            },
        );
        self.last_request
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SURFACE: SurfaceId = 1;
    const OTHER: SurfaceId = 2;

    /// Buffers and frames are stand-ins: a buffer is a letter, a frame a
    /// number.
    type Under = Imports<char, u32>;

    /// Routes a frame that must wait, and returns the import it started.
    fn waits(imports: &mut Under, surface: SurfaceId, key: char, frame: u32) -> Option<Request> {
        match imports.route(surface, key, frame) {
            Route::Wait { start, .. } => start,
            Route::Submit { .. } => panic!("frame {frame} went up without its import"),
        }
    }

    #[test]
    fn a_new_buffer_waits_for_its_import_and_then_goes_up_at_once() {
        let mut imports = Under::default();

        assert_eq!(
            imports.route(SURFACE, 'a', 1),
            Route::Wait {
                replaced: None,
                start: Some(1)
            }
        );
        assert_eq!(
            imports.finished(1, Some(10)),
            Finished {
                forget: None,
                then: vec![Then::Submit {
                    surface: SURFACE,
                    id: 10,
                    frame: 1
                }]
            }
        );
        assert_eq!(
            imports.route(SURFACE, 'a', 2),
            Route::Submit {
                id: 10,
                frame: 2,
                replaced: None
            }
        );
    }

    #[test]
    fn a_buffer_being_imported_is_not_imported_twice_and_its_newest_frame_goes_up() {
        let mut imports = Under::default();
        let request = waits(&mut imports, SURFACE, 'a', 1).expect("an import starts");

        assert_eq!(
            imports.route(SURFACE, 'a', 2),
            Route::Wait {
                replaced: Some(1),
                start: None
            }
        );
        assert_eq!(
            imports.finished(request, Some(10)).then,
            vec![Then::Submit {
                surface: SURFACE,
                id: 10,
                frame: 2
            }]
        );
    }

    #[test]
    fn an_imported_buffer_goes_up_past_a_frame_still_waiting() {
        let mut imports = Under::default();
        imports.imported('a', SURFACE, 10);
        let request = waits(&mut imports, SURFACE, 'b', 1).expect("an import starts");

        assert_eq!(
            imports.route(SURFACE, 'a', 2),
            Route::Submit {
                id: 10,
                frame: 2,
                replaced: Some(1)
            }
        );
        assert_eq!(imports.finished(request, Some(11)).then, vec![]);
        assert!(imports.knows(&'b'), "and the import is kept for next time");
    }

    #[test]
    fn a_refused_buffer_hands_its_frame_back_and_is_tried_again_next_time() {
        let mut imports = Under::default();
        let request = waits(&mut imports, SURFACE, 'a', 1).expect("an import starts");

        assert_eq!(
            imports.finished(request, None).then,
            vec![Then::Refused {
                surface: SURFACE,
                frame: 1
            }]
        );
        assert!(!imports.knows(&'a'));
        assert_eq!(waits(&mut imports, SURFACE, 'a', 2), Some(request + 1));
    }

    #[test]
    fn a_forgotten_buffer_s_import_is_dropped_even_while_it_runs() {
        let mut imports = Under::default();
        imports.imported('a', SURFACE, 10);
        let request = waits(&mut imports, OTHER, 'b', 1).expect("an import starts");

        assert_eq!(
            imports.forget(&'a'),
            Forgotten {
                id: Some((SURFACE, 10)),
                waited: vec![]
            }
        );
        assert_eq!(
            imports.forget(&'b'),
            Forgotten {
                id: None,
                waited: vec![(OTHER, 1)]
            }
        );
        assert_eq!(
            imports.finished(request, Some(11)),
            Finished {
                forget: Some((OTHER, 11)),
                then: vec![]
            }
        );
        assert!(!imports.knows(&'a') && !imports.knows(&'b'));
    }

    #[test]
    fn a_gone_surface_takes_its_imports_and_frame_and_no_other_s() {
        let mut imports = Under::default();
        imports.imported('a', SURFACE, 10);
        imports.imported('b', SURFACE, 11);
        imports.imported('c', OTHER, 12);
        let request = waits(&mut imports, SURFACE, 'd', 1).expect("an import starts");

        let mut gone = imports.surface_gone(SURFACE);

        gone.ids.sort();
        assert_eq!(
            gone,
            Gone {
                ids: vec![10, 11],
                waited: Some(1)
            }
        );
        assert!(imports.knows(&'c'));
        assert_eq!(
            imports.finished(request, Some(13)).forget,
            Some((SURFACE, 13))
        );
    }

    #[test]
    fn a_lost_engine_takes_every_import_and_hands_back_every_frame() {
        let mut imports = Under::default();
        imports.imported('a', SURFACE, 10);
        waits(&mut imports, OTHER, 'b', 1);

        assert_eq!(imports.clear(), vec![(OTHER, 1)]);
        assert!(!imports.knows(&'a'));
        assert_eq!(
            waits(&mut imports, OTHER, 'b', 2),
            Some(2),
            "and the next import starts afresh, under a new number"
        );
    }
}
