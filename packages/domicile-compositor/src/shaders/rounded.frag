#version 100

//_DEFINES_

#if defined(EXTERNAL)
#extension GL_OES_EGL_image_external : require
#endif

precision mediump float;
#if defined(EXTERNAL)
uniform samplerExternalOES tex;
#else
uniform sampler2D tex;
#endif

uniform float alpha;
varying vec2 v_coords;

#if defined(DEBUG_FLAGS)
uniform float tint;
#endif

// The quad's size on the output, in pixels, and the corner radius in the same
// units. Both are needed here rather than baked into the geometry: rounding is
// a property of the *edge*, so it has to be measured where the edge is, and
// that is only known per pixel.
uniform vec2 quad_size;
uniform float corner_radius;

// Signed distance from `p` to a rounded rectangle centred at the origin.
// Negative inside, positive outside, and — this is the point — in pixels, so
// the transition can be one pixel wide wherever the edge falls.
float rounded_box(vec2 p, vec2 half_size, float radius) {
    vec2 q = abs(p) - half_size + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

void main() {
    vec4 color = texture2D(tex, v_coords);

#if defined(NO_ALPHA)
    color = vec4(color.rgb, 1.0) * alpha;
#else
    color = color * alpha;
#endif

    // `v_coords` runs 0..1 across the quad, which is what makes it usable as a
    // position as well as a texture coordinate. A y-inverted buffer samples it
    // the other way up, and that costs nothing here only because a rounded
    // rectangle with one radius is symmetric — per-corner radii would need to
    // know which way up the buffer is.
    vec2 p = (v_coords - 0.5) * quad_size;
    float distance = rounded_box(p, quad_size * 0.5, corner_radius);
    // Across one pixel, so an edge is smooth rather than a staircase. The
    // colour is premultiplied, so coverage multiplies the whole thing.
    color *= 1.0 - smoothstep(-0.5, 0.5, distance);

#if defined(DEBUG_FLAGS)
    if (tint == 1.0)
        color = vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8;
#endif

    gl_FragColor = color;
}
