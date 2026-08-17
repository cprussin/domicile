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
}

/// Draw `layers` bottom-to-top into the frame.
///
/// The caller owns the frame because it owns what happens around the draw —
/// clearing, damage, and finishing — and those differ between an output being
/// presented and a buffer being tested.
pub fn draw_layers(frame: &mut GlesFrame<'_, '_>, layers: &[Layer<'_>]) -> Result<(), GlesError> {
    for layer in layers {
        // The texture matrix is identity: the whole texture fills the quad, and
        // the surface's own size is already in `surface_to_output`.
        frame.render_texture(
            layer.texture,
            Matrix3::from_scale(1.0),
            matrix3(layer.surface_to_output),
            None::<Option<_>>,
            layer.alpha,
            None,
            &[],
        )?;
    }
    Ok(())
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

    use super::matrix3;

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
        Bind, Color32F, ExportMem, Frame, ImportMem, Offscreen, Renderer,
    };
    use smithay::utils::{Rectangle, Size, Transform as OutputTransform};

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
                },
                Layer {
                    alpha: 1.0,
                    surface_to_output: bottom_right.surface_to_output(),
                    texture: &blue,
                },
            ],
        );

        assert_eq!(pixel(&output, 8, 6), RED, "top-left quadrant");
        assert_eq!(pixel(&output, 48, 36), BLUE, "bottom-right quadrant");
        assert_eq!(pixel(&output, 48, 6), BLACK, "top-right stays cleared");
        assert_eq!(pixel(&output, 8, 36), BLACK, "bottom-left stays cleared");
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
            })
            .collect();

        let output = composed(&mut renderer, &layers);

        // Red has the higher z-index, so it draws last and covers blue.
        assert_eq!(pixel(&output, 32, 24), RED, "the higher z-index wins");
    }
}
