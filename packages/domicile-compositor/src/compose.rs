//! Drawing the scene's portals as textured quads.
//!
//! The compositor draws each client's surface itself rather than handing its
//! pixels to the engine — see `docs/architecture/WINDOW-COMPOSITING.md`. All
//! the geometry comes from [`domicile_scene`]: `Portal::surface_to_output`
//! says where a surface goes, `Scene::draw_order` says in what order.
//!
//! Composing into a framebuffer rather than onto a window is what makes this
//! testable: the same call fills an offscreen buffer we can read back and a
//! real output we cannot. Presentation is the thin part left over.

use cgmath::Matrix3;
use domicile_scene::Transform;
use smithay::backend::renderer::gles::{
    GlesError, GlesFrame, GlesRenderer, GlesTexProgram, GlesTexture, Uniform, UniformName,
    UniformType,
};

/// The compositor's own shader, compiled once.
///
/// Rounding a window is not something the geometry can do — a quad is a quad —
/// so it is done per pixel, which means a fragment shader of ours in place of
/// Smithay's. Everything the built-in one does is still done here; the rounding
/// is added at the end.
pub struct Shaders {
    rounded: GlesTexProgram,
    shadow: GlesTexProgram,
}

/// A shadow cast by a window, in output pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadow {
    pub dx: f32,
    pub dy: f32,
    pub blur: f32,
    pub spread: f32,
    /// Straight (not premultiplied) RGBA, each 0 to 1.
    pub color: [f32; 4],
}

impl Shaders {
    /// Compile against a renderer. Fails only if the driver rejects the
    /// source, which is a build-time mistake rather than a runtime condition.
    pub fn compile(renderer: &mut GlesRenderer) -> Result<Self, GlesError> {
        Ok(Shaders {
            rounded: renderer.compile_custom_texture_shader(
                include_str!("shaders/rounded.frag"),
                &[
                    UniformName::new("quad_size", UniformType::_2f),
                    UniformName::new("corner_radius", UniformType::_1f),
                ],
            )?,
            shadow: renderer.compile_custom_texture_shader(
                include_str!("shaders/shadow.frag"),
                &[
                    UniformName::new("quad_size", UniformType::_2f),
                    UniformName::new("shadow_size", UniformType::_2f),
                    UniformName::new("shadow_radius", UniformType::_1f),
                    UniformName::new("window_size", UniformType::_2f),
                    UniformName::new("window_radius", UniformType::_1f),
                    UniformName::new("window_offset", UniformType::_2f),
                    UniformName::new("blur", UniformType::_1f),
                    UniformName::new("shadow_color", UniformType::_4f),
                ],
            )?,
        })
    }
}

/// One surface to draw, and where.
pub struct Layer<'a> {
    pub texture: &'a GlesTexture,
    /// Maps the unit square onto the output, from `Portal::surface_to_output`.
    pub surface_to_output: Transform,
    pub alpha: f32,
    /// How much to round the corners, in output pixels.
    ///
    /// Zero is a square window, which is what a client that asked for nothing
    /// gets. The same radius on every corner: CSS allows four, but a single one
    /// is what the shader can apply without knowing which way up the buffer is,
    /// and it is what every window actually asks for.
    pub corner_radius: f32,
    /// The shadow this window casts, if any. Drawn under it, and outside it.
    pub shadow: Option<Shadow>,
    /// The parts of this layer to draw: an `[x, y, width, height]` per
    /// rectangle, each component a fraction of the quad in the unit square's
    /// own coordinates — the space `surface_to_output` maps. Empty draws all
    /// of it.
    ///
    /// This is how the chrome gets to be in more than one place in the
    /// stacking order. It is one texture drawn over every app surface, and a
    /// texture carries no per-fragment depth, so it cannot be sliced by z. It
    /// can be sliced by *region*: drawn once confined to the parts that belong
    /// under the windows and again confined to the parts that belong over
    /// them, with the windows drawn in between.
    ///
    /// The unit square rather than output pixels because that is what the
    /// shader's instances are in: `gl_Position = matrix * (vert *
    /// vert_position.zw + vert_position.xy)`, and `matrix` here maps the unit
    /// square. `v_coords` comes off the same position, so the texture follows
    /// the clip without being told about it.
    ///
    /// Does not clip the layer's shadow, which is drawn from a larger quad of
    /// its own and would need its own rectangles in that quad's space. The
    /// only layer that is banded is the chrome, and the chrome casts nothing.
    pub clip: &'a [[f32; 4]],
    /// Whether the texture's rows run bottom-to-top.
    ///
    /// A client that renders with GL hands over a buffer the way GL made it,
    /// which is upside down relative to how a buffer is described. Smithay
    /// records this per texture but does not expose it, so it is carried
    /// alongside — see `DomicileCompositor::texture_from`, which is where it is
    /// known.
    pub y_inverted: bool,
}

/// Draw `layers` bottom-to-top into the frame.
///
/// The caller owns the frame because it owns what happens around the draw —
/// clearing, damage, and finishing — and those differ between an output being
/// presented and a buffer being tested.
pub fn draw_layers(
    frame: &mut GlesFrame<'_, '_>,
    shaders: &Shaders,
    layers: &[Layer<'_>],
) -> Result<(), GlesError> {
    for layer in layers {
        let (width, height) = on_screen_size(layer.surface_to_output);
        // Before the window, because a shadow that drew afterwards would be
        // over the client. The shader keeps it out from under the window too,
        // so a translucent window does not show its own shadow through itself.
        if let Some(shadow) = layer.shadow {
            draw_shadow(frame, shaders, layer, (width, height), shadow)?;
        }
        frame.render_texture(
            layer.texture,
            texture_matrix(layer.y_inverted),
            matrix3(layer.surface_to_output),
            // `None` is the whole quad; `Some` is one instance per rectangle.
            // An empty list would draw nothing at all, which is why the empty
            // case is the whole-quad one rather than an empty `Some`.
            (!layer.clip.is_empty()).then(|| layer.clip.iter().flatten().copied()),
            layer.alpha,
            Some(&shaders.rounded),
            &[
                Uniform::new("quad_size", (width, height)),
                Uniform::new("corner_radius", layer.corner_radius),
            ],
        )?;
    }
    Ok(())
}

/// Where a layer's shadow lands, or `None` when none is drawn.
///
/// The one definition of that, because two would drift: the compositor draws
/// the shadow through this and `damage::covered` boxes it through this, and a
/// shadow reported somewhere other than where it is drawn is a trail of stale
/// pixels behind a window that moved.
///
/// Not the window's own quad grown by an axis-aligned margin, which is the
/// obvious wrong answer. The quad is built in the window's own space and put
/// back through the layer's transform with the scale divided out, so a rotated
/// window rotates *its shadow's offset* too — a shadow thrown to the right of
/// an upright window is thrown downward when the window is turned a quarter
/// turn.
pub fn shadow_quad(
    surface_to_output: Transform,
    shadow: Shadow,
) -> Option<(Transform, (f32, f32))> {
    let (width, height) = on_screen_size(surface_to_output);
    // Room for the blur to fade out in on every side. Too little and the
    // shadow is cut off square, which looks like a bug and is one. The blur
    // reaches half its radius past the shadow's edge, because that is where
    // the shader's falloff ends.
    let margin = shadow.blur * 0.5 + shadow.spread.max(0.0);
    // A spread that eats more than half the window leaves no shape to cast, so
    // nothing is drawn and nothing has to be covered.
    if width + shadow.spread * 2.0 <= 0.0 || height + shadow.spread * 2.0 <= 0.0 {
        return None;
    }
    // The size goes back with the placement rather than being recomputed by
    // the caller: the shader is told this as `quad_size`, and a size that did
    // not match the quad it was placed as would draw the falloff at the wrong
    // scale.
    let quad = (width + margin * 2.0, height + margin * 2.0);
    let grown = Transform::scale(f64::from(quad.0), f64::from(quad.1)).then(Transform::translate(
        f64::from(shadow.dx - margin),
        f64::from(shadow.dy - margin),
    ));
    Some((placed_like(surface_to_output, grown), quad))
}

/// Draw one window's shadow: a quad big enough to hold the blur, with the
/// window's own shape cut out of it by the shader.
///
/// The first effect that draws *outside* the window, which is why it is a quad
/// of its own rather than another line in the window's shader — there is
/// nowhere in the window's own geometry to put it.
fn draw_shadow(
    frame: &mut GlesFrame<'_, '_>,
    shaders: &Shaders,
    layer: &Layer<'_>,
    (width, height): (f32, f32),
    shadow: Shadow,
) -> Result<(), GlesError> {
    // A spread that eats more than half the window leaves no shape to cast, so
    // `shadow_quad` hands back nothing to place. Clamping the size to zero
    // instead would leave the SDF measuring distance from a point, and the
    // blur would paint a faint disc where CSS paints nothing at all.
    let (spread_width, spread_height) = (width + shadow.spread * 2.0, height + shadow.spread * 2.0);
    let Some((grown, quad)) = shadow_quad(layer.surface_to_output, shadow) else {
        return Ok(());
    };
    frame.render_texture(
        layer.texture,
        // Identity, not the layer's: this quad never samples the texture, so
        // it has no business carrying the texture's orientation. Smithay's
        // vertex shader builds `v_coords` from the texture matrix, and the
        // shadow reads `v_coords` as a position — so a y-inverted client would
        // otherwise have its cut-out placed at `+dy` instead of `-dy` and the
        // shadow drawn straight through the middle of the window.
        Matrix3::from_scale(1.0),
        matrix3(grown),
        None::<Option<_>>,
        layer.alpha,
        Some(&shaders.shadow),
        &[
            Uniform::new("quad_size", quad),
            // The shadow's own rectangle: the window grown by the spread,
            // which makes it bigger than what casts it before any blurring. A
            // spread can be negative, so this can shrink instead.
            Uniform::new("shadow_size", (spread_width, spread_height)),
            Uniform::new(
                "shadow_radius",
                spread_radius(layer.corner_radius, shadow.spread),
            ),
            // The window itself, for the shader to keep the shadow out from
            // under. The quad was moved by the offset, so relative to its
            // centre the window sits the other way by the same amount.
            Uniform::new("window_size", (width, height)),
            Uniform::new("window_radius", layer.corner_radius),
            Uniform::new("window_offset", (-shadow.dx, -shadow.dy)),
            Uniform::new("blur", shadow.blur.max(f32::EPSILON)),
            Uniform::new("shadow_color", shadow.color),
        ],
    )
}

/// How round the shadow's corners are once the spread has been applied.
///
/// A square window casts a square shadow however far it is spread, which is
/// what CSS does — growing a sharp corner does not round it. A rounded one
/// grows its radius with the spread.
///
/// A spread can be negative, and one bigger than the radius takes it below
/// zero. That is left alone rather than clamped: `rounded_box` degenerates to
/// a sharp rectangle for a negative radius rather than turning inside out, and
/// a sharp rectangle is what a shadow spread in past its own rounding should
/// be. Clamping moved 43 parts in 51,000 of one shadow's ink, all of it in the
/// antialiasing band at the corners — a guard nothing can see and no test can
/// hold.
fn spread_radius(corner_radius: f32, spread: f32) -> f32 {
    if corner_radius > 0.0 {
        corner_radius + spread
    } else {
        0.0
    }
}

/// The shadow's quad, placed the way the window is.
///
/// The window's transform maps the unit square onto the output; the shadow's
/// has to land in the same place, rotated the same way, only bigger and moved.
/// So it is built in the window's own space and then put through the window's
/// placement with the scale taken out — otherwise a scaled window would scale
/// its blur twice.
fn placed_like(surface_to_output: Transform, shadow_quad: Transform) -> Transform {
    let (width, height) = on_screen_size(surface_to_output);
    let unscaled = Transform {
        a: surface_to_output.a / f64::from(width.max(f32::EPSILON)),
        b: surface_to_output.b / f64::from(width.max(f32::EPSILON)),
        c: surface_to_output.c / f64::from(height.max(f32::EPSILON)),
        d: surface_to_output.d / f64::from(height.max(f32::EPSILON)),
        e: surface_to_output.e,
        f: surface_to_output.f,
    };
    shadow_quad.then(unscaled)
}

/// How big the quad is once placed, in output pixels.
///
/// The lengths of the transformed unit vectors rather than the matrix's scale
/// terms, so a rotated window still reports the size it covers — a corner
/// radius is in pixels on the screen, and a window turned 30 degrees has the
/// same rounding as one that is not.
fn on_screen_size(transform: Transform) -> (f32, f32) {
    (
        (transform.a * transform.a + transform.b * transform.b).sqrt() as f32,
        (transform.c * transform.c + transform.d * transform.d).sqrt() as f32,
    )
}

/// How the quad samples the texture.
///
/// Identity for a buffer whose rows run top-to-bottom: the whole texture fills
/// the quad, and the surface's own size is already in `surface_to_output`. A
/// y-inverted one is sampled bottom-to-top instead, which is the difference
/// between a window drawn the right way up and one drawn upside down.
fn texture_matrix(y_inverted: bool) -> Matrix3<f32> {
    if y_inverted {
        // v -> 1 - v. Written out rather than as a negation, so it does not
        // depend on the texture's wrap mode to bring -v back into range.
        Matrix3::new(1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 1.0)
    } else {
        Matrix3::from_scale(1.0)
    }
}

/// Maps the chrome's logical units onto the window's device pixels.
///
/// The scene is laid out in the units the chrome lays out in, and the window is
/// device pixels; on a display that is not at scale 1 those are different
/// numbers, and drawing the one as if it were the other puts every window in a
/// corner of the output at a quarter size.
///
/// The nested window is one [target](desktop_to_target) that shows the whole
/// desktop, and this says so rather than repeating the arithmetic: a second
/// copy is a second thing to keep in step, and the two disagreeing would mean
/// the nested path and the per-display path draw different desktops.
pub fn logical_to_window(logical: (i32, i32), window: (i32, i32)) -> Transform {
    desktop_to_target((0, 0), logical, window)
}

/// Where the chrome lands, given the size it committed at.
///
/// At its own size rather than stretched over the output: the chrome is asked
/// to be the desktop's size, and one that has not taken that size yet should
/// show as a gap it has not filled rather than as a picture quietly scaled to
/// fit. The price of that honesty is that the size has to arrive — a chrome
/// still at its old one covers less of the desktop, and that is the shape of
/// every report that the desktop stopped filling the screen.
///
/// `present` needs this twice — once to draw the chrome and once to say what
/// it covered — and the two disagreeing would mean a desktop drawn in one
/// place and reported as damaged in another.
pub fn chrome_onto_output(committed: (f64, f64), to_window: Transform) -> Transform {
    Transform::scale(committed.0, committed.1).then(to_window)
}

/// Maps the desktop's logical units onto one target's own pixels.
///
/// A *target* is a thing being drawn into and the part of the desktop it shows:
/// `shows_at`/`shows_size` is that region in the desktop's logical units, and
/// `resolution` is the target's own size in physical pixels. The nested window
/// is the target that shows everything; a monitor is a target that shows its
/// own display.
///
/// Two jobs, and only the first is obvious. The translation is what makes a
/// display's own corner pixel zero of its own framebuffer rather than wherever
/// it sits on the desktop. The scale is where a mixed-density desktop stops
/// being drawn at one density: `resolution` is that display's *mode* — its
/// logical size in physical pixels — so a scale-2 display draws one logical
/// unit as two pixels while its scale-1 neighbour draws it as one, in the same
/// frame, from the same scene.
///
/// Compositing the desktop once cannot do that. One transform has one scale,
/// so the denser display is drawn at whatever the target it shares is, and the
/// density it advertised to its clients is thrown away at the last step.
pub fn desktop_to_target(
    shows_at: (i32, i32),
    shows_size: (i32, i32),
    resolution: (i32, i32),
) -> Transform {
    // A zero-sized region is an output being brought up or taken down, and it
    // has one for a frame either way. Dividing by it would put every layer at
    // infinity, which the renderer cannot draw and which reads as a blank
    // frame rather than as the missing output it is.
    Transform::translate(-f64::from(shows_at.0), -f64::from(shows_at.1)).then(Transform::scale(
        f64::from(resolution.0) / f64::from(shows_size.0.max(1)),
        f64::from(resolution.1) / f64::from(shows_size.1.max(1)),
    ))
}

/// Maps the window's device pixels back onto the chrome's logical units.
///
/// The other direction from [`logical_to_window`], for input: a pointer arrives
/// at a pixel of the window and the chrome laid itself out in logical units, so
/// a click has to be told where it landed in the chrome's own terms or it will
/// hit whatever happens to be at the same number of pixels.
pub fn window_to_logical(logical: (i32, i32), window: (i32, i32)) -> Transform {
    // A window with no size yet cannot be mapped out of, and an identity is the
    // one answer that neither moves a pointer nor sends it off the desktop.
    logical_to_window(logical, window)
        .inverse()
        .unwrap_or_else(Transform::identity)
}

/// A CSS affine transform as the renderer's matrix.
///
/// `Matrix3::new` takes its arguments **column by column**, so the six CSS
/// values do not go in in the order they are written. Transposing this draws
/// every rotated window sheared the wrong way and every translation along the
/// wrong axis, and nothing about the types catches it.
fn matrix3(transform: Transform) -> Matrix3<f32> {
    let Transform { a, b, c, d, e, f } = transform;
    Matrix3::new(
        a as f32, b as f32, 0.0, // first column
        c as f32, d as f32, 0.0, // second column
        e as f32, f as f32, 1.0, // third column
    )
}

#[cfg(test)]
mod tests {
    use cgmath::Vector3;
    use domicile_scene::{Point, Transform};

    use super::{
        chrome_onto_output, desktop_to_target, logical_to_window, matrix3, window_to_logical,
    };

    /// Where the renderer's matrix sends a point, so it can be compared with
    /// where [`Transform::apply`] says it should go.
    fn through(transform: Transform, x: f64, y: f64) -> (f32, f32) {
        let mapped = matrix3(transform) * Vector3::new(x as f32, y as f32, 1.0);
        (mapped.x, mapped.y)
    }

    fn assert_agrees(transform: Transform, x: f64, y: f64) {
        let expected = transform.apply(Point::new(x, y));
        let (got_x, got_y) = through(transform, x, y);
        assert!(
            (f64::from(got_x) - expected.x).abs() < 1e-4
                && (f64::from(got_y) - expected.y).abs() < 1e-4,
            "matrix disagrees with Transform::apply at ({x}, {y}): \
             got ({got_x}, {got_y}), want ({}, {})",
            expected.x,
            expected.y,
        );
    }

    #[test]
    fn a_translation_moves_a_point_the_same_way_the_transform_does() {
        // The translation lives in the third column. Transposed it lands in the
        // third *row*, where the shader ignores it and every window draws at
        // the origin.
        assert_agrees(Transform::translate(30.0, -12.0), 5.0, 7.0);
    }

    #[test]
    fn a_scale_agrees() {
        assert_agrees(Transform::scale(3.0, 0.5), 4.0, 8.0);
    }

    #[test]
    fn a_rotation_agrees() {
        // Rotation is the case a transpose survives at the origin and fails
        // everywhere else: it inverts the sense of the turn.
        assert_agrees(Transform::rotate(std::f64::consts::FRAC_PI_3), 10.0, 0.0);
        assert_agrees(Transform::rotate(std::f64::consts::FRAC_PI_3), 0.0, 10.0);
    }

    #[test]
    fn a_chrome_committed_at_the_desktop_size_fills_the_window() {
        // The chrome is the desktop, so it has to reach the far corner of what
        // it is drawn into.
        let far = chrome_onto_output(
            (1920.0, 1080.0),
            logical_to_window((1920, 1080), (1280, 720)),
        )
        .apply(Point::new(1.0, 1.0));
        assert!(
            (far.x - 1280.0).abs() < 1e-9 && (far.y - 720.0).abs() < 1e-9,
            "the chrome's far corner landed at {far:?}, not the window's",
        );
    }

    #[test]
    fn a_chrome_still_at_its_old_size_does_not_reach_the_far_corner() {
        // The other half of the same rule, and what stops the one above being
        // satisfied by a placement that stretched the chrome over the output
        // whatever size it committed at: the gap is the point.
        let far = chrome_onto_output((800.0, 600.0), logical_to_window((1920, 1080), (1280, 720)))
            .apply(Point::new(1.0, 1.0));
        assert!(far.x < 1280.0 && far.y < 720.0, "{far:?}");
    }

    #[test]
    fn an_unscaled_window_draws_the_scene_as_it_is() {
        assert_eq!(
            logical_to_window((1280, 800), (1280, 800)),
            Transform::identity(),
        );
    }

    #[test]
    fn a_doubled_window_draws_the_scene_twice_the_size() {
        // The far corner of the desktop is the far corner of the window: a
        // HiDPI output is a sharper desktop, not a desktop with a margin.
        let mapped = logical_to_window((1280, 800), (2560, 1600)).apply(Point::new(1280.0, 800.0));
        assert!((mapped.x - 2560.0).abs() < 1e-9 && (mapped.y - 1600.0).abs() < 1e-9);
    }

    #[test]
    fn an_output_with_no_size_yet_does_not_send_everything_to_infinity() {
        let mapped = logical_to_window((0, 0), (1280, 800)).apply(Point::new(1.0, 1.0));
        assert!(mapped.x.is_finite() && mapped.y.is_finite());
    }

    #[test]
    fn a_click_in_the_corner_of_a_scaled_window_is_a_click_in_the_corner_of_the_desktop() {
        // The round trip that matters: the pointer arrives in device pixels and
        // has to come back as the logical position the chrome laid out in.
        let mapped = window_to_logical((1280, 800), (2560, 1600)).apply(Point::new(2560.0, 1600.0));
        assert!((mapped.x - 1280.0).abs() < 1e-9 && (mapped.y - 800.0).abs() < 1e-9);
    }

    // The whole-desktop cases are not repeated for `desktop_to_target`:
    // `logical_to_window` *is* that call, so `an_unscaled_window_draws_the_scene_as_it_is`
    // and `an_output_with_no_size_yet_does_not_send_everything_to_infinity`
    // above already exercise it. What is left is the two things only a
    // per-display target does.
    #[test]
    fn a_target_showing_the_second_display_puts_its_near_edge_at_the_origin() {
        // The right-hand display of a 1920 + 2560 desktop. Its own top-left is
        // 1920 across the desktop and pixel zero of its own framebuffer —
        // which is the whole difference between compositing per display and
        // compositing the desktop once.
        let mapped =
            desktop_to_target((1920, 0), (2560, 1440), (2560, 1440)).apply(Point::new(1920.0, 0.0));
        assert!(
            mapped.x.abs() < 1e-9 && mapped.y.abs() < 1e-9,
            "the display's own corner landed at {mapped:?}",
        );
    }

    #[test]
    fn a_denser_display_draws_its_own_logical_units_at_its_own_scale() {
        // The mixed-density case, and the reason this exists. Two displays
        // side by side, 1920 logical each: the left at scale 1, the right at
        // scale 2. Each target is that display's *mode* — its logical size in
        // physical pixels — so one logical unit is one pixel on the left and
        // two on the right.
        let left = desktop_to_target((0, 0), (1920, 1080), (1920, 1080));
        let right = desktop_to_target((1920, 0), (1920, 1080), (3840, 2160));
        assert!((left.a - 1.0).abs() < 1e-9, "left drew at {}", left.a);
        assert!((right.a - 2.0).abs() < 1e-9, "right drew at {}", right.a);
    }

    #[test]
    fn mapping_into_the_window_and_back_lands_where_it_started() {
        let there = logical_to_window((1280, 800), (1920, 1200));
        let back = window_to_logical((1280, 800), (1920, 1200));
        let start = Point::new(317.0, 219.0);
        let round_trip = back.apply(there.apply(start));
        assert!(
            (round_trip.x - start.x).abs() < 1e-9 && (round_trip.y - start.y).abs() < 1e-9,
            "round trip landed at {round_trip:?}",
        );
    }

    #[test]
    fn a_window_with_no_size_yet_leaves_a_pointer_where_it_is() {
        // Not invertible, and a pointer sent to infinity is worse than one that
        // has not been mapped.
        let mapped = window_to_logical((1280, 800), (0, 0)).apply(Point::new(4.0, 9.0));
        assert!(mapped.x.is_finite() && mapped.y.is_finite());
    }

    #[test]
    fn a_transform_with_every_term_distinct_agrees() {
        // Nothing symmetric: each of the six values differs, so any two of them
        // swapped shows up.
        assert_agrees(
            Transform {
                a: 2.0,
                b: 3.0,
                c: 5.0,
                d: 7.0,
                e: 11.0,
                f: 13.0,
            },
            17.0,
            19.0,
        );
    }
}

/// Composing real pixels, which needs a working EGL/GLES stack.
///
/// Ignored by default because CI's compositor job installs only libxkbcommon —
/// there is no GL there and these would fail for the wrong reason. Run them
/// with `scripts/e2e-compose.sh`, which is where a machine that *has* a
/// renderer exercises them.
#[cfg(test)]
mod pixels {
    use domicile_scene::{Portal, Scene, Transform};
    use smithay::backend::allocator::Fourcc;
    use smithay::backend::egl::{EGLContext, EGLDevice, EGLDisplay};
    use smithay::backend::renderer::gles::{GlesRenderer, GlesTexture};
    use smithay::backend::renderer::{
        Bind, Color32F, ExportMem, Frame, ImportMem, Offscreen, Renderer, Texture as _,
    };
    use smithay::utils::{Point, Rectangle, Size, Transform as OutputTransform};

    use super::{desktop_to_target, draw_layers, Layer, Shaders, Shadow};

    const OUTPUT: (i32, i32) = (64, 48);

    /// A renderer with no window and no GPU: EGL's own device enumeration will
    /// hand over a software rasteriser where there is no hardware, which is
    /// enough to composite and read back.
    fn renderer() -> GlesRenderer {
        // SAFETY: opens the library Smithay opens a moment later, running the
        // initialisers it would have run itself.
        unsafe { libloading::Library::new("libEGL.so.1") }.expect("libEGL loads");
        let device = EGLDevice::enumerate()
            .expect("EGL enumerates devices")
            .next()
            .expect("EGL offers some device");
        // SAFETY: the device comes from EGL's own enumeration and the display
        // owns it from here on.
        let display = unsafe { EGLDisplay::new(device) }.expect("an EGL display");
        let context = EGLContext::new(&display).expect("an EGL context");
        // SAFETY: created and used on this thread, where it is current.
        unsafe { GlesRenderer::new(context) }.expect("a GLES renderer")
    }

    /// A solid-colour texture. Tiny on purpose: what is being checked is where
    /// it lands, not what it contains.
    fn solid(renderer: &mut GlesRenderer, rgba: [u8; 4]) -> GlesTexture {
        let pixels: Vec<u8> = rgba.iter().copied().cycle().take(8 * 8 * 4).collect();
        renderer
            .import_memory(&pixels, Fourcc::Abgr8888, (8, 8).into(), false)
            .expect("a memory texture imports")
    }

    /// A texture whose top half is `rgba` and bottom half is black, so which
    /// way up it is drawn is visible in the result. `y_inverted` is what
    /// `import_memory` records on the texture, and so what a client handing
    /// over a GL-rendered buffer produces.
    fn gradient(renderer: &mut GlesRenderer, rgba: [u8; 4], y_inverted: bool) -> GlesTexture {
        const SIDE: usize = 8;
        let mut pixels = Vec::with_capacity(SIDE * SIDE * 4);
        for row in 0..SIDE {
            for _ in 0..SIDE {
                pixels.extend_from_slice(if row < SIDE / 2 {
                    &rgba
                } else {
                    &[0, 0, 0, 255]
                });
            }
        }
        renderer
            .import_memory(
                &pixels,
                Fourcc::Abgr8888,
                (SIDE as i32, SIDE as i32).into(),
                y_inverted,
            )
            .expect("a memory texture imports")
    }

    /// Compose the layers and hand back the output as row-major RGBA.
    fn composed(renderer: &mut GlesRenderer, layers: &[Layer<'_>]) -> Vec<u8> {
        composed_into(renderer, layers, OUTPUT)
    }

    /// The same, into a target of a stated size.
    ///
    /// A target is a framebuffer and the part of the desktop it shows, so its
    /// size is that display's mode rather than the desktop's — which is the
    /// whole of how a mixed-density desktop is drawn at each display's own
    /// density. `composed` is the case where the one target shows everything.
    fn composed_into(
        renderer: &mut GlesRenderer,
        layers: &[Layer<'_>],
        size: (i32, i32),
    ) -> Vec<u8> {
        let shaders = Shaders::compile(renderer).expect("the compositor's shader compiles");
        let buffer_size = Size::from(size);
        let physical = Size::from(size);
        let mut target: GlesTexture = renderer
            .create_buffer(Fourcc::Abgr8888, buffer_size)
            .expect("an offscreen buffer");
        let mut framebuffer = renderer.bind(&mut target).expect("binding it");
        {
            let mut frame = renderer
                .render(&mut framebuffer, physical, OutputTransform::Normal)
                .expect("a frame");
            frame
                .clear(
                    Color32F::new(0.0, 0.0, 0.0, 1.0),
                    &[Rectangle::from_size(physical)],
                )
                .expect("clearing");
            draw_layers(&mut frame, &shaders, layers).expect("drawing the layers");
            let sync = frame.finish().expect("finishing");
            renderer.wait(&sync).expect("waiting for the draw");
        }
        let mapping = renderer
            .copy_framebuffer(
                &framebuffer,
                Rectangle::from_size(buffer_size),
                Fourcc::Abgr8888,
            )
            .expect("copying the framebuffer");
        renderer.map_texture(&mapping).expect("mapping it").to_vec()
    }

    /// The same layer drawn by Smithay itself, for comparison.
    fn drawn_by_smithay(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        dest: Rectangle<i32, smithay::utils::Physical>,
    ) -> Vec<u8> {
        // Smithay reads the inversion off the texture itself, so nothing is
        // passed for it here — which is the point: it is the authority on what
        // a y-inverted texture should look like drawn.
        let buffer_size = Size::from(OUTPUT);
        let physical = Size::from(OUTPUT);
        let mut target: GlesTexture = renderer
            .create_buffer(Fourcc::Abgr8888, buffer_size)
            .expect("an offscreen buffer");
        let mut framebuffer = renderer.bind(&mut target).expect("binding it");
        {
            let mut frame = renderer
                .render(&mut framebuffer, physical, OutputTransform::Normal)
                .expect("a frame");
            frame
                .clear(
                    Color32F::new(0.0, 0.0, 0.0, 1.0),
                    &[Rectangle::from_size(physical)],
                )
                .expect("clearing");
            frame
                .render_texture_from_to(
                    texture,
                    Rectangle::from_size(texture.size()).to_f64(),
                    dest,
                    &[Rectangle::from_size(dest.size)],
                    &[],
                    OutputTransform::Normal,
                    1.0,
                    None,
                    &[],
                )
                .expect("Smithay draws it");
            let sync = frame.finish().expect("finishing");
            renderer.wait(&sync).expect("waiting for the draw");
        }
        let mapping = renderer
            .copy_framebuffer(
                &framebuffer,
                Rectangle::from_size(buffer_size),
                Fourcc::Abgr8888,
            )
            .expect("copying the framebuffer");
        renderer.map_texture(&mapping).expect("mapping it").to_vec()
    }

    /// The pixel at `(x, y)`, counting down from the top-left.
    fn pixel(output: &[u8], x: i32, y: i32) -> [u8; 4] {
        pixel_of(output, OUTPUT.0, x, y)
    }

    /// The pixel at `(x, y)` of an output `stride` pixels across.
    ///
    /// `pixel` assumes the whole-desktop target every other test here draws
    /// into; a per-display target is its display's mode and so has a stride of
    /// its own.
    fn pixel_of(output: &[u8], stride: i32, x: i32, y: i32) -> [u8; 4] {
        let at = ((y * stride + x) * 4) as usize;
        [output[at], output[at + 1], output[at + 2], output[at + 3]]
    }

    /// The middle of the output: where a centred window's own middle lands,
    /// and what a turned one is turned about.
    const MIDDLE: (i32, i32) = (OUTPUT.0 / 2, OUTPUT.1 / 2);

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];
    const BLACK: [u8; 4] = [0, 0, 0, 255];

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_display_is_drawn_into_a_target_of_its_own_at_its_own_density() {
        // The mixed-density case, through the real renderer.
        //
        // A 64x48 desktop of two 32x48 displays side by side. The right one is
        // at scale 2, so its own target is its mode — 64x96 — while the whole
        // desktop at scale 1 would be 64x48. One window covers the *left half*
        // of the right display: desktop x 32..48.
        //
        // Where that window's far edge lands is what tells the two apart. Into
        // the right display's own target it is at pixel 32 of 64, because that
        // target shows 32 logical units across 64 pixels. Composited once over
        // the whole desktop it would be at pixel 48 — the desktop coordinate
        // itself, one pixel per unit.
        //
        // So the three assertions bracket the edge rather than any one of them
        // carrying the test. Drawing this display at the desktop's density
        // instead — `(32, 48)` for the target below — puts the edge at pixel
        // 16, and it is the *inside* assertion at 24 that goes red; the
        // background one at 40 still passes, because 40 is past the edge under
        // either density. Checked, both ways round.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        // Bound once: the stride the pixels are read back at is this target's
        // own width, and two literals that have to agree are two literals that
        // can stop agreeing.
        const TARGET: (i32, i32) = (64, 96);
        let to_target = desktop_to_target((32, 0), (32, 48), TARGET);
        let output = composed_into(
            &mut renderer,
            &[Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius: 0.0,
                shadow: None,
                // The window in desktop coordinates, then onto this display's
                // own target — the same two steps `present` composes, with the
                // second one per display rather than once.
                surface_to_output: Transform::scale(16.0, 48.0)
                    .then(Transform::translate(32.0, 0.0))
                    .then(to_target),
                texture: &red,
                y_inverted: false,
            }],
            TARGET,
        );
        assert_eq!(
            pixel_of(&output, TARGET.0, 8, 8),
            RED,
            "the window should cover this display's left half",
        );
        assert_eq!(
            pixel_of(&output, TARGET.0, 24, 8),
            RED,
            "still inside the window, at 3/4 of the way to its edge",
        );
        assert_eq!(
            pixel_of(&output, TARGET.0, 40, 8),
            BLACK,
            "past the window's edge under either density — the pair with the \
             assertion above is what pins where that edge is",
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_portal_lands_where_the_scene_says_it_does() {
        // Two portals in opposite corners. Placement, scaling and orientation
        // all have to be right for both to land, and a Y flip swaps them —
        // which is exactly the failure a single centred quad cannot show.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let blue = solid(&mut renderer, BLUE);

        let top_left = Portal::new("red", (32.0, 24.0), Transform::identity(), 0);
        let bottom_right = Portal::new("blue", (32.0, 24.0), Transform::translate(32.0, 24.0), 0);

        let output = composed(
            &mut renderer,
            &[
                Layer {
                    alpha: 1.0,
                    clip: &[],
                    corner_radius: 0.0,
                    shadow: None,
                    surface_to_output: top_left.surface_to_output(),
                    texture: &red,
                    y_inverted: false,
                },
                Layer {
                    alpha: 1.0,
                    clip: &[],
                    corner_radius: 0.0,
                    shadow: None,
                    surface_to_output: bottom_right.surface_to_output(),
                    texture: &blue,
                    y_inverted: false,
                },
            ],
        );

        assert_eq!(pixel(&output, 8, 6), RED, "top-left quadrant");
        assert_eq!(pixel(&output, 48, 36), BLUE, "bottom-right quadrant");
        assert_eq!(pixel(&output, 48, 6), BLACK, "top-right stays cleared");
        assert_eq!(pixel(&output, 8, 36), BLACK, "bottom-left stays cleared");
    }

    /// The same placement drawn two ways: ours, and Smithay's own
    /// `render_texture_from_to`, which is the path its example compositors use
    /// on a window and so the one known to come out the right way up there.
    ///
    /// Ours has to generalise it — a portal is an arbitrary CSS matrix, and
    /// `render_texture_from_to` takes an axis-aligned rectangle — but where the
    /// two can express the same thing they must draw the same pixels. Anything
    /// this catches is an orientation bug the single-path tests cannot see,
    /// because they only ever compare us against ourselves.
    /// Ours against Smithay's for one texture, as pixel coordinates that differ.
    fn disagreements(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        y_inverted: bool,
    ) -> Vec<(i32, i32)> {
        // Off-centre and not square, so a flip in either axis moves it.
        let dest = Rectangle::new(Point::from((8, 6)), Size::from((24, 12)));
        let ours = composed(
            renderer,
            &[Layer {
                alpha: 1.0,
                // Square, so this still compares against Smithay's own drawing
                // rather than against a shape it cannot make.
                clip: &[],
                corner_radius: 0.0,
                shadow: None,
                surface_to_output: Transform::scale(24.0, 12.0)
                    .then(Transform::translate(8.0, 6.0)),
                texture,
                y_inverted,
            }],
        );
        let theirs = drawn_by_smithay(renderer, texture, dest);
        ours.chunks_exact(4)
            .zip(theirs.chunks_exact(4))
            .enumerate()
            .filter(|(_, (a, b))| a != b)
            .map(|(at, _)| ((at as i32) % OUTPUT.0, (at as i32) / OUTPUT.0))
            .collect()
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_y_inverted_texture_is_drawn_the_other_way_up() {
        // A client that renders with GL hands over a buffer whose rows run
        // bottom-to-top — which is every client that matters, the chrome
        // included. Drawing it as if they did not turns the desktop upside
        // down, and nothing about the types says which way round a buffer is.
        //
        // Deliberately not compared against `render_texture_from_to` the way
        // the placement is: Smithay flips by negating the coordinate rather
        // than reflecting it, so on a texture whose wrap mode clamps it samples
        // the first row for the whole quad instead of the image upside down.
        // It is the authority on where a quad lands, not on this.
        let mut renderer = renderer();
        // Red on top, black below.
        let texture = gradient(&mut renderer, RED, true);

        let output = composed(
            &mut renderer,
            &[Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius: 0.0,
                shadow: None,
                surface_to_output: Transform::scale(f64::from(OUTPUT.0), f64::from(OUTPUT.1)),
                texture: &texture,
                y_inverted: true,
            }],
        );

        let top = pixel(&output, OUTPUT.0 / 2, OUTPUT.1 / 4);
        let bottom = pixel(&output, OUTPUT.0 / 2, OUTPUT.1 * 3 / 4);
        assert_eq!(top, BLACK, "the buffer's last row is drawn at the top");
        assert_eq!(bottom, RED, "the buffer's first row is drawn at the bottom");
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_texture_that_is_not_inverted_is_drawn_as_it_is() {
        // The other half of the pair: without this, "always flip" passes the
        // test above and turns every client upside down instead.
        let mut renderer = renderer();
        let texture = gradient(&mut renderer, RED, false);

        let output = composed(
            &mut renderer,
            &[Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius: 0.0,
                shadow: None,
                surface_to_output: Transform::scale(f64::from(OUTPUT.0), f64::from(OUTPUT.1)),
                texture: &texture,
                y_inverted: false,
            }],
        );

        assert_eq!(pixel(&output, OUTPUT.0 / 2, OUTPUT.1 / 4), RED, "top");
        assert_eq!(
            pixel(&output, OUTPUT.0 / 2, OUTPUT.1 * 3 / 4),
            BLACK,
            "bottom"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn we_draw_a_placement_the_way_smithay_draws_it() {
        let mut renderer = renderer();
        // Patterned, not solid: a uniform colour looks the same however the
        // texture is mapped onto the quad, so it would compare only where the
        // quad landed and nothing about what is drawn in it.
        let red = gradient(&mut renderer, RED, false);

        // Off-centre and not square, so a flip in either axis moves it.
        let differing = disagreements(&mut renderer, &red, false);
        assert!(
            differing.is_empty(),
            "we disagree with Smithay's own texture path at {} pixels, first at {:?}",
            differing.len(),
            differing.first(),
        );
    }

    /// A full-output layer of one colour, with the given radius and alpha.
    fn full_output(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        corner_radius: f32,
        alpha: f32,
    ) -> Vec<u8> {
        composed(
            renderer,
            &[Layer {
                alpha,
                clip: &[],
                corner_radius,
                shadow: None,
                surface_to_output: Transform::scale(f64::from(OUTPUT.0), f64::from(OUTPUT.1)),
                texture,
                y_inverted: false,
            }],
        )
    }

    /// A window in the middle of the output, with room around it for a shadow
    /// to fall into — the whole point of a shadow being that it is outside.
    const INSET: (f64, f64) = (16.0, 12.0);

    fn shadowed(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        shadow: Option<Shadow>,
    ) -> Vec<u8> {
        composed(
            renderer,
            &[Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius: 0.0,
                shadow,
                surface_to_output: Transform::scale(
                    f64::from(OUTPUT.0) - INSET.0 * 2.0,
                    f64::from(OUTPUT.1) - INSET.1 * 2.0,
                )
                .then(Transform::translate(INSET.0, INSET.1)),
                texture,
                y_inverted: false,
            }],
        )
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_rounded_window_is_cut_away_at_its_corners() {
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);

        let output = full_output(&mut renderer, &red, 16.0, 1.0);

        assert_eq!(
            pixel(&output, OUTPUT.0 / 2, OUTPUT.1 / 2),
            RED,
            "the middle of the window is the window"
        );
        assert_eq!(
            pixel(&output, 0, 0),
            BLACK,
            "the corner is outside the rounded rectangle, so what is behind shows"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_clipped_layer_draws_only_inside_its_bands() {
        // What interleaving needs. The chrome is one texture drawn over
        // everything, so putting a window *between* two pieces of it means
        // drawing that texture more than once, each time confined to the part
        // of the screen that piece occupies — by region, because a texture
        // carries no per-fragment depth to be sliced by.
        //
        // Two disjoint bands of one full-output texture, and between them the
        // texture must not be drawn at all. That gap is where a window goes.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let full = Portal::new(
            "chrome",
            (OUTPUT.0 as f64, OUTPUT.1 as f64),
            Transform::identity(),
            0,
        );

        let output = composed(
            &mut renderer,
            &[Layer {
                alpha: 1.0,
                // `[x, y, width, height]` in the unit square's own space,
                // which is what `surface_to_output` maps: the top eighth of
                // the quad, and a band an eighth tall and a quarter wide
                // starting a quarter of the way down and across.
                //
                // The second band is deliberately not full width. Two
                // full-width bands are drawn identically by a renderer that
                // discards `x` and `width` altogether, so a picture made of
                // those alone agrees with the code being half wrong.
                clip: &[[0.0, 0.0, 1.0, 0.125], [0.25, 0.25, 0.25, 0.125]],
                corner_radius: 0.0,
                shadow: None,
                surface_to_output: full.surface_to_output(),
                texture: &red,
                y_inverted: false,
            }],
        );

        assert_eq!(pixel(&output, MIDDLE.0, 1), RED, "the top band is drawn");
        assert_eq!(
            pixel(&output, 20, 14),
            RED,
            "the narrow band is drawn where it starts"
        );
        assert_eq!(
            pixel(&output, 40, 14),
            BLACK,
            "and stops at its width, rather than running the whole way across"
        );
        assert_eq!(
            pixel(&output, MIDDLE.0, 9),
            BLACK,
            "between the bands the chrome is absent, which is where a window goes"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_window_that_asked_for_no_rounding_keeps_its_corners() {
        // Without this, a shader that rounds everything unconditionally passes
        // the test above and quietly clips every window that wanted square
        // edges.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);

        let output = full_output(&mut renderer, &red, 0.0, 1.0);

        assert_eq!(
            pixel(&output, 0, 0),
            RED,
            "the corner is part of the window"
        );
    }

    /// A shadow offset down-right, with room to blur.
    ///
    /// Green rather than the black a real one is, because the tests draw onto a
    /// black output: a black shadow is indistinguishable from no shadow, and a
    /// test that cannot tell those apart passes when nothing is drawn at all.
    const CAST: Shadow = Shadow {
        blur: 6.0,
        color: [0.0, 1.0, 0.0, 1.0],
        dx: 6.0,
        dy: 6.0,
        spread: 0.0,
    };

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_darkens_the_desktop_outside_the_window() {
        // Just below the window's bottom edge, where the shadow falls and the
        // window does not. The output was cleared to black, so a shadow of any
        // colour has to be compared against a run without one.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let at = (OUTPUT.0 / 2, OUTPUT.1 - INSET.1 as i32 + 3);

        let without = shadowed(&mut renderer, &red, None);
        let with = shadowed(&mut renderer, &red, Some(CAST));

        assert_eq!(
            pixel(&without, at.0, at.1),
            BLACK,
            "nothing is drawn outside a window that casts nothing"
        );
        // The green channel, not the alpha: the output was cleared to opaque
        // black, so alpha is already 255 everywhere and an assertion on it
        // holds whether or not anything was drawn.
        assert!(
            pixel(&with, at.0, at.1)[1] > 0,
            "a shadow is drawn where the window is not"
        );
        assert_ne!(
            pixel(&with, at.0, at.1),
            pixel(&without, at.0, at.1),
            "a shadow changes what is outside the window, or it is not a shadow"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_does_not_cover_the_window_it_belongs_to() {
        // Drawn under the window, not over it. Getting the order wrong puts a
        // dark sheet across every client and is the obvious way to do this
        // wrong.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);

        let output = shadowed(&mut renderer, &red, Some(CAST));

        assert_eq!(
            pixel(&output, OUTPUT.0 / 2, OUTPUT.1 / 2),
            RED,
            "the window is on top of its own shadow"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_fades_out_with_distance() {
        // What makes it a shadow rather than a rectangle: nearer the window is
        // darker. A blur that did nothing would make these two equal.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let x = OUTPUT.0 / 2;
        let edge = OUTPUT.1 - INSET.1 as i32;

        let output = shadowed(&mut renderer, &red, Some(CAST));

        let near = pixel(&output, x, edge + 2)[1];
        let far = pixel(&output, x, edge + 9)[1];
        assert!(
            near > far,
            "a shadow is strongest against the window it falls from: \
             near={near} far={far}",
        );
    }

    /// The same shadow thrown along one axis only, for tests about *where* a
    /// shadow lands rather than what it looks like.
    const SIDEWAYS: Shadow = Shadow {
        blur: 4.0,
        color: [0.0, 1.0, 0.0, 1.0],
        dx: 8.0,
        dy: 0.0,
        spread: 0.0,
    };

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_falls_the_way_it_is_thrown() {
        // The offset is the whole difference between a shadow and a glow, and
        // every other test here probes below the window — where a shadow that
        // ignored its offset entirely still reaches. Two points either side of
        // the window at the same distance can only differ because of it.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let y = OUTPUT.1 / 2;

        let output = shadowed(&mut renderer, &red, Some(SIDEWAYS));

        let downwind = pixel(&output, OUTPUT.0 - INSET.0 as i32 + 2, y)[1];
        let upwind = pixel(&output, INSET.0 as i32 - 2, y)[1];
        assert!(
            downwind > upwind,
            "the shadow is thrown to one side: downwind={downwind} upwind={upwind}",
        );
        assert_eq!(upwind, 0, "and nothing falls the other way");
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_is_not_drawn_under_the_window_it_falls_from() {
        // CSS clips an outer shadow to outside the border box. Drawing it
        // under the whole window instead is invisible while the window is
        // opaque and bleeds through the moment it is not — so the window here
        // is translucent, which is the only way to see the difference.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let centred = Shadow {
            blur: 6.0,
            color: [0.0, 1.0, 0.0, 1.0],
            dx: 0.0,
            dy: 0.0,
            spread: 0.0,
        };
        let without = translucent(&mut renderer, &red, None);
        let with = translucent(&mut renderer, &red, Some(centred));

        assert_eq!(
            pixel(&with, MIDDLE.0, MIDDLE.1),
            pixel(&without, MIDDLE.0, MIDDLE.1),
            "a window shows what is behind it, not the shadow it casts itself"
        );
    }

    /// A half-transparent window over the cleared output, so anything drawn
    /// underneath it shows through.
    fn translucent(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        shadow: Option<Shadow>,
    ) -> Vec<u8> {
        composed(
            renderer,
            &[Layer {
                alpha: 0.5,
                clip: &[],
                corner_radius: 0.0,
                shadow,
                surface_to_output: Transform::scale(
                    f64::from(OUTPUT.0) - INSET.0 * 2.0,
                    f64::from(OUTPUT.1) - INSET.1 * 2.0,
                )
                .then(Transform::translate(INSET.0, INSET.1)),
                texture,
                y_inverted: false,
            }],
        )
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_spread_makes_a_shadow_bigger_than_what_casts_it() {
        // Without this nothing exercises `spread` at all: it would be a field
        // that travels the whole protocol and changes nothing.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let spread = Shadow {
            spread: 5.0,
            ..SIDEWAYS
        };
        // Beyond where the unspread shadow's blur reaches — its rectangle ends
        // 8px past the window's right edge and fades out 2px after that — so
        // only the spread can put anything here.
        let at = (OUTPUT.0 - 4, OUTPUT.1 / 2);

        let tight = shadowed(&mut renderer, &red, Some(SIDEWAYS));
        let wide = shadowed(&mut renderer, &red, Some(spread));

        assert_eq!(
            pixel(&tight, at.0, at.1)[1],
            0,
            "an unspread shadow stops short of here"
        );
        assert!(
            pixel(&wide, at.0, at.1)[1] > 0,
            "and a spread one reaches it"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_rounded_window_casts_a_rounded_shadow() {
        // The shadow is cast by the window's shape, not by its bounding box.
        // Nothing else pairs a radius with a shadow, so without this the
        // radius could be dropped on the way into the shadow's shader and
        // every test would still pass.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let centred = Shadow {
            blur: 1.0,
            color: [0.0, 1.0, 0.0, 1.0],
            dx: 0.0,
            dy: 0.0,
            spread: 4.0,
        };
        // Diagonally out from the window's corner: inside the shadow of a
        // square window, outside the shadow of a well-rounded one.
        let at = (INSET.0 as i32 - 3, INSET.1 as i32 - 3);

        let square = rounded_and_shadowed(&mut renderer, &red, 0.0, centred);
        let round = rounded_and_shadowed(&mut renderer, &red, 12.0, centred);

        assert!(
            pixel(&square, at.0, at.1)[1] > 0,
            "a square window's shadow reaches its corner"
        );
        assert_eq!(
            pixel(&round, at.0, at.1)[1],
            0,
            "a rounded window's shadow is cut back with it"
        );
    }

    fn rounded_and_shadowed(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        corner_radius: f32,
        shadow: Shadow,
    ) -> Vec<u8> {
        composed(
            renderer,
            &[Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius,
                shadow: Some(shadow),
                surface_to_output: Transform::scale(
                    f64::from(OUTPUT.0) - INSET.0 * 2.0,
                    f64::from(OUTPUT.1) - INSET.1 * 2.0,
                )
                .then(Transform::translate(INSET.0, INSET.1)),
                texture,
                y_inverted: false,
            }],
        )
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_fades_out_half_a_blur_past_its_edge() {
        // CSS defines the blur radius as a transition centred on the shadow's
        // edge, so it reaches half the radius beyond it — not the whole
        // radius, which would make every shadow twice as soft and twice as
        // far-reaching as it was authored. Nothing else here pins the width:
        // a falloff of any size passes every other shadow test.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let soft = Shadow {
            blur: 12.0,
            color: [0.0, 1.0, 0.0, 1.0],
            dx: 0.0,
            dy: 0.0,
            spread: 0.0,
        };
        let edge = OUTPUT.0 - INSET.0 as i32;
        let y = OUTPUT.1 / 2;

        let output = shadowed(&mut renderer, &red, Some(soft));

        assert!(
            pixel(&output, edge + 4, y)[1] > 0,
            "the shadow is still fading four pixels out"
        );
        // Nearly gone one pixel before it ends, rather than dropping off a
        // cliff. A falloff wider than the quad it is drawn in reaches this
        // pixel at full strength and is then cut off square by the quad's
        // edge — which is what a blur measured across its whole radius, rather
        // than half of it, does to every shadow on the desktop.
        assert!(
            pixel(&output, edge + 5, y)[1] < 8,
            "the shadow fades out rather than being cut off square: {}",
            pixel(&output, edge + 5, y)[1],
        );
        assert_eq!(
            pixel(&output, edge + 6, y)[1],
            0,
            "and is gone by six, which is half of the twelve it was given"
        );
    }

    /// A square window turned 45 degrees about the middle of the output.
    ///
    /// Square and turned by an eighth so the shape it covers is a diamond,
    /// which no unturned placement can produce however it is scaled — a test
    /// against a turn that did not happen needs somewhere the window can only
    /// be if it did.
    fn turned(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        corner_radius: f32,
        shadow: Option<Shadow>,
    ) -> Vec<u8> {
        composed(
            renderer,
            &[Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius,
                shadow,
                // Built the way a page builds one: sized, moved so the turn is
                // about its own middle rather than its top-left corner, turned,
                // and put where it goes.
                surface_to_output: Transform::scale(TURNED_SIDE, TURNED_SIDE)
                    .then(Transform::translate(-TURNED_SIDE / 2.0, -TURNED_SIDE / 2.0))
                    .then(Transform::rotate(std::f64::consts::FRAC_PI_4))
                    .then(Transform::translate(
                        f64::from(MIDDLE.0),
                        f64::from(MIDDLE.1),
                    )),
                texture,
                y_inverted: false,
            }],
        )
    }

    /// Small enough that the diamond and the shadow around it both fit.
    const TURNED_SIDE: f64 = 24.0;

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_turned_window_covers_what_it_is_turned_onto() {
        // The success criterion the whole native path was for: an app window is
        // an element, so a page that turns one gets a turned window rather than
        // an upright one in a turned box.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);

        let output = turned(&mut renderer, &red, 0.0, None);

        assert_eq!(
            pixel(&output, MIDDLE.0, MIDDLE.1),
            RED,
            "the middle of a window is the window however it is turned"
        );
        // A quarter of the way out along both axes at once: inside the upright
        // square, outside the diamond the turn makes of it.
        assert_eq!(
            pixel(&output, MIDDLE.0 + 10, MIDDLE.1 + 10),
            BLACK,
            "the corner the turn moved away from"
        );
        // Further out along one axis than an upright window of this size
        // reaches, which only the turned diamond's tip covers.
        assert_eq!(
            pixel(&output, MIDDLE.0 + 15, MIDDLE.1),
            RED,
            "the tip the turn brought here"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_turned_window_is_rounded_in_the_pixels_it_covers() {
        // A radius is a length on the screen, so a window turned by an eighth
        // is rounded the same as one that is not — which is why the quad is
        // measured by the lengths of its sides rather than by its matrix's
        // scale terms, and what the last assertion here holds to.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);

        let square = turned(&mut renderer, &red, 0.0, None);
        // Most of the radius this window can take. A turned corner is a thin
        // wedge — the diamond's tip is only a couple of pixels deeper than a
        // modest radius cuts to, which is inside the one pixel the edge is
        // smoothed over and so not something a test can read.
        let round = turned(&mut renderer, &red, 10.0, None);

        assert_eq!(
            pixel(&square, MIDDLE.0 + 15, MIDDLE.1),
            RED,
            "a square window reaches its turned corner"
        );
        assert_eq!(
            pixel(&round, MIDDLE.0 + 15, MIDDLE.1),
            BLACK,
            "and a radius cuts that corner off"
        );
        // Either side of the tip, where the window's own corner lands after the
        // turn. This is the only place a mis-measured quad shows — the shader
        // spans the quad whatever size it is told, so the size it is told
        // changes nothing but how deep the radius eats the corner — and it
        // takes both samples to see it, because one alone is blind in one
        // direction. A window measured by its matrix's scale terms reports
        // itself 71% of its size and eats the corner half again as deep; one
        // measured by its bounding box reports 141% and barely eats it at all.
        assert_eq!(
            pixel(&round, MIDDLE.0, MIDDLE.1 + 11),
            RED,
            "a radius is a length on the screen, not a fraction of a window"
        );
        assert_eq!(
            pixel(&round, MIDDLE.0, MIDDLE.1 + 13),
            BLACK,
            "and the corner really is eaten, so an over-measured quad is caught too"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_turned_window_is_rounded_and_shadowed_at_once() {
        // The success criterion itself, which the three tests around this one
        // only cover a face at a time: turned *and* rounded *and* shadowed
        // together. The pairing that needs a window wearing one of each is the
        // green-channel assertion — the shadow is kept out from under the
        // window by the window's *rounded* shape, so the corner a radius eats
        // away is the corner the shadow is free to fill. A cut-out that
        // ignored the radius would leave it empty, and nothing else here
        // would notice.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let sideways = Shadow {
            blur: 4.0,
            color: [0.0, 1.0, 0.0, 1.0],
            dx: 6.0,
            dy: 0.0,
            spread: 0.0,
        };

        let output = turned(&mut renderer, &red, 10.0, Some(sideways));

        assert_eq!(
            pixel(&output, MIDDLE.0, MIDDLE.1),
            RED,
            "the window is still the window"
        );
        // The red channel, not the whole pixel: the window's own colour is
        // gone from its rounded-away corner, but the shadow it casts may well
        // be there — which is the point of drawing both.
        assert_eq!(
            pixel(&output, MIDDLE.0 + 15, MIDDLE.1)[0],
            0,
            "its corner is still rounded away"
        );
        assert!(
            pixel(&output, MIDDLE.0 + 15, MIDDLE.1)[1] > 0,
            "and the shadow it casts fills the corner it rounded away"
        );
        let with = pixel(&output, MIDDLE.0 + 12, MIDDLE.1 + 12)[1];
        let against = pixel(&output, MIDDLE.0 - 12, MIDDLE.1 - 12)[1];
        assert!(
            with > against,
            "and its shadow still falls the way it faces: with={with} against={against}",
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_turned_windows_shadow_turns_with_it() {
        // CSS offsets a shadow in the element's own space, so an element the
        // page turned casts its shadow the way it is facing. A shadow placed in
        // the output's axes instead would fall to the right of every window on
        // the desktop no matter which way it was turned.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let sideways = Shadow {
            blur: 4.0,
            color: [0.0, 1.0, 0.0, 1.0],
            // Along the window's own x, which the turn points down and right.
            dx: 6.0,
            dy: 0.0,
            spread: 0.0,
        };

        let output = turned(&mut renderer, &red, 0.0, Some(sideways));

        let with = pixel(&output, MIDDLE.0 + 12, MIDDLE.1 + 12)[1];
        let against = pixel(&output, MIDDLE.0 - 12, MIDDLE.1 - 12)[1];
        assert!(
            with > against,
            "the shadow falls the way the window faces: with={with} against={against}",
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_does_not_care_which_way_up_the_client_drew() {
        // A shadow is a shape, not a picture, so the quad never samples the
        // texture and which way up the client's buffer is cannot matter. It
        // did: the shadow's quad carried the texture's orientation, and the
        // offset — the first thing about a shadow that is not symmetric —
        // came out mirrored, putting the cut-out on the wrong side and the
        // shadow through the middle of the window. Every client that renders
        // with GL hands over an inverted buffer, so this was most of them.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let downward = Shadow {
            blur: 2.0,
            color: [0.0, 1.0, 0.0, 1.0],
            dx: 0.0,
            dy: 8.0,
            spread: 0.0,
        };

        let upright = inverted_or_not(&mut renderer, &red, downward, false);
        let flipped = inverted_or_not(&mut renderer, &red, downward, true);

        let differing = upright
            .chunks_exact(4)
            .zip(flipped.chunks_exact(4))
            .filter(|(a, b)| a != b)
            .count();
        assert_eq!(differing, 0, "{differing} pixels differ");
    }

    /// The same translucent window and shadow, drawn as though the client's
    /// buffer were the right way up and as though it were not.
    fn inverted_or_not(
        renderer: &mut GlesRenderer,
        texture: &GlesTexture,
        shadow: Shadow,
        y_inverted: bool,
    ) -> Vec<u8> {
        composed(
            renderer,
            &[Layer {
                // Translucent, so a shadow drawn under the window shows rather
                // than hiding behind it.
                alpha: 0.5,
                clip: &[],
                corner_radius: 0.0,
                shadow: Some(shadow),
                surface_to_output: Transform::scale(
                    f64::from(OUTPUT.0) - INSET.0 * 2.0,
                    f64::from(OUTPUT.1) - INSET.1 * 2.0,
                )
                .then(Transform::translate(INSET.0, INSET.1)),
                texture,
                y_inverted,
            }],
        )
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_square_window_casts_a_square_shadow_however_far_it_is_spread() {
        // CSS grows a sharp corner without rounding it, so a spread cannot
        // turn a square window's shadow into a lozenge.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let wide = Shadow {
            blur: 1.0,
            color: [0.0, 1.0, 0.0, 1.0],
            dx: 0.0,
            dy: 0.0,
            spread: 8.0,
        };
        // Diagonally off the window's corner, far enough out that a shadow
        // rounded by the spread has cut it away while a square one still
        // reaches it — the corner is only eight pixels deep, so a sample
        // nearer than this is lit either way.
        let at = (INSET.0 as i32 - 8, INSET.1 as i32 - 8);

        let output = rounded_and_shadowed(&mut renderer, &red, 0.0, wide);

        assert!(
            pixel(&output, at.0, at.1)[1] > 0,
            "a square window's shadow keeps its corners"
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_shadow_spread_away_to_nothing_is_not_drawn() {
        // A negative spread shrinks the shape the shadow is cast from, and one
        // bigger than the window leaves no shape at all. Measuring distance
        // from what is left would light a blurred disc where CSS draws
        // nothing.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let gone = Shadow {
            blur: 6.0,
            color: [0.0, 1.0, 0.0, 1.0],
            // Far enough to one side that anything drawn is not hidden under
            // the window it came from.
            dx: 24.0,
            dy: 0.0,
            spread: -20.0,
        };

        let output = shadowed(&mut renderer, &red, Some(gone));

        let lit = output.chunks_exact(4).filter(|px| px[1] > 0).count();
        assert_eq!(lit, 0, "{lit} pixels of a shadow that has nothing to cast");
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn a_translucent_window_lets_what_is_under_it_through() {
        // Blue underneath, red at half alpha over it: the result is neither.
        let mut renderer = renderer();
        let blue = solid(&mut renderer, BLUE);
        let red = solid(&mut renderer, RED);
        let whole = Transform::scale(f64::from(OUTPUT.0), f64::from(OUTPUT.1));

        let output = composed(
            &mut renderer,
            &[
                Layer {
                    alpha: 1.0,
                    clip: &[],
                    corner_radius: 0.0,
                    shadow: None,
                    surface_to_output: whole,
                    texture: &blue,
                    y_inverted: false,
                },
                Layer {
                    alpha: 0.5,
                    clip: &[],
                    corner_radius: 0.0,
                    shadow: None,
                    surface_to_output: whole,
                    texture: &red,
                    y_inverted: false,
                },
            ],
        );

        let [r, _, b, _] = pixel(&output, OUTPUT.0 / 2, OUTPUT.1 / 2);
        assert!(
            r > 96 && r < 160 && b > 96 && b < 160,
            "half of each was expected, got r={r} b={b}",
        );
    }

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn the_last_portal_in_draw_order_is_the_one_on_top() {
        // The same overlap `hit_test` resolves, resolved in pixels: whatever
        // the scene draws last is what is visible. For a window that takes
        // the pointer — which both of these do — that is the same fact as a
        // click reaching the window a user can see. An inert window breaks
        // the pair deliberately: still drawn last, no longer clicked.
        let mut renderer = renderer();
        let red = solid(&mut renderer, RED);
        let blue = solid(&mut renderer, BLUE);

        let mut scene = Scene::new();
        scene.upsert(Portal::new("red", (64.0, 48.0), Transform::identity(), 5));
        scene.upsert(Portal::new("blue", (64.0, 48.0), Transform::identity(), 0));

        let textures = |app_id: &str| if app_id == "red" { &red } else { &blue };
        let layers: Vec<_> = scene
            .draw_order()
            .into_iter()
            .map(|portal| Layer {
                alpha: 1.0,
                clip: &[],
                corner_radius: 0.0,
                shadow: None,
                surface_to_output: portal.surface_to_output(),
                texture: textures(&portal.app_id),
                y_inverted: false,
            })
            .collect();

        let output = composed(&mut renderer, &layers);

        // Red has the higher z-index, so it draws last and covers blue.
        assert_eq!(pixel(&output, 32, 24), RED, "the higher z-index wins");
    }
}
