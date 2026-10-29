# The scene `blender_scene` opens: Suzanne turning between two shiny balls.
# Run with `blender --background --python scene.py -- <out.blend>`. Also saves
# preferences without the splash screen, which would cover the viewport.
import math
import sys

import bpy

bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()


def material(name, color, metallic=0.0, roughness=0.4):
    made = bpy.data.materials.new(name)
    made.use_nodes = True
    bsdf = made.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return made


bpy.ops.mesh.primitive_monkey_add(size=2, location=(0, 0, 1.2))
monkey = bpy.context.object
monkey.name = "Suzanne"
bpy.ops.object.shade_smooth()
monkey.modifiers.new("Subdivision", "SUBSURF").levels = 2
monkey.data.materials.append(material("Orange", (0.9, 0.35, 0.05)))

for x, color in ((-3.2, (0.1, 0.4, 0.9)), (3.2, (0.2, 0.75, 0.35))):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.8, location=(x, 1, 0.8))
    bpy.ops.object.shade_smooth()
    bpy.context.object.data.materials.append(
        material("Ball", color, metallic=0.6, roughness=0.2)
    )

bpy.ops.mesh.primitive_plane_add(size=30)
bpy.context.object.data.materials.append(material("Floor", (0.8, 0.8, 0.82)))
bpy.ops.object.light_add(
    type="SUN", location=(4, -4, 8), rotation=(math.radians(40), 0, math.radians(30))
)
bpy.context.object.data.energy = 4
bpy.ops.object.camera_add(location=(0, -12, 3.6), rotation=(math.radians(78), 0, 0))

scene = bpy.context.scene
scene.camera = bpy.context.object
scene.frame_start = 1
scene.frame_end = 240
monkey.rotation_euler = (0, 0, 0)
monkey.keyframe_insert("rotation_euler", frame=1)
monkey.rotation_euler = (0, 0, math.radians(360))
monkey.keyframe_insert("rotation_euler", frame=241)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])

bpy.context.preferences.view.show_splash = False
bpy.ops.wm.save_userpref()
