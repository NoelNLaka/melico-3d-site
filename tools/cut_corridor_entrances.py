"""Cut arched corridor entrances through the courtyard walls at the block junctions.

Two bays of the building are circulation corridors rather than rooms - they are
the only bays carrying no window / door / air-con outline markers:

  * Block A corridor - the last bay of the Block A courtyard wall
    (``Mesh_14`` / ``FF_Mesh_14``), between ``IntWall_A_2`` and ``IntWall_A_1``,
    i.e. between the Block A rooms and the corner room (Block A room 6).
  * Block C corridor - the end bay of the Block B courtyard wall
    (``Mesh_13`` / ``FF_Mesh_13``), between ``IntWall_B_side`` and
    ``IntWall_C_Bottom``, where Block C starts.

Both get an arch-headed opening onto the walkway on the first floor and the
same opening directly beneath it on the ground floor.  Each opening is inset
half a brick from the flanking cross walls and its crown sits ``HEAD_RISE``
above the head of the ordinary doors on the same floor.

Run inside Blender::

    blender MelicoMAP_v3.blend --python tools/cut_corridor_entrances.py

Re-running is safe: a bay that already has an opening is skipped.
"""

import math

import bmesh
import bpy
from mathutils import Vector

# --- design parameters -------------------------------------------------------
ARCH_RADIUS = 0.60    # corner radius of the arched head (m)
HEAD_RISE = 0.15      # crown height above the ordinary door head (m)
ARC_SEGMENTS = 16     # tessellation of each corner arc
SILL_DROP = 0.60      # how far the cutter runs below floor level (m)
PRISM_HEIGHT = 2.00   # height over which a wall is a plain prism (m)

# (label, ground-floor wall, first-floor wall, flanking cross walls)
CORRIDORS = (
    ("Block A / Block B", "Mesh_14", "FF_Mesh_14", ("IntWall_A_2", "IntWall_A_1")),
    ("Block C / Block B", "Mesh_13", "FF_Mesh_13", ("IntWall_B_side", "IntWall_C_Bottom")),
)

REPORT_TEXT = "corridor_entrances_report"

DOOR_LEAF_WIDTH = (0.80, 0.92)   # length range of a door's head/threshold bar
GROUND_FLOOR = (-1.0, 2.50)      # z band used to pick reference doors
FIRST_FLOOR = (2.50, 6.00)

_parts_cache = {}


def world_points(obj):
    matrix = obj.matrix_world
    return [matrix @ v.co for v in obj.data.vertices]


def world_normals(obj):
    """Face normals in world space - each wall is an axis-aligned box in its own."""
    basis = obj.matrix_world.to_3x3().inverted_safe().transposed()
    return [(basis @ poly.normal).normalized() for poly in obj.data.polygons]


def wall_frame(obj):
    """Minimum-area footprint box: centre, along-axis, across-axis, length, thickness.

    Only the lower part of the wall is used - the first-floor walls carry a
    moulded top that overhangs the wall face and would skew the box.
    """
    points = world_points(obj)
    z_min = min(p.z for p in points)
    points = [p for p in points if p.z <= z_min + PRISM_HEIGHT]
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    base = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0))
    flat = [Vector((p.x, p.y, 0)) - base for p in points]

    def extent(angle):
        d = Vector((math.cos(angle), math.sin(angle), 0))
        n = Vector((-math.sin(angle), math.cos(angle), 0))
        ss = [p.dot(d) for p in flat]
        ts = [p.dot(n) for p in flat]
        return (max(ss) - min(ss), max(ts) - min(ts),
                (max(ss) + min(ss)) / 2, (max(ts) + min(ts)) / 2)

    def area(angle):
        span_s, span_t, _, _ = extent(angle)
        return span_s * span_t

    step = math.pi / 720                                  # 0.25 deg sweep, then refine
    best_angle = min((i * step for i in range(720)), key=area)
    for _ in range(4):
        step /= 8
        best_angle = min((best_angle + (i - 8) * step for i in range(17)), key=area)
    span_s, span_t, mid_s, mid_t = extent(best_angle)
    d = Vector((math.cos(best_angle), math.sin(best_angle), 0))
    n = Vector((-math.sin(best_angle), math.cos(best_angle), 0))
    centre = base + d * mid_s + n * mid_t
    if span_s < span_t:                       # keep `d` along the long side
        d, n = n, -d
        span_s, span_t = span_t, span_s
    return centre, d, n, span_s, span_t


def loose_parts(obj, min_verts=1):
    """World-space vertex groups of each connected component of the evaluated mesh."""
    key = (obj.name, min_verts)
    if key in _parts_cache:
        return _parts_cache[key]
    # The outline markers are built by the `Melico Outlines` geometry-node tree:
    # the object's own mesh is empty, so the bars only exist on the evaluated one.
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    bm = bmesh.new()
    bm.from_mesh(evaluated.to_mesh())
    evaluated.to_mesh_clear()
    bm.verts.ensure_lookup_table()
    matrix = obj.matrix_world
    seen, parts = set(), []
    for vert in bm.verts:
        if vert.index in seen:
            continue
        stack, comp = [vert], []
        seen.add(vert.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for edge in cur.link_edges:
                other = edge.other_vert(cur)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        if len(comp) >= min_verts:
            parts.append([matrix @ v.co for v in comp])
    bm.free()
    _parts_cache[key] = parts
    return parts


def span_along(obj, centre, axis):
    values = [(Vector((p.x, p.y, 0)) - centre).dot(axis) for p in world_points(obj)]
    return min(values), max(values)


def door_levels(frame, s_mid, z_band):
    """Floor and door-head level of the nearest ordinary door on this wall.

    The outline markers in ``Melico_Openings_Block_*`` are thin bars; a door's
    threshold and head bars are the horizontal pair about 0.85 m long sitting
    on the wall's face at the same position along the wall.
    """
    centre, d, n, _, thickness = frame
    bars = []
    for obj in bpy.data.objects:
        if not obj.name.startswith("Melico_Openings_Block"):
            continue
        for part in loose_parts(obj, min_verts=200):
            zs = [p.z for p in part]
            if max(zs) - min(zs) > 0.10:                     # not a horizontal bar
                continue
            z = (min(zs) + max(zs)) / 2
            if not z_band[0] <= z <= z_band[1]:
                continue
            flat = [Vector((p.x, p.y, 0)) - centre for p in part]
            ss = [p.dot(d) for p in flat]
            ts = [p.dot(n) for p in flat]
            if abs(sum(ts) / len(ts)) > thickness / 2 + 0.10:  # bar on another wall
                continue
            if not DOOR_LEAF_WIDTH[0] <= max(ss) - min(ss) <= DOOR_LEAF_WIDTH[1]:
                continue                                      # window or air-con bar
            bars.append(((min(ss) + max(ss)) / 2, z))
    if not bars:
        raise RuntimeError("no reference door found on this wall")
    nearest = min(bars, key=lambda b: abs(b[0] - s_mid))[0]
    levels = sorted(z for s, z in bars if abs(s - nearest) < 0.30)
    if len(levels) < 2:
        raise RuntimeError("reference door is missing its threshold or head bar")
    return levels[0], levels[-1]


def solve3(rows, targets):
    """Least-squares fit of target = c0*a + c1*b + c2 over (a, b, target) rows."""
    m = [[0.0] * 4 for _ in range(3)]
    basis = [(a, b, 1.0) for a, b in rows]
    for vec, y in zip(basis, targets):
        for i in range(3):
            for j in range(3):
                m[i][j] += vec[i] * vec[j]
            m[i][3] += vec[i] * y
    for col in range(3):                      # Gaussian elimination with partial pivot
        pivot = max(range(col, 3), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-9:
            raise RuntimeError("degenerate UV fit")
        m[col], m[pivot] = m[pivot], m[col]
        scale = m[col][col]
        m[col] = [v / scale for v in m[col]]
        for row in range(3):
            if row == col:
                continue
            factor = m[row][col]
            m[row] = [v - factor * w for v, w in zip(m[row], m[col])]
    coeffs = [m[i][3] for i in range(3)]
    residual = max(abs(sum(c * v for c, v in zip(coeffs, vec)) - y)
                   for vec, y in zip(basis, targets))
    return coeffs, residual


def orient_across_axis(obj, centre, d, n, thickness):
    """Flip `n` so it points at the face where the cube projection has u = 0.

    On the wall's end caps the horizontal texture axis runs from that face
    across the thickness, so u = thickness / 2 - t there.
    """
    mesh = obj.data
    if not mesh.uv_layers.active:
        return n
    uvs = mesh.uv_layers.active.data
    samples = []
    for poly, normal in zip(mesh.polygons, world_normals(obj)):
        if abs(normal.x * d.x + normal.y * d.y) < 0.9:
            continue
        for li in poly.loop_indices:
            co = obj.matrix_world @ mesh.vertices[mesh.loops[li].vertex_index].co
            t = (Vector((co.x, co.y, 0)) - centre).dot(n)
            samples.append((t, uvs[li].uv[0]))
    spread = [s for s in samples if abs(s[0]) > thickness / 4]
    if len(spread) >= 2:
        lo = min(spread, key=lambda s: s[0])
        hi = max(spread, key=lambda s: s[0])
        if hi[1] > lo[1]:                      # u grows with t: the origin is at -t
            return -n
    return n


def uv_projection(obj, centre, d, n):
    """Recover the wall's cube projection from its two large faces.

    The walls sit on a slightly falling slab, so the texture origin drifts along
    the wall; u and v are therefore fitted as planes over (s, z) rather than as
    a function of one axis each.
    """
    mesh = obj.data
    if not mesh.uv_layers.active:
        return None
    uvs = mesh.uv_layers.active.data
    z_min = min((obj.matrix_world @ v.co).z for v in mesh.vertices)
    rows, us, vs = [], [], []
    for poly, normal in zip(mesh.polygons, world_normals(obj)):
        if abs(normal.x * n.x + normal.y * n.y) < 0.99:
            continue
        if (obj.matrix_world @ poly.center).z > z_min + PRISM_HEIGHT:
            continue
        for li in poly.loop_indices:
            co = obj.matrix_world @ mesh.vertices[mesh.loops[li].vertex_index].co
            rows.append(((Vector((co.x, co.y, 0)) - centre).dot(d), co.z))
            us.append(uvs[li].uv[0])
            vs.append(uvs[li].uv[1])
    if len(rows) < 6:
        raise RuntimeError(f"{obj.name}: no wall face found to read the UV mapping from")
    u_fit, u_res = solve3(rows, us)
    v_fit, v_res = solve3(rows, vs)
    if max(u_res, v_res) > 0.02:
        raise RuntimeError(f"{obj.name}: UV mapping is not a cube projection "
                           f"(residuals {u_res:.3f}, {v_res:.3f})")
    return u_fit, v_fit


def arch_profile(s0, s1, z_floor, z_crown):
    """(s, z) outline of the opening: straight jambs rising into an arched head."""
    radius = min(ARCH_RADIUS, (s1 - s0) / 2, z_crown - z_floor)
    z_spring = z_crown - radius
    points = [(s0, z_floor - SILL_DROP), (s0, z_spring)]
    for i in range(1, ARC_SEGMENTS + 1):
        a = math.pi * i / (2 * ARC_SEGMENTS)
        points.append((s0 + radius * (1 - math.cos(a)), z_spring + radius * math.sin(a)))
    for i in range(ARC_SEGMENTS - 1, -1, -1):
        a = math.pi * i / (2 * ARC_SEGMENTS)
        points.append((s1 - radius * (1 - math.cos(a)), z_spring + radius * math.sin(a)))
    points.append((s1, z_floor - SILL_DROP))
    return points


def build_cutter(name, centre, d, n, profile, thickness):
    depth = thickness / 2 + 0.40
    bm = bmesh.new()
    front = [bm.verts.new(centre + d * s + n * depth + Vector((0, 0, z))) for s, z in profile]
    back = [bm.verts.new(centre + d * s - n * depth + Vector((0, 0, z))) for s, z in profile]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(len(profile)):
        j = (i + 1) % len(profile)
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def triangulate_ngons(mesh):
    """Split every n-gon of *mesh* into triangles.

    The exact boolean leaves each pierced wall face as a single keyhole n-gon -
    one loop running round the outside of the wall and back into the opening
    through a slit.  ``Melico Roof Cut`` subdivides every wall it is bound to,
    and subdividing such a face fans it from a centre point, which fills the new
    opening straight back in.  Triangles subdivide without closing the hole.
    """
    bm = bmesh.new()
    bm.from_mesh(mesh)
    ngons = [f for f in bm.faces if len(f.verts) > 4]
    if ngons:
        bmesh.ops.triangulate(bm, faces=ngons)
    bm.to_mesh(mesh)
    bm.free()
    return len(ngons)


def reproject_uvs(obj, frame, projection, region):
    """Cube-project the faces inside the new opening, matching the wall's own mapping."""
    centre, d, n, _, thickness = frame
    if projection is None or not obj.data.uv_layers.active:
        return 0
    u_fit, v_fit = projection
    mesh = obj.data
    uvs = mesh.uv_layers.active.data
    s_lo, s_hi, z_lo, z_hi = region
    patched = 0
    for poly, normal in zip(mesh.polygons, world_normals(obj)):
        centroid = obj.matrix_world @ poly.center
        flat = Vector((centroid.x, centroid.y, 0)) - centre
        if not (s_lo <= flat.dot(d) <= s_hi and z_lo <= centroid.z <= z_hi
                and abs(flat.dot(n)) <= thickness / 2 + 1e-3):
            continue
        along = abs(normal.x * d.x + normal.y * d.y)
        across = abs(normal.x * n.x + normal.y * n.y)
        upright = abs(normal.z)
        for li in poly.loop_indices:
            p = obj.matrix_world @ mesh.vertices[mesh.loops[li].vertex_index].co
            pf = Vector((p.x, p.y, 0)) - centre
            s, t = pf.dot(d), pf.dot(n)
            u = u_fit[0] * s + u_fit[1] * p.z + u_fit[2]
            v = v_fit[0] * s + v_fit[1] * p.z + v_fit[2]
            if across >= along and across >= upright:      # parallel to the wall face
                uvs[li].uv = (u, v)
            elif along >= upright:                          # jamb reveal
                uvs[li].uv = (thickness / 2 - t, v)
            else:                                           # arch soffit
                uvs[li].uv = (u, 1.0 - (thickness / 2 - t))
        patched += 1
    return patched


def has_opening(obj, frame, s_mid, z_mid):
    """True if the wall is already open where the entrance goes.

    Fires a ray straight through the wall at the middle of the proposed
    opening: a solid wall is hit, a cut one is not.
    """
    centre, d, n, _, thickness = frame
    inverse = obj.matrix_world.inverted()
    start = centre + d * s_mid - n * (thickness / 2 + 0.20) + Vector((0, 0, z_mid))
    direction = obj.matrix_world.to_3x3().inverted_safe() @ n
    hit, _, _, _ = obj.ray_cast(inverse @ start, direction.normalized(),
                                distance=thickness + 0.40)
    return not hit


def bay_limits(frame, flanks):
    """Clear opening between the two flanking cross walls, inset half a brick."""
    centre, d, _, length, thickness = frame
    spans = sorted(span_along(bpy.data.objects[f], centre, d) for f in flanks)
    bay_lo = max(spans[0][1], -length / 2)
    bay_hi = min(spans[1][0], length / 2)
    return bay_lo, bay_hi, bay_lo + thickness / 2, bay_hi - thickness / 2


def cut_opening(wall_name, frame, flanks, z_band):
    wall = bpy.data.objects[wall_name]
    centre, d, n, _, thickness = frame
    bay_lo, bay_hi, s0, s1 = bay_limits(frame, flanks)

    z_floor, z_head = door_levels(frame, (s0 + s1) / 2, z_band)
    z_crown = z_head + HEAD_RISE

    if has_opening(wall, frame, (s0 + s1) / 2, (z_floor + z_crown) / 2):
        return f"    {wall_name}: opening already present - skipped"

    projection = uv_projection(wall, centre, d, n)

    bm = bmesh.new()                     # weld split vertices so the boolean has a solid
    bm.from_mesh(wall.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(wall.data)
    bm.free()

    cutter = build_cutter(f"__cut_{wall_name}", centre, d, n,
                          arch_profile(s0, s1, z_floor, z_crown), thickness)
    modifier = wall.modifiers.new("CorridorEntrance", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    # bake the boolean alone - the wall keeps any modifiers the file already had
    # compare by name: each attribute access hands back a fresh wrapper object
    muted = [m for m in wall.modifiers
             if m.name != modifier.name and m.show_viewport]
    for other in muted:
        other.show_viewport = False
    # the cutter has to reach the view layer before the modifier can evaluate it
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(wall.evaluated_get(depsgraph))
    for other in muted:
        other.show_viewport = True
    wall.modifiers.remove(modifier)
    mesh_name = wall.data.name
    wall.data = new_mesh
    new_mesh.name = mesh_name
    bpy.data.objects.remove(cutter, do_unlink=True)
    ngons = triangulate_ngons(new_mesh)

    # verify against the evaluated wall, so a modifier that closes the opening
    # again (see `triangulate_ngons`) is caught rather than shipped
    bpy.context.view_layer.update()
    if not has_opening(wall, frame, (s0 + s1) / 2, (z_floor + z_crown) / 2):
        raise RuntimeError(f"{wall_name}: the boolean left the wall solid")

    patched = reproject_uvs(wall, frame, projection,
                            (s0 - 0.01, s1 + 0.01, z_floor - SILL_DROP, z_crown + 0.01))
    return (f"    {wall_name}: {s1 - s0:.3f} m wide x {z_crown - z_floor:.3f} m high "
            f"(door head {z_head - z_floor:.2f} m + {HEAD_RISE:.2f} m rise), "
            f"bay {bay_hi - bay_lo:.3f} m, jambs {thickness / 2 * 1000:.0f} mm off the "
            f"cross walls, {len(new_mesh.polygons)} tris ({ngons} n-gons split), "
            f"{patched} faces projected")


def main():
    lines = ["Corridor entrances"]
    for label, ground_wall, first_wall, flanks in CORRIDORS:
        missing = [name for name in (ground_wall, first_wall) + tuple(flanks)
                   if name not in bpy.data.objects]
        if missing:
            lines.append(f"  {label} corridor: missing {', '.join(missing)} - skipped")
            continue
        gf = bpy.data.objects[ground_wall]
        centre, d, n, length, thickness = wall_frame(gf)
        n = orient_across_axis(gf, centre, d, n, thickness)
        frame = (centre, d, n, length, thickness)
        lines.append(f"  {label} corridor:")
        lines.append(cut_opening(first_wall, frame, flanks, FIRST_FLOOR))
        lines.append(cut_opening(ground_wall, frame, flanks, GROUND_FLOOR))
    report = "\n".join(lines)
    print(report)
    # Blender's system console is hidden by default, so leave the report where
    # the Text Editor can show it as well.
    block = bpy.data.texts.get(REPORT_TEXT) or bpy.data.texts.new(REPORT_TEXT)
    block.from_string(report)


if __name__ == "__main__":
    main()
