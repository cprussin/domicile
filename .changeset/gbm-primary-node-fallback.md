---
"domicile": patch
---

On a device whose render node allocates no GBM buffers, such as vgem under WSL2, the compositor allocates on the device's primary node, so shared-memory windows and casts are no longer blank there.
