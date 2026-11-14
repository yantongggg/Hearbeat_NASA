/**
 * The globe: NASA Blue Marble (day) and Black Marble (night lights), lit by the sun at the hour of the
 * playback step, with the data layer lifted off the NASA EIC frame (see pipeline/pictures.py) laid on
 * top and cross-faded between steps. In daylight the data keeps NASA's colours exactly; on the night
 * side it is dimmed, and clouds go dark as real clouds do. The Climate track (annual means) is lit evenly.
 */
import * as THREE from 'three';
import { D2R, R2D } from '../core/util';
import { state, view } from '../core/state';
import { SUN } from '../geo/sky';

let renderer: THREE.WebGLRenderer;
const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 400);
let earth: THREE.Mesh;
let mat: THREE.ShaderMaterial, atmo: THREE.ShaderMaterial;
const loader = new THREE.TextureLoader();
const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);

export const vecLL = (lat: number, lon: number, r = 1) => {
  const p = lat * D2R, l = lon * D2R;
  return new THREE.Vector3(r * Math.cos(p) * Math.cos(l), r * Math.sin(p), -r * Math.cos(p) * Math.sin(l));
};
const llOf = (v: THREE.Vector3) => ({ lat: Math.asin(Math.max(-1, Math.min(1, v.y / v.length()))) * R2D, lon: Math.atan2(-v.z, v.x) * R2D });

const VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const FRAG = `uniform sampler2D tDay,tNight,tA,tB; uniform vec3 uSun,uCam; uniform float uMix,uData,uEven,uNight;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(uCam-vW);
  float d=mix(mix(dot(N,uSun),.25+.6*dot(N,V),uEven),-.6,uNight);
  float day=smoothstep(-0.10,0.22,d), lit=max(d,0.);
  vec3 dc=texture2D(tDay,vUv).rgb;
  vec3 col=dc*(0.06+1.12*lit);
  float water=smoothstep(.02,.16,dc.b-dc.r)*(1.-step(.35,dc.g));
  vec3 H=normalize(uSun+V); col+=vec3(1.,.93,.82)*pow(max(dot(N,H),0.),70.)*water*.5*day*(1.-uEven);
  vec3 nl=texture2D(tNight,vUv).rgb; float nb=smoothstep(.07,.75,dot(nl,vec3(.33)));
  vec2 o=vec2(.0009,.0006); float halo=(dot(texture2D(tNight,vUv+o).rgb,vec3(.33))+dot(texture2D(tNight,vUv-o).rgb,vec3(.33)))*.5;
  // night: city lights plus a faint moonlit Earth, so land and sea stay readable
  // (night-lights track: the year's lights come from the data layer, so the base map's own lights are left out)
  vec3 night=(vec3(1.,.72,.40)*nb*1.8+vec3(1.,.55,.25)*smoothstep(.05,.6,halo)*.45)*(1.-uNight)+dc*vec3(.11,.14,.22)+vec3(.010,.018,.038);
  col=mix(night,col,day);
  col+=vec3(1.,.42,.16)*exp(-pow(d/.11,2.))*.08*(1.-uEven);
  vec4 p=mix(texture2D(tA,vUv),texture2D(tB,vUv),uMix);      // premultiplied on upload: clean edges
  vec3 ov=p.rgb/max(p.a,1e-4);
  float mx=max(ov.r,max(ov.g,ov.b)), mn=min(ov.r,min(ov.g,ov.b));
  float cloud=(1.-smoothstep(.05,.18,mx-mn))*smoothstep(.75,.92,mn);
  float shade=mix(mix(mix(.78,1.,day),.12+.98*lit,cloud),1.,uNight);
  col=mix(col,ov*shade,p.a*uData);
  float fr=pow(1.-max(dot(N,V),0.),2.6);
  col+=vec3(.30,.60,1.)*fr*(.26+.7*smoothstep(-.25,.45,d))*mix(1.,.5,uEven);
  gl_FragColor=vec4(col,1.);
}`;
const ATMO_VERT = `varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const ATMO_FRAG = `uniform vec3 uSun,uCam; uniform float uEven; varying vec3 vN; varying vec3 vW;
void main(){ vec3 N=normalize(vN); vec3 V=normalize(uCam-vW); float rim=dot(N,V);
  float i=pow(clamp(1.0+rim,0.,1.),4.2);
  float s=mix(smoothstep(-.35,.55,dot(N,uSun)),.5,uEven);
  vec3 c=mix(vec3(.10,.30,.75),vec3(.45,.75,1.),s);
  gl_FragColor=vec4(c*i*(.7+1.3*s),1.); }`;

export let texturesReady = false;

export function initEarth(canvas: HTMLCanvasElement, texBase: string, onReady: () => void) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setClearColor(0x010307, 1);
  let pending = 2;
  const done = () => { if (--pending === 0) { texturesReady = true; onReady(); } };
  const tex = (f: string) => { const t = loader.load(texBase + f, done, undefined, done); t.anisotropy = 8; return t; };
  mat = new THREE.ShaderMaterial({
    uniforms: {
      tDay: { value: tex('day.jpg') }, tNight: { value: tex('night.jpg') }, tA: { value: BLANK }, tB: { value: BLANK },
      uSun: { value: new THREE.Vector3(1, 0, 0) }, uCam: { value: new THREE.Vector3() },
      uMix: { value: 0 }, uData: { value: 0 }, uEven: { value: 0 }, uNight: { value: 0 }
    },
    vertexShader: VERT, fragmentShader: FRAG
  });
  earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 144), mat);
  scene.add(earth);
  atmo = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uCam: { value: new THREE.Vector3() }, uEven: { value: 0 } },
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 64), atmo));
  addStars();
}

function addStars() {
  const n = 2400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let s = 9; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 120 + rnd() * 60, q = Math.sqrt(1 - u * u);
    pos.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3);
    const b = .22 + Math.pow(rnd(), 3) * .85; col.set([b, b * (.95 + rnd() * .05), b * (.9 + rnd() * .15)], i * 3);
  }
  const gm = new THREE.BufferGeometry();
  gm.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gm.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(gm, new THREE.PointsMaterial({ size: 1.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: .85 })));
}

export function resizeEarth() {
  renderer.setPixelRatio(view.DPR); renderer.setSize(view.W, view.H, false);
  camera.aspect = view.W / view.H; camera.updateProjectionMatrix();
}

// ---- frame textures ----
let shownA = '', shownB = '';
const cache = new Map<string, THREE.Texture>();
const waiting = new Map<string, Promise<THREE.Texture>>();
export function loadFrame(url: string): Promise<THREE.Texture> {
  const hit = cache.get(url); if (hit) return Promise.resolve(hit);
  const w = waiting.get(url); if (w) return w;
  const p = new Promise<THREE.Texture>((res, rej) => {
    loader.load(url, t => { t.anisotropy = 8; t.premultiplyAlpha = true; t.minFilter = THREE.LinearMipmapLinearFilter; cache.set(url, t); waiting.delete(url); res(t); }, undefined, e => { waiting.delete(url); rej(e); });
  });
  waiting.set(url, p);
  return p;
}
export const frameReady = (url: string) => cache.has(url);
/** Free the pictures of another track (each 2048×1024 frame is about 11 MB on the graphics card), so a phone that
 *  plays through Rain and then Air does not run out of memory. The two frames on screen are always kept. */
export function releaseFrames(keep: Set<string>) {
  let freed = 0;
  for (const [url, t] of cache) if (!keep.has(url) && url !== shownA && url !== shownB) { t.dispose(); cache.delete(url); freed++; }
  return freed;
}
export const framesHeld = () => cache.size;

/** Show frame `a` blending toward `b` by `mix` (both must be loaded, else the last shown stays). */
export function showFrames(a: string, b: string, mix: number) {
  const ta = cache.get(a), tb = cache.get(b) ?? ta;
  if (ta) { if (shownA !== a) { mat.uniforms.tA.value = ta; shownA = a; } }
  if (tb) { if (shownB !== b) { mat.uniforms.tB.value = tb; shownB = b; } }
  mat.uniforms.uMix.value = ta && tb ? mix : 0;
}
let dataTarget = 0;
export const setDataVisible = (on: boolean) => { dataTarget = on ? 1 : 0; };
let evenTarget = 0;
/** Even lighting (no day/night) for layers that are not a moment in time, e.g. annual means. */
export const setEvenLight = (on: boolean) => { evenTarget = on ? 1 : 0; };
let nightTarget = 0;
/** Night everywhere (the night-lights track): the year's lights from the data layer on a moonlit Earth. */
export const setNightLight = (on: boolean) => { nightTarget = on ? 1 : 0; };

export function placeCamera() {
  const narrow = view.W < 760;
  const lat = Math.max(-80, Math.min(80, state.center.lat));
  camera.position.copy(vecLL(lat, state.center.lon, state.dist * (narrow ? 1.12 : 1)));
  const p = lat * D2R, l = state.center.lon * D2R;
  camera.up.set(-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l));
  camera.lookAt(0, 0, 0);
  // the astronaut's porthole is not in the middle of a desktop window: shift the picture so the globe's centre is there
  const vc = state.viewCenter, key = vc ? `${vc.x.toFixed(4)},${vc.y.toFixed(4)},${view.W},${view.H}` : '';
  if (key !== offsetKey) {
    offsetKey = key;
    if (vc) camera.setViewOffset(view.W, view.H, view.W * (.5 - vc.x), view.H * (.5 - vc.y), view.W, view.H); else camera.clearViewOffset();
  }
  camera.updateMatrixWorld();
}
let offsetKey = '';

const tmpV = new THREE.Vector3();
/** Screen position of a point on (or above) the globe, and whether it faces the camera. */
export function toScreen(lat: number, lon: number, alt = 1.002): [number, number, boolean] {
  const v = vecLL(lat, lon, alt);
  const facing = v.clone().normalize().dot(tmpV.copy(camera.position).sub(v)) > 0;
  v.project(camera);
  return [(v.x + 1) / 2 * view.W, (1 - v.y) / 2 * view.H, facing && v.z < 1];
}
const ray = new THREE.Raycaster();
export function pick(x: number, y: number) {
  ray.setFromCamera({ x: x / view.W * 2 - 1, y: -(y / view.H * 2 - 1) } as THREE.Vector2, camera);
  const hit = ray.intersectObject(earth)[0];
  return hit ? llOf(hit.point) : null;
}

let lastR = performance.now();
export function renderEarth() {
  placeCamera();
  const u = mat.uniforms, now = performance.now(), dt = Math.min(.25, (now - lastR) / 1000); lastR = now;
  u.uData.value += (dataTarget - u.uData.value) * Math.min(1, dt * 5);
  if (Math.abs(dataTarget - u.uData.value) < .002) u.uData.value = dataTarget;
  u.uEven.value += (evenTarget - u.uEven.value) * Math.min(1, dt * 4);
  if (Math.abs(evenTarget - u.uEven.value) < .002) u.uEven.value = evenTarget;
  atmo.uniforms.uEven.value = u.uEven.value;
  u.uNight.value += (nightTarget - u.uNight.value) * Math.min(1, dt * 4);
  if (Math.abs(nightTarget - u.uNight.value) < .002) u.uNight.value = nightTarget;
  const sun = vecLL(SUN.lat, SUN.lon).normalize();
  u.uSun.value.copy(sun); atmo.uniforms.uSun.value.copy(sun);
  u.uCam.value.copy(camera.position); atmo.uniforms.uCam.value.copy(camera.position);
  renderer.render(scene, camera);
}

/** Read-only view of the shader state for tests (data visibility, cross-fade). */
export const globeDebug = () => ({ data: mat.uniforms.uData.value as number, mix: mat.uniforms.uMix.value as number, even: mat.uniforms.uEven.value as number, night: mat.uniforms.uNight.value as number, sunLon: SUN.lon, shownA, shownB });
