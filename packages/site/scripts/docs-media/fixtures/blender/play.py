# Run as Blender opens `scene.py`'s scene: shows it through the camera, with
# materials, and plays the animation.
import bpy

for window in bpy.context.window_manager.windows:
    for area in window.screen.areas:
        if area.type == "VIEW_3D":
            space = area.spaces.active
            space.shading.type = "MATERIAL"
            space.region_3d.view_perspective = "CAMERA"
bpy.ops.screen.animation_play()
