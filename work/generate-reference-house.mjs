/**
 * Generates public/models/reference-house.glb
 *
 * The Solar House reference model: a single-storey contemporary Australian
 * house with a skillion roof and deep eaves.
 *
 * ── Canonical Solar House GLB convention ──────────────────────────────────
 *  Units   metres
 *  Up      +Y
 *  Forward +X   (in the EMITTED file — this is what Cesium maps to north at
 *               heading 0 when loading with upAxis=Y / forwardAxis=Z)
 *  Origin  footprint centre at ground level (y = 0 is the underside of the
 *          slab, so the model sits ON the terrain rather than through it)
 *
 *  The front of the house — the facade carrying the entry door and the main
 *  glazing — therefore faces north at heading 0, which is the solar-correct
 *  orientation for the southern hemisphere.
 *
 *  For readability the geometry below is authored the way an elevation is
 *  drawn (front at -Z, width along X) and rotated into the emitted frame in
 *  one documented step before encoding.
 *
 * Run with:  node work/generate-reference-house.mjs
 */
import fs from "node:fs";

// ── Dimensions (metres) ────────────────────────────────────────────────────
const WIDTH = 14.0; // X, outer face to outer face
const DEPTH = 9.0; // Z, outer face to outer face
const WALL = 0.25; // wall thickness
const SLAB_H = 0.25; // slab thickness
const WALL_TOP = 2.95; // top of wall above ground
const EAVE = 0.6; // roof overhang on all sides
const ROOF_T = 0.22; // roof slab thickness
const ROOF_FRONT = 3.15; // underside of roof at the front (low side)
const ROOF_REAR = 4.35; // underside of roof at the rear (high side)

const HALF_W = WIDTH / 2;
const HALF_D = DEPTH / 2;

// ── Materials ──────────────────────────────────────────────────────────────
// Deliberately light-valued: a near-black building merges with its own cast
// shadow, which defeats the whole point of the app.
const MAT = {
  render: 0,
  roof: 1,
  slab: 2,
  timber: 3,
  glass: 4,
  frame: 5,
  soffit: 6,
};

const materials = [
  {
    name: "Wall render",
    pbrMetallicRoughness: { baseColorFactor: [0.84, 0.82, 0.78, 1], roughnessFactor: 0.9, metallicFactor: 0 },
  },
  {
    name: "Roof sheet",
    pbrMetallicRoughness: { baseColorFactor: [0.26, 0.27, 0.29, 1], roughnessFactor: 0.6, metallicFactor: 0.1 },
  },
  {
    name: "Concrete slab",
    pbrMetallicRoughness: { baseColorFactor: [0.63, 0.61, 0.58, 1], roughnessFactor: 0.95, metallicFactor: 0 },
  },
  {
    name: "Timber door",
    pbrMetallicRoughness: { baseColorFactor: [0.42, 0.26, 0.13, 1], roughnessFactor: 0.65, metallicFactor: 0 },
  },
  {
    name: "Glazing",
    pbrMetallicRoughness: { baseColorFactor: [0.42, 0.58, 0.66, 0.42], roughnessFactor: 0.1, metallicFactor: 0.2 },
    alphaMode: "BLEND",
    doubleSided: true,
  },
  {
    name: "Window frame",
    pbrMetallicRoughness: { baseColorFactor: [0.2, 0.21, 0.22, 1], roughnessFactor: 0.5, metallicFactor: 0.1 },
  },
  {
    name: "Eave soffit",
    pbrMetallicRoughness: { baseColorFactor: [0.9, 0.89, 0.86, 1], roughnessFactor: 0.88, metallicFactor: 0 },
  },
];

// ── Geometry helpers ───────────────────────────────────────────────────────
const parts = [];

/** Axis-aligned box. center [x,y,z], size [w,h,d] — h is along +Y (up). */
function box(name, [cx, cy, cz], [w, h, d], material) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  hull(name, [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ], material);
}

/**
 * Six-faced solid from 8 corners: 0-3 bottom ring, 4-7 top ring, matching
 * order. Winding is derived from the solid's centroid so every face ends up
 * with an outward normal — which keeps sloped forms like the roof correct
 * without hand-ordering each face.
 */
function hull(name, c, material) {
  const centre = [0, 1, 2].map((a) => c.reduce((sum, v) => sum + v[a], 0) / c.length);
  const faces = [
    [0, 1, 2, 3], [4, 5, 6, 7],
    [0, 1, 5, 4], [1, 2, 6, 5],
    [2, 3, 7, 6], [3, 0, 4, 7],
  ];

  const p = [], n = [], idx = [];
  for (const face of faces) {
    let quad = face.map((i) => c[i]);
    const e1 = sub(quad[1], quad[0]);
    const e2 = sub(quad[2], quad[0]);
    let normal = norm(cross(e1, e2));
    const faceCentre = [0, 1, 2].map((a) => quad.reduce((s, v) => s + v[a], 0) / 4);
    if (dot(normal, sub(faceCentre, centre)) < 0) {
      quad = [quad[0], quad[3], quad[2], quad[1]];
      normal = normal.map((v) => -v);
    }
    const start = p.length / 3;
    for (const v of quad) { p.push(...v); n.push(...normal); }
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  parts.push({ name, p, n, i: idx, material });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

/** Glazed opening on a wall face. axis "z" = front/rear wall, "x" = side wall. */
function window_(name, axis, outer, along, sill, height, width) {
  const headFrame = 0.06;
  if (axis === "z") {
    const sign = Math.sign(outer);
    box(`${name} glass`, [along, sill + height / 2, outer + sign * 0.02], [width, height, 0.04], MAT.glass);
    box(`${name} head`, [along, sill + height + headFrame / 2, outer + sign * 0.03], [width + 0.16, headFrame, 0.07], MAT.frame);
    box(`${name} sill`, [along, sill - headFrame / 2, outer + sign * 0.03], [width + 0.16, headFrame, 0.07], MAT.frame);
    box(`${name} jamb L`, [along - width / 2 - 0.04, sill + height / 2, outer + sign * 0.03], [0.08, height, 0.07], MAT.frame);
    box(`${name} jamb R`, [along + width / 2 + 0.04, sill + height / 2, outer + sign * 0.03], [0.08, height, 0.07], MAT.frame);
  } else {
    const sign = Math.sign(outer);
    box(`${name} glass`, [outer + sign * 0.02, sill + height / 2, along], [0.04, height, width], MAT.glass);
    box(`${name} head`, [outer + sign * 0.03, sill + height + headFrame / 2, along], [0.07, headFrame, width + 0.16], MAT.frame);
    box(`${name} sill`, [outer + sign * 0.03, sill - headFrame / 2, along], [0.07, headFrame, width + 0.16], MAT.frame);
    box(`${name} jamb F`, [outer + sign * 0.03, sill + height / 2, along - width / 2 - 0.04], [0.07, height, 0.08], MAT.frame);
    box(`${name} jamb B`, [outer + sign * 0.03, sill + height / 2, along + width / 2 + 0.04], [0.07, height, 0.08], MAT.frame);
  }
}

// ── Build ──────────────────────────────────────────────────────────────────

// Slab, slightly proud of the walls so it reads as a floor plate.
box("Slab", [0, SLAB_H / 2, 0], [WIDTH + 0.3, SLAB_H, DEPTH + 0.3], MAT.slab);

const wallH = WALL_TOP - SLAB_H;
const wallY = SLAB_H + wallH / 2;

// Front (-Z, faces north at heading 0) and rear (+Z).
box("Front wall", [0, wallY, -HALF_D + WALL / 2], [WIDTH - WALL * 2, wallH, WALL], MAT.render);
box("Rear wall", [0, wallY, HALF_D - WALL / 2], [WIDTH - WALL * 2, wallH, WALL], MAT.render);
// Sides.
box("West wall", [-HALF_W + WALL / 2, wallY, 0], [WALL, wallH, DEPTH], MAT.render);
box("East wall", [HALF_W - WALL / 2, wallY, 0], [WALL, wallH, DEPTH], MAT.render);

// Gable infill under the skillion — the rake that makes the roof pitch read
// from the sides rather than looking like a flat lid.
for (const sx of [-1, 1]) {
  const x = sx * (HALF_W - WALL / 2);
  hull(`${sx < 0 ? "West" : "East"} rake`, [
    [x - WALL / 2, WALL_TOP, -HALF_D], [x + WALL / 2, WALL_TOP, -HALF_D],
    [x + WALL / 2, WALL_TOP, HALF_D], [x - WALL / 2, WALL_TOP, HALF_D],
    [x - WALL / 2, ROOF_FRONT, -HALF_D], [x + WALL / 2, ROOF_FRONT, -HALF_D],
    [x + WALL / 2, ROOF_REAR, HALF_D], [x - WALL / 2, ROOF_REAR, HALF_D],
  ], MAT.render);
}

// Skillion roof: low at the front, high at the rear, overhanging on all sides.
const rw = HALF_W + EAVE;
const rd = HALF_D + EAVE;
// Extend the slope out to the eave edges so the overhang follows the pitch.
const slope = (ROOF_REAR - ROOF_FRONT) / DEPTH;
const yFrontEave = ROOF_FRONT - slope * EAVE;
const yRearEave = ROOF_REAR + slope * EAVE;

hull("Roof", [
  [-rw, yFrontEave, -rd], [rw, yFrontEave, -rd], [rw, yRearEave, rd], [-rw, yRearEave, rd],
  [-rw, yFrontEave + ROOF_T, -rd], [rw, yFrontEave + ROOF_T, -rd],
  [rw, yRearEave + ROOF_T, rd], [-rw, yRearEave + ROOF_T, rd],
], MAT.roof);

// Soffit board just under the eave, so the overhang reads as depth in shadow.
hull("Soffit", [
  [-rw, yFrontEave - 0.04, -rd], [rw, yFrontEave - 0.04, -rd],
  [rw, yRearEave - 0.04, rd], [-rw, yRearEave - 0.04, rd],
  [-rw, yFrontEave, -rd], [rw, yFrontEave, -rd], [rw, yRearEave, rd], [-rw, yRearEave, rd],
], MAT.soffit);

// ── Openings ───────────────────────────────────────────────────────────────
const FRONT = -HALF_D;
const REAR = HALF_D;

// Entry: timber door, step and a canopy that breaks the facade.
box("Front door", [-5.0, SLAB_H + 1.05, FRONT - 0.01], [1.05, 2.1, 0.08], MAT.timber);
box("Door frame L", [-5.6, SLAB_H + 1.1, FRONT - 0.02], [0.1, 2.25, 0.1], MAT.frame);
box("Door frame R", [-4.4, SLAB_H + 1.1, FRONT - 0.02], [0.1, 2.25, 0.1], MAT.frame);
box("Door head", [-5.0, SLAB_H + 2.2, FRONT - 0.02], [1.3, 0.1, 0.1], MAT.frame);
box("Entry step", [-5.0, 0.06, FRONT - 0.5], [1.8, 0.12, 1.0], MAT.slab);
box("Entry canopy", [-5.0, 2.62, FRONT - 0.55], [2.4, 0.12, 1.2], MAT.roof);

// Main north glazing — the big openings that make the front obvious.
window_("Front window A", "z", FRONT, -2.1, 0.85, 1.75, 2.9);
window_("Front window B", "z", FRONT, 1.4, 0.85, 1.75, 2.9);
window_("Front window C", "z", FRONT, 4.9, 0.85, 1.75, 2.9);

// Side and rear openings, smaller — reinforces which way the house faces.
window_("West window", "x", -HALF_W, 1.4, 1.0, 1.35, 2.0);
window_("East window", "x", HALF_W, -0.8, 1.0, 1.35, 2.2);
window_("Rear window A", "z", REAR, -3.2, 1.25, 1.1, 1.7);
window_("Rear window B", "z", REAR, 2.8, 1.25, 1.1, 1.7);

// ── Orient to the Solar House convention ───────────────────────────────────
// The geometry above is authored the way elevations are drawn: front at -Z,
// width along X. Cesium, loading with upAxis=Y / forwardAxis=Z, maps glTF +X
// to NORTH at heading 0 (it rotates +Z to its own +X "forward", which lands on
// east, and +X follows to north). So the emitted file puts the front at +X.
//
// Rotation about Y by -90 deg:  (x, y, z) -> (-z, y, x)
for (const part of parts) {
  for (const buffer of [part.p, part.n]) {
    for (let i = 0; i < buffer.length; i += 3) {
      const x = buffer[i], z = buffer[i + 2];
      buffer[i] = -z;
      buffer[i + 2] = x;
    }
  }
}

// ── Encode GLB ─────────────────────────────────────────────────────────────
const chunks = [], views = [], accessors = [], primitives = [];
let offset = 0;

function bounds(values) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], values[i + a]);
      max[a] = Math.max(max[a], values[i + a]);
    }
  return { min, max };
}

function add(values, componentType, type, target) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  const bytes = componentType === 5126
    ? Buffer.from(new Float32Array(values).buffer)
    : Buffer.from(new Uint16Array(values).buffer);
  const view = views.length;
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  chunks.push(bytes);
  offset += bytes.length;
  const accessor = accessors.length;
  accessors.push({
    bufferView: view,
    componentType,
    count: values.length / (type === "VEC3" ? 3 : 1),
    type,
    ...(type === "VEC3" ? bounds(values) : {}),
  });
  return accessor;
}

for (const part of parts) {
  primitives.push({
    attributes: { POSITION: add(part.p, 5126, "VEC3", 34962), NORMAL: add(part.n, 5126, "VEC3", 34962) },
    indices: add(part.i, 5123, "SCALAR", 34963),
    material: part.material,
  });
}

const json = {
  asset: { version: "2.0", generator: "Solar House · reference house generator" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "Contemporary Australian reference house", mesh: 0 }],
  meshes: [{ name: "Reference house", primitives }],
  materials,
  buffers: [{ byteLength: offset }],
  bufferViews: views,
  accessors,
};

const raw = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binary.length, 8);
jh.writeUInt32LE(jsonChunk.length); jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(binary.length); bh.writeUInt32LE(0x004e4942, 4);

const out = "public/models/reference-house.glb";
fs.writeFileSync(out, Buffer.concat([header, jh, jsonChunk, bh, binary]));
console.log(`${out}  ${parts.length} parts  ${(binary.length / 1024).toFixed(1)} KiB geometry`);
console.log(`footprint ${WIDTH} x ${DEPTH} m, ridge ${(ROOF_REAR + ROOF_T).toFixed(2)} m, front faces +X (north at heading 0)`);
