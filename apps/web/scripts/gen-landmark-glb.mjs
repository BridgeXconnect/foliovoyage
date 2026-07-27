/**
 * Generates an ORIGINAL, untextured glTF-2.0 binary (.glb) of a stylised Khmer-style
 * prang (the tapering spire of Wat Arun) for the ST-MAP-POC 3D map (BRI-167).
 *
 * Pure-JS, zero deps: builds a square-section tapered spire as a lathe of rings,
 * computes vertex normals, and packs POSITION / NORMAL / indices into a single GLB.
 * The geometry is procedurally generated here (not copied from any asset), so there
 * is no third-party model licensing concern. Model is ~1 unit tall, centred on origin
 * at its base — the map's Three.js custom layer scales/places it in metres.
 *
 * Run: `node apps/web/scripts/gen-landmark-glb.mjs`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/models/landmark-prang.glb");

// Vertical profile of the spire: half-width (r) at each height (y). A prang tapers
// in tiers to a point. Duplicated y with a step in r creates the tiered "shelves".
const profile = [
  { y: 0.0, r: 0.5 },
  { y: 0.18, r: 0.5 },
  { y: 0.18, r: 0.42 },
  { y: 0.46, r: 0.34 },
  { y: 0.46, r: 0.28 },
  { y: 0.72, r: 0.18 },
  { y: 0.72, r: 0.14 },
  { y: 0.9, r: 0.06 },
  { y: 1.0, r: 0.0 }, // apex point
];

const positions = [];
const indices = [];

// Square cross-section: 4 corners per ring.
const corners = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

// Emit a ring of 4 vertices for each profile sample.
for (const p of profile) {
  for (const [cx, cz] of corners) {
    positions.push(cx * p.r, p.y, cz * p.r);
  }
}

// Connect consecutive rings with quads (two triangles), winding CCW when viewed
// from outside so front faces point outward.
for (let ring = 0; ring < profile.length - 1; ring++) {
  const a = ring * 4;
  const b = (ring + 1) * 4;
  for (let i = 0; i < 4; i++) {
    const i2 = (i + 1) % 4;
    const v00 = a + i;
    const v01 = a + i2;
    const v10 = b + i;
    const v11 = b + i2;
    indices.push(v00, v10, v11);
    indices.push(v00, v11, v01);
  }
}

// Base cap (fan) so the bottom isn't hollow.
const baseCenterIndex = positions.length / 3;
positions.push(0, 0, 0);
for (let i = 0; i < 4; i++) {
  const i2 = (i + 1) % 4;
  indices.push(baseCenterIndex, i2, i);
}

// --- vertex normals (accumulate face normals, then normalise) ---
const vcount = positions.length / 3;
const normals = new Float32Array(vcount * 3);
for (let t = 0; t < indices.length; t += 3) {
  const [ia, ib, ic] = [indices[t], indices[t + 1], indices[t + 2]];
  const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
  const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
  const e1 = [bx - ax, by - ay, bz - az];
  const e2 = [cx - ax, cy - ay, cz - az];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  for (const idx of [ia, ib, ic]) {
    normals[idx * 3] += nx;
    normals[idx * 3 + 1] += ny;
    normals[idx * 3 + 2] += nz;
  }
}
for (let i = 0; i < vcount; i++) {
  const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
  const len = Math.hypot(x, y, z) || 1;
  normals[i * 3] = x / len;
  normals[i * 3 + 1] = y / len;
  normals[i * 3 + 2] = z / len;
}

const posArr = new Float32Array(positions);
const idxArr = new Uint16Array(indices);

// glTF requires accessor min/max for POSITION.
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < vcount; i++) {
  for (let k = 0; k < 3; k++) {
    const v = posArr[i * 3 + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
}

// --- pack binary buffer: [positions][normals][indices], 4-byte aligned ---
const pad4 = (n) => (n + 3) & ~3;
const posBytes = posArr.byteLength;
const normBytes = normals.byteLength;
const idxBytes = idxArr.byteLength;
const posOffset = 0;
const normOffset = pad4(posOffset + posBytes);
const idxOffset = pad4(normOffset + normBytes);
const binLength = pad4(idxOffset + idxBytes);

const bin = new Uint8Array(binLength);
bin.set(new Uint8Array(posArr.buffer), posOffset);
bin.set(new Uint8Array(normals.buffer), normOffset);
bin.set(new Uint8Array(idxArr.buffer), idxOffset);

const gltf = {
  asset: { version: "2.0", generator: "folio-voyage gen-landmark-glb" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "prang" }],
  meshes: [
    {
      name: "prang",
      primitives: [
        { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
      ],
    },
  ],
  materials: [
    {
      name: "stone",
      pbrMetallicRoughness: {
        baseColorFactor: [0.86, 0.82, 0.72, 1.0],
        metallicFactor: 0.0,
        roughnessFactor: 0.85,
      },
    },
  ],
  buffers: [{ byteLength: binLength }],
  bufferViews: [
    { buffer: 0, byteOffset: posOffset, byteLength: posBytes, target: 34962 },
    { buffer: 0, byteOffset: normOffset, byteLength: normBytes, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vcount, type: "VEC3", min, max },
    { bufferView: 1, componentType: 5126, count: vcount, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: idxArr.length, type: "SCALAR" },
  ],
};

// --- assemble GLB container ---
const enc = new TextEncoder();
let jsonBytes = enc.encode(JSON.stringify(gltf));
const jsonPad = pad4(jsonBytes.length) - jsonBytes.length;
if (jsonPad > 0) {
  const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
  padded.set(jsonBytes, 0);
  jsonBytes = padded;
}

const totalLength = 12 + 8 + jsonBytes.length + 8 + bin.length;
const glb = new Uint8Array(totalLength);
const dv = new DataView(glb.buffer);
let o = 0;
dv.setUint32(o, 0x46546c67, true); o += 4; // magic "glTF"
dv.setUint32(o, 2, true); o += 4; // version
dv.setUint32(o, totalLength, true); o += 4; // total length
// JSON chunk
dv.setUint32(o, jsonBytes.length, true); o += 4;
dv.setUint32(o, 0x4e4f534a, true); o += 4; // "JSON"
glb.set(jsonBytes, o); o += jsonBytes.length;
// BIN chunk
dv.setUint32(o, bin.length, true); o += 4;
dv.setUint32(o, 0x004e4942, true); o += 4; // "BIN\0"
glb.set(bin, o); o += bin.length;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(`wrote ${OUT} (${glb.length} bytes, ${vcount} verts, ${idxArr.length / 3} tris)`);
