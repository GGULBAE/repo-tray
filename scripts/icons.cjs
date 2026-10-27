'use strict';
// Reproducible vector-like icons rasterized with Node builtins, no external assets.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const buffer = Buffer.alloc(data.length + 12);
  buffer.writeUInt32BE(data.length); name.copy(buffer, 4); data.copy(buffer, 8);
  buffer.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return buffer;
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); const sampling = size <= 64 ? 4 : 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const total = [0, 0, 0, 0];
    for (let sy = 0; sy < sampling; sy++) for (let sx = 0; sx < sampling; sx++) {
      const value = pixel((x + (sx + .5) / sampling) / size, (y + (sy + .5) / sampling) / size);
      for (let channel = 0; channel < 4; channel++) total[channel] += value[channel];
    }
    const offset = y * (size * 4 + 1) + x * 4 + 1;
    for (let channel = 0; channel < 4; channel++) raw[offset + channel] = Math.round(total[channel] / sampling ** 2);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function segment(x,y,ax,ay,bx,by,width) {
  const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
  return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay))<=width;
}
function circle(x,y,cx,cy,r){return Math.hypot(x-cx,y-cy)<=r;}
function glyph(x,y){
  return segment(x,y,.32,.24,.32,.77,.045) || segment(x,y,.32,.59,.68,.39,.045) || segment(x,y,.68,.39,.68,.24,.045)
    || [[.32,.23],[.32,.77],[.68,.23]].some(([cx,cy])=>circle(x,y,cx,cy,.115)&&!circle(x,y,cx,cy,.055));
}
function trayPixel(color){return (x,y)=>glyph(x,y)?[...color,255]:[0,0,0,0];}
function appPixel(x,y){
  const dx=Math.max(Math.abs(x-.5)-.29,0),dy=Math.max(Math.abs(y-.5)-.29,0);
  if(Math.hypot(dx,dy)>.18)return[0,0,0,0];
  if(glyph((x-.12)/.76,(y-.1)/.8))return[247,250,255,255];
  if(circle(x,y,.77,.75,.065))return[80,220,174,255];
  return[20,38,61,255];
}
for (const [name,color] of [['trayTemplate',[30,40,54]],['tray-light',[235,241,247]],['tray-red',[220,53,69]],['tray-amber',[202,134,25]]]) {
  fs.writeFileSync(path.join(out,`${name}.png`),png(20,trayPixel(color)));
  fs.writeFileSync(path.join(out,`${name}@2x.png`),png(40,trayPixel(color)));
}
const images=new Map([16,32,64,128,256,512,1024].map(size=>[size,png(size,appPixel)]));
fs.writeFileSync(path.join(out,'app.png'),images.get(512));
const icnsTypes={16:'icp4',32:'icp5',64:'icp6',128:'ic07',256:'ic08',512:'ic09',1024:'ic10'};
const entries=[...images].map(([size,data])=>{const head=Buffer.alloc(8);head.write(icnsTypes[size]);head.writeUInt32BE(data.length+8,4);return Buffer.concat([head,data]);});
const body=Buffer.concat(entries),header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(body.length+8,4);
fs.writeFileSync(path.join(out,'app.icns'),Buffer.concat([header,body]));
const sizes=[16,32,64,128,256],icoHeader=Buffer.alloc(6+16*sizes.length);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(sizes.length,4);
let offset=icoHeader.length;
sizes.forEach((size,i)=>{const base=6+i*16,data=images.get(size);icoHeader[base]=icoHeader[base+1]=size%256;icoHeader.writeUInt16LE(1,base+4);icoHeader.writeUInt16LE(32,base+6);icoHeader.writeUInt32LE(data.length,base+8);icoHeader.writeUInt32LE(offset,base+12);offset+=data.length;});
fs.writeFileSync(path.join(out,'app.ico'),Buffer.concat([icoHeader,...sizes.map(size=>images.get(size))]));
console.log('Generated application and tray icons.');
