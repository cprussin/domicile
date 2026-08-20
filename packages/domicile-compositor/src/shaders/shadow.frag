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

// The area this quad covers: the window grown by the spread and the blur, and
// moved by the offset — so the shadow has room to fall outside the window.
uniform vec2 quad_size;
// The shadow's own rectangle before it is blurred, which is the window grown
// by the spread. Centred in the quad, because the offset is already in the
// quad's placement.
uniform vec2 shadow_size;
uniform float shadow_radius;
// The window itself, which the shadow is not painted under. Its centre sits
// away from the quad's by the offset, in the opposite direction.
uniform vec2 window_size;
uniform float window_radius;
uniform vec2 window_offset;
uniform float blur;
uniform vec4 shadow_color;

float rounded_box(vec2 p, vec2 half_size, float radius) {
    vec2 q = abs(p) - half_size + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

void main() {
    vec2 p = (v_coords - 0.5) * quad_size;

    // A smoothstep across the blur rather than a true Gaussian: one
    // instruction against a many-tap convolution or a second pass, and at the
    // sizes a window shadow is drawn nobody can tell the difference. The width
    // is the blur radius *centred on the edge*, which is what CSS defines it
    // as — spanning the full blur either side would make every shadow twice as
    // soft and twice as far-reaching as it was authored.
    float shadow_distance = rounded_box(p, shadow_size * 0.5, shadow_radius);
    float coverage = 1.0 - smoothstep(-blur * 0.5, blur * 0.5, shadow_distance);

    // An outer shadow is not painted under the window it falls from — CSS
    // clips it to outside the border box. Without this the shadow is drawn
    // solid under the whole window, which is invisible while the window is
    // opaque and bleeds through the moment it is not.
    float window_distance = rounded_box(p - window_offset, window_size * 0.5, window_radius);
    coverage *= smoothstep(-0.5, 0.5, window_distance);

    // Premultiplied, because that is what the blend expects.
    vec4 color = vec4(shadow_color.rgb * shadow_color.a, shadow_color.a)
        * coverage * alpha;

#if defined(DEBUG_FLAGS)
    if (tint == 1.0)
        color = vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8;
#endif

    gl_FragColor = color;
}
