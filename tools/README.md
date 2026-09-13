# Model tooling

Scripts that edit the Blender source the shipped model is exported from. The
source (`MelicoMAP_v3.blend`) lives outside this repo; only the exported
`public/models/melico_site.glb` is tracked here.

## `cut_corridor_entrances.py`

Cuts the arched entrances through the courtyard walls of the two circulation
corridors — the Block A / Block B junction bay and the Block C / Block B
junction bay — on the ground floor and the first floor.

Each opening is sized from the model itself rather than from hard-coded
coordinates: the clear bay between the flanking cross walls less half a brick
(half the wall thickness) on each side, rising to `HEAD_RISE` above the head of
the ordinary doors on the same floor, with an arched head of radius
`ARCH_RADIUS`. Re-running it is a no-op on a bay that is already open.

```bash
blender MelicoMAP_v3.blend --python tools/cut_corridor_entrances.py
```

It reports what it did to stdout and to a `corridor_entrances_report` text
block, since Blender's system console is hidden by default. It needs
`Mesh_13`, `Mesh_14`, `FF_Mesh_13`, `FF_Mesh_14`, their flanking cross walls
and the `Melico_Openings_Block_*` markers under those names; if the source file
has since renamed them, the report says which ones it could not find.

Two things about the .blend make this less straightforward than it looks, and
are why the script is shaped the way it is:

- The `Melico_Openings_Block_*` outline markers are built by the `Melico
  Opening Outlines` node group and have **empty base meshes**. The reference
  doors can only be measured off the evaluated object, so `loose_parts()` reads
  `evaluated_get(depsgraph).to_mesh()` rather than `obj.data`.
- Every `FF_*` wall carries the `Melico Roof Cut` node group, whose first node
  subdivides the mesh. Blender's EXACT boolean leaves each pierced wall face as
  a single *keyhole n-gon*, and subdividing one fans it from a centre point —
  refilling the opening. `triangulate_ngons()` splits them after the cut, and
  the result is verified against **evaluated** geometry, which is what catches
  this.

## Rebuilding the shipped GLB

Run the cut in Blender, save, then export the GLB from the same session:

```python
bpy.ops.export_scene.gltf(
    filepath='public/models/melico_site.glb',
    export_format='GLB',
    use_visible=True,        # see the note on the export set below
    export_apply=True,       # bake the geometry-node modifiers
    export_cameras=False,    # the scene has 5; the GLB carries none
    export_lights=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14,
)
```

**The export set needs care.** Neither visibility setting is right on its own:

- `use_visible=True` alone **drops ~53 objects** that are hidden in Blender but
  belong in the GLB — the room labels (`Rm_*_Lbl_*`) and setting-out gridlines
  (`Grid_*`) are layer toggles in the viewer, so they must ship.
- `use_visible=False` alone **re-adds `GroundSurface`**, which `8f6b2dd`
  deliberately removed to stop a dark courtyard overlay on mobile, along with
  helper objects (`__box__`, `Roof_Partition_Cutter`, `GOOGLE_SAT_WM`).

Export the union of *what the previous GLB contained* and *what is currently
visible*: unhide that set, hide everything else, export with `use_visible=True`,
then restore. Diff the node list against the previous GLB afterwards to confirm
nothing was dropped or silently re-added.

Then bump `MODEL_VERSION` in `src/main.js`. Vercel serves `/models/*` as
`immutable` for a year and the filename never changes, so without a new version
string returning visitors keep the model they already have cached.
