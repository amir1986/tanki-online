"""Split the CC0 OpenGameArt Abrams (Sketlux) into hull / turret / gun GLBs. The turret and gun are un-yawed so the
gun points along +X (Blender) = +Z (glTF), and the turret parts are moved so the turret ring sits at the origin.
blender -b --disable-autoexec scratch/dl/oga/abrams-tank.blend --python tools/blender/split_tank.py -- <outdir>
"""
import sys, math, bpy, mathutils
outdir = sys.argv[sys.argv.index('--') + 1]
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT', 'LAMP'):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Cube.003']
def wbox(objs):
    pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
    mn = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx
parts = {'hull': [], 'turret': [], 'gun': []}
for o in meshes:
    mn, mx = wbox([o])
    c = (mn + mx) / 2
    if o.name == 'Circle.020':
        parts['gun'].append(o)
    elif c.z > 0.45:
        parts['turret'].append(o)
    else:
        parts['hull'].append(o)
# gun direction: the gun object's local Z axis (its long axis) in world space
gun = parts['gun'][0]
d = (gun.matrix_world.to_3x3() @ mathutils.Vector((0, 0, 1))).normalized()
if d.x < 0:
    d = -d
yaw = math.atan2(d.y, d.x)
body = bpy.data.objects['Cube.001']
bmn, bmx = wbox([body])
pivot = mathutils.Vector(((bmn.x + bmx.x) / 2, (bmn.y + bmx.y) / 2, 0.0))
rot = mathutils.Matrix.Rotation(math.pi / 2 - yaw, 4, 'Z')  # gun -> +Y (the hull's long axis)
flip = mathutils.Matrix.Rotation(0.0, 4, 'Z')  # the aligned gun already points -Y, which the glTF export maps to +Z
hmn, hmx = wbox(parts['hull'])
hc = mathutils.Vector(((hmn.x + hmx.x) / 2, (hmn.y + hmx.y) / 2, 0.0))
orig = {o.name: o.matrix_world.copy() for o in meshes}
# every object gets exactly one assignment computed from its original matrix (matrix_world reads are stale until update)
for o in parts['turret'] + parts['gun']:
    o.matrix_world = flip @ rot @ mathutils.Matrix.Translation(-pivot) @ orig[o.name]
for o in parts['hull']:
    o.matrix_world = flip @ mathutils.Matrix.Translation(-hc) @ orig[o.name]
bpy.context.view_layer.update()
# level the gun: it is modelled slightly elevated. Rotate it about its breech so the axis is horizontal.
d2 = (gun.matrix_world.to_3x3() @ mathutils.Vector((0, 0, 1))).normalized()
gmn, gmx = wbox([gun])
gc = (gmn + gmx) / 2
if d2.dot(mathutils.Vector((gc.x, gc.y, 0.0))) < 0:
    d2 = -d2  # point toward the muzzle (away from the turret ring at the origin)
pitch = math.atan2(d2.z, math.hypot(d2.x, d2.y))
length = (gmx - gmn).length
breech = gc - d2 * (length / 2)
axis = d2.cross(mathutils.Vector((0, 0, 1))).normalized()
level = mathutils.Matrix.Translation(breech) @ mathutils.Matrix.Rotation(-pitch, 4, axis) @ mathutils.Matrix.Translation(-breech)
gun.matrix_world = level @ gun.matrix_world
bpy.context.view_layer.update()
d3 = (gun.matrix_world.to_3x3() @ mathutils.Vector((0, 0, 1))).normalized()
print('PART gun axis', [round(v, 3) for v in d2], 'pitch(deg)', round(math.degrees(pitch), 1), '-> levelled', [round(v, 3) for v in d3])
print('PART yaw(deg)', round(math.degrees(yaw), 1), 'pivot', [round(v, 3) for v in pivot], 'hullcentre', [round(v, 3) for v in hc])
for name, objs in parts.items():
    mn, mx = wbox(objs)
    print('PART', name, len(objs), 'bbox', [round(v, 2) for v in mn], [round(v, 2) for v in mx])
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    out = f"{outdir}/tank_{name}.glb"
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_materials='EXPORT')
    print('EXPORTED', out)
