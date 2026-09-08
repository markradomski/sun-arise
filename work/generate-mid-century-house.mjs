import fs from "node:fs";

const mats = [
  { name: "Warm stucco", pbrMetallicRoughness: { baseColorFactor: [.72,.49,.32,1], roughnessFactor: .88 } },
  { name: "Walnut", pbrMetallicRoughness: { baseColorFactor: [.16,.07,.025,1], roughnessFactor: .52 } },
  { name: "Concrete", pbrMetallicRoughness: { baseColorFactor: [.34,.32,.29,1], roughnessFactor: .92 } },
  { name: "Roof", pbrMetallicRoughness: { baseColorFactor: [.10,.11,.10,1], roughnessFactor: .72 } },
  { name: "Transparent glazing", pbrMetallicRoughness: { baseColorFactor: [.38,.72,.84,.22], roughnessFactor: .08 }, alphaMode: "BLEND", doubleSided: true },
];
const parts = [];
function box(name, [x,y,z], [w,d,h], material) {
  const X=[x-w/2,x+w/2], Y=[y-d/2,y+d/2], Z=[z-h/2,z+h/2];
  const faces=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]], [[-1,0,0],[[0,1,0],[0,0,0],[0,0,1],[0,1,1]]], [[0,1,0],[[0,1,0],[1,1,0],[1,1,1],[0,1,1]]], [[0,-1,0],[[1,0,0],[0,0,0],[0,0,1],[1,0,1]]], [[0,0,1],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]], [[0,0,-1],[[0,1,0],[1,1,0],[1,0,0],[0,0,0]]]];
  const p=[], n=[], i=[];
  for (const [normal, corners] of faces) { const start=p.length/3; for (const [a,b,c] of corners) { p.push(X[a],Y[b],Z[c]); n.push(...normal); } i.push(start,start+1,start+2,start,start+2,start+3); }
  parts.push({name,p,n,i,material});
}
// Low, flat-roofed plan derived from sample-house.glb's 12 m × 18 m footprint.
box("Concrete slab",[0,0,.15],[12,18,.3],2); box("Rear stucco wall",[0,8.65,3.1],[12,.35,6.2],0);
box("West stucco wall",[-5.82,1.8,3.1],[.35,13.7,6.2],0); box("East stucco wing",[5.82,5.5,3.1],[.35,6.3,6.2],0);
box("Flat roof",[0,0,6.45],[13.1,19.1,.5],3); box("Walnut entry volume",[-3.6,-3.5,3],[2.1,2.7,5.7],1);
box("Interior feature wall",[1.9,3.5,2.8],[.3,5.5,5.2],0);
for (const x of [-3.65,0,3.65]) box("Transparent front glazing",[x,-8.63,3.15],[3.35,.06,5.75],4);
for (const y of [-4.5,-.5,3.5]) box("Transparent side glazing",[5.63,y,3.15],[.06,3.55,5.75],4);
for (const x of [-5.45,-1.83,1.83,5.45]) box("Front mullion",[x,-8.72,3.15],[.16,.22,5.95],1);
for (const y of [-8.72,-5.75,-1.8,2.15,5.95,8.65]) box("Side mullion",[5.72,y,3.15],[.22,.16,5.95],1);
box("Front sill",[0,-8.72,.45],[11.8,.24,.18],1);
const chunks=[], views=[], accessors=[], primitives=[]; let offset=0;
function vectorBounds(values) { const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]; for(let i=0;i<values.length;i+=3)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],values[i+axis]);max[axis]=Math.max(max[axis],values[i+axis]);} return {min,max}; }
function add(values, type, kind, target) { const pad=(4-offset%4)%4; if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;} const bytes=type===5126?Buffer.from(new Float32Array(values).buffer):Buffer.from(new Uint16Array(values).buffer); const v=views.length; views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});chunks.push(bytes);offset+=bytes.length;const a=accessors.length;accessors.push({bufferView:v,componentType:type,count:values.length/(kind==="VEC3"?3:1),type:kind,...(kind==="VEC3"?vectorBounds(values):{})});return a; }
for(const q of parts){const position=add(q.p,5126,"VEC3",34962),normal=add(q.n,5126,"VEC3",34962),indices=add(q.i,5123,"SCALAR",34963);primitives.push({attributes:{POSITION:position,NORMAL:normal},indices,material:q.material});}
const json={asset:{version:"2.0",generator:"Solar House MVP · Mid-century house generator"},scene:0,scenes:[{nodes:[0]}],nodes:[{name:"Mid-century modern glass house",mesh:0}],meshes:[{name:"Mid-century modern house",primitives}],materials:mats,buffers:[{byteLength:offset}],bufferViews:views,accessors};
const raw=Buffer.from(JSON.stringify(json)), jsonChunk=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,0x20)]), binary=Buffer.concat(chunks), header=Buffer.alloc(12), jh=Buffer.alloc(8), bh=Buffer.alloc(8); header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonChunk.length+8+binary.length,8);jh.writeUInt32LE(jsonChunk.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync("public/models/mid-century-house.glb",Buffer.concat([header,jh,jsonChunk,bh,binary]));
