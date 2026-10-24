---
"domicile": minor
---

Wayland capture tools (`grim`, `wf-recorder`, OBS's wlroots capture) copy from a running cast of the monitor, frame after frame, into shm or dmabuf buffers, and get only frames with damage they have not seen.
