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
use smithay::backend::renderer::gles::{GlesError, GlesFrame, GlesTexture};

/// One surface to draw, and where.
pub struct Layer<'a> {
    pub texture: &'a GlesTexture,
    /// Maps the unit square onto the output, from `Portal::surface_to_output`.
    pub surface_to_output: Transform,
    pub alpha: f32,
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
pub fn draw_layers(frame: &mut GlesFrame<'_, '_>, layers: &[Layer<'_>]) -> Result<(), GlesError> {
    for layer in layers {
        frame.render_texture(
            layer.texture,
            texture_matrix(layer.y_inverted),
            matrix3(layer.surface_to_output),
            None::<Option<_>>,
            layer.alpha,
            None,
            &[],
        )?;
    }
    Ok(())
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
pub fn logical_to_window(logical: (i32, i32), window: (i32, i32)) -> Transform {
    // A zero-sized output is a window being closed or not yet mapped. Dividing
    // by it would put every layer at infinity, which the renderer cannot draw
    // and which reads as a blank frame rather than as the missing output it is.
    Transform::scale(
        f64::from(window.0) / f64::from(logical.0.max(1)),
        f64::from(window.1) / f64::from(logical.1.max(1)),
    )
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

    use super::{logical_to_window, matrix3};

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

    use super::{draw_layers, Layer};

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
            draw_layers(&mut frame, layers).expect("drawing the layers");
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
        let at = ((y * OUTPUT.0 + x) * 4) as usize;
        [output[at], output[at + 1], output[at + 2], output[at + 3]]
    }

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];
    const BLACK: [u8; 4] = [0, 0, 0, 255];

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
                    surface_to_output: top_left.surface_to_output(),
                    texture: &red,
                    y_inverted: false,
                },
                Layer {
                    alpha: 1.0,
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

    #[test]
    #[ignore = "needs a working EGL/GLES stack; run via scripts/e2e-compose.sh"]
    fn the_last_portal_in_draw_order_is_the_one_on_top() {
        // The same overlap `hit_test` resolves, resolved in pixels: whatever
        // the scene draws last is what is visible, so a click reaching the
        // window a user can see is the same fact as this one.
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
