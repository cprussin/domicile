---
"domicile": patch
---

Screen recordings are encoded on the GPU (AV1 or VP9 through VA-API) when it can, so a recording near 4K keeps up instead of dropping to about 15 frames a second. Without a GPU encoder they are VP8 on the CPU, as before, with the color conversion now spread over every core.
