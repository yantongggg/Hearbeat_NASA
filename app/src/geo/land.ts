import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-110m.json';

const MW = 720, MH = 360;
let mask: Uint8Array | null = null;

/** Rasterise Natural Earth land once into a 0.5° mask. Browser only (uses a canvas). */
export function initLand() {
  const c = document.createElement('canvas'); c.width = MW; c.height = MH;
  const x = c.getContext('2d')!;
  const land = feature(landTopo as any, (landTopo as any).objects.land);
  const eq = geoEquirectangular().scale(MW / (2 * Math.PI)).translate([MW / 2, MH / 2]);
  x.fillStyle = '#fff'; x.beginPath(); geoPath(eq, x)(land as any); x.fill();
  const d = x.getImageData(0, 0, MW, MH).data;
  mask = new Uint8Array(MW * MH);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
}

export function isLand(lat: number, lon: number): number {
  if (!mask) return 0;
  let x = Math.floor((lon + 180) * 2) % MW; if (x < 0) x += MW;
  const y = Math.max(0, Math.min(MH - 1, Math.floor((90 - lat) * 2)));
  return mask[y * MW + x];
}
