"""Convert a .blend file to a .glb and print a summary of its objects.
Run (scripts never auto-execute from the opened file):
  blender -b --disable-autoexec <file.blend> --python tools/blender/blend_to_glb.py -- <out.glb> [--report-only]
"""
import sys
import bpy
import json

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = argv[0] if argv else None
report_only = '--report-only' in argv

objs = []
for o in bpy.data.objects:
    entry = {'name': o.name, 'type': o.type, 'parent': o.parent.name if o.parent else None, 'hide': o.hide_render or o.hide_viewport}
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        entry['tris'] = len(o.data.loop_triangles)
        entry['dims'] = [round(v, 3) for v in o.dimensions]
        entry['loc'] = [round(v, 3) for v in o.location]
        entry['materials'] = [m.name for m in o.data.materials if m]
    objs.append(entry)
images = [{'name': i.name, 'size': list(i.size), 'packed': bool(i.packed_file), 'path': i.filepath} for i in bpy.data.images]
print('BLENDREPORT ' + json.dumps({'file': bpy.data.filepath, 'objects': objs, 'images': images}))

if out and not report_only:
    # remove non-mesh clutter (cameras, lights) so the export only carries geometry
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT', 'LAMP'):
            bpy.data.objects.remove(o, do_unlink=True)
    try:
        bpy.ops.file.pack_all()
    except Exception as e:  # noqa
        print('pack_all failed', e)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                              export_image_format='AUTO', export_materials='EXPORT', use_visible=False)
    print('EXPORTED', out)
