/**
 * 本地分支 modern-pace 第四十七轮:行星系统那一层的显卡画法(WebGL2)。算法和 persp.ts 的 CPU 版一样,搬进着色器:
 *   球   每个像素一条射线和球求交 → 法线 → 光照、贴图(三线性,经度接缝用"两套坐标取导数小的"那一套避开)、发光层、大气边光和外圈光晕
 *   环   射线和环面求交、被行星挡住的不画、行星影子、迎光 / 透光;环的径向疏密是一张 4096×1 带 mipmap 的贴图,远看显卡自动取平均
 *   恒星 圆盘 + 辉光(先画,星体盖在它上面)
 * 每样都画一个盖住它的矩形(屏幕上的包围盒),片元着色器里算;颜色预乘透明度。
 * 贴图按 Tex 的像素数组认(换了高清的 = 新数组 = 新贴图),最多留 TEX_MAX 张,旧的删掉。
 * 显卡不支持 WebGL2、着色器编不过 → createPerspGL 返回 null(调用的人退回 persp.ts 的 CPU 画法)。
 */
import { galaxyFrame, type RingProfile, type Tex } from './planetTexGen';
import type { Atmo, Cam, V3 } from './persp';

const VS = `#version 300 es
in vec2 aP;
uniform vec4 uRect;
uniform vec2 uView;
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aP);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
uniform vec3 uEye, uF, uR, uU;
uniform float uFoc, uCx, uCy, uDpr, uHd;
out vec4 outC;
vec2 cssXY() { return vec2(gl_FragCoord.x / uDpr, (uHd - gl_FragCoord.y) / uDpr); }
vec3 rayDir() {
  vec2 p = cssXY();
  float a = (p.x - uCx) / uFoc, b = (uCy - p.y) / uFoc;
  return normalize(uF + a * uR + b * uU);
}
`;

const FS_SPHERE = `${COMMON}
uniform vec3 uC; uniform float uRad, uHalo;
uniform vec3 uSun; uniform float uAmb;
uniform vec3 uM0, uM1, uM2;
uniform sampler2D uTex; uniform sampler2D uGlow; uniform float uHasGlow;
uniform vec3 uAtmoCol; uniform float uAtmo;
const float PI = 3.14159265;
void main() {
  vec3 dir = rayDir();
  vec3 oc = uEye - uC;
  float b = dot(oc, dir);
  float perp2 = dot(oc, oc) - b * b;
  float R2 = uRad * uRad;
  float Rh = uRad * uHalo;
  if (b > 0.0 || perp2 > Rh * Rh) discard;
  float pix = -b / uFoc;
  if (perp2 > R2) {
    if (uAtmo <= 0.0) discard;
    float hh = (sqrt(perp2) - uRad) / (Rh - uRad);
    vec3 nn = normalize(uEye - b * dir - uC);
    float lit = clamp(dot(nn, uSun) + 0.25, 0.0, 1.0);
    float a = (1.0 - hh) * (1.0 - hh) * uAtmo * lit;
    outC = vec4(uAtmoCol * a, a);
    return;
  }
  float t = -b - sqrt(R2 - perp2);
  vec3 n = (uEye + t * dir - uC) / uRad;
  float lit = dot(n, uSun);
  float lk = clamp((lit + 0.04) / 0.5, 0.0, 1.0);
  float k = uAmb + (1.0 - uAmb) * min(1.0, lk * 1.15);
  vec3 B = vec3(dot(uM0, n), dot(uM1, n), dot(uM2, n));
  vec2 uv = vec2(atan(B.y, B.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(B.z, -1.0, 1.0)) / PI);
  // 经度接缝:另一套坐标(错开半圈)取导数,两套里导数小的那套给贴图选层级,接缝上不会糊成一条线
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
  vec3 col = textureGrad(uTex, uv, dx, dy).rgb * k;
  if (uHasGlow > 0.5) {
    float gv = textureGrad(uGlow, uv, dx, dy).r * (1.0 - 0.6 * k);
    col += vec3(1.0, 0.47, 0.18) * gv;
  }
  if (uAtmo > 0.0) {
    float mu = max(0.0, -dot(n, dir));
    float a = pow(1.0 - mu, 3.0) * uAtmo * clamp(lit + 0.3, 0.0, 1.0);
    col = mix(col, uAtmoCol, a);
  }
  float alpha = clamp((uRad - sqrt(perp2)) / max(1e-9, pix), 0.0, 1.0);
  outC = vec4(min(col, vec3(1.0)) * alpha, alpha);
}`;

const FS_RING = `${COMMON}
uniform vec3 uC; uniform float uRp, uInner, uOuter;
uniform vec3 uAx, uE1, uE2, uSun;
uniform sampler2D uProf;
void main() {
  vec3 dir = rayDir();
  float den = dot(dir, uAx);
  if (abs(den) < 1e-6) discard;
  float t = dot(uC - uEye, uAx) / den;
  if (t <= 0.0) discard;
  vec3 h = uEye + t * dir - uC;
  float px = dot(h, uE1) / uRp, py = dot(h, uE2) / uRp;
  float rr = length(vec2(px, py));
  if (rr < uInner || rr >= uOuter) discard;
  vec3 oc = uEye - uC;
  float b = dot(oc, dir);
  float perp2 = dot(oc, oc) - b * b;
  float R2 = uRp * uRp;
  if (perp2 < R2 && b < 0.0) {
    float ts = -b - sqrt(R2 - perp2);
    if (ts > 0.0 && ts < t) discard;
  }
  vec4 pr = texture(uProf, vec2((rr - uInner) / (uOuter - uInner), 0.5));
  float op = pr.a;
  if (op < 0.004) discard;
  float az = abs(den);
  float alpha = 1.0 - pow(1.0 - min(0.99, op), min(6.0, 1.0 / max(az, 0.02)));
  float sx = dot(uSun, uE1), sy = dot(uSun, uE2), sz = dot(uSun, uAx);
  float bs = px * sx + py * sy;
  bool shadow = bs < 0.0 && rr * rr - bs * bs < 1.0;
  bool same = sign(sz) == sign(dot(oc, uAx));
  float L = same ? 0.8 + 0.4 * min(1.0, sqrt(abs(sz)) * 1.5) : 0.25 + 0.55 * (1.0 - op);
  if (shadow) L *= 0.08;
  outC = vec4(min(pr.rgb * L, vec3(1.0)) * alpha, alpha);
}`;

const FS_STAR = `${COMMON}
uniform vec2 uSP; uniform float uR0, uGR; uniform vec3 uCol;
void main() {
  float d = length(cssXY() - uSP);
  if (d > uGR) discard;
  float core = clamp(uR0 + 0.5 - d, 0.0, 1.0);
  float g = pow(1.0 - d / uGR, 3.0) * 0.9;
  vec3 c = mix(uCol * g, min(uCol + 0.16, vec3(1.0)), core);
  float a = max(core, g);
  outC = vec4(c * (core > 0.0 ? 1.0 : 1.0), a);
}`;

// ---- 粒子 ----
const VS_BELT = `#version 300 es
in vec4 aP;
in float aB;
uniform float uT, uMode, uAU, uFoc, uCx, uCy, uDpr, uFrost, uAlpha;
uniform vec3 uEye, uF, uR, uU;
uniform vec2 uView;
uniform float uK, uCyaw, uSyaw, uSp, uCp, uOx, uOy;
out vec3 vCol;
out float vA;
void main() {
  float th = aP.y + 6.2831853 * fract(uT / aP.w);
  vec3 p = vec3(aP.x * cos(th), aP.x * sin(th), aP.z);
  vec2 s;
  if (uMode > 1.5) {
    // 示意图:先按平方根压缩,再透视
    float dd = max(length(p), 1e-9);
    p = p * (sqrt(dd) / dd);
  }
  if (uMode < 0.5 || uMode > 1.5) {
    vec3 rel = p * uAU - uEye;
    float z = dot(rel, uF);
    if (z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    s = vec2(uCx + uFoc * dot(rel, uR) / z, uCy - uFoc * dot(rel, uU) / z);
  } else {
    float d = max(length(p), 1e-9);
    vec3 X = p * (uK * sqrt(d) / d);
    float x1 = X.x * uCyaw + X.y * uSyaw, y1 = -X.x * uSyaw + X.y * uCyaw;
    s = vec2(uCx + uOx + x1, uCy + uOy + y1 * uSp - X.z * uCp);
  }
  gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0);
  gl_PointSize = (1.0 + aB * 1.3) * uDpr;
  vCol = aP.x > uFrost ? mix(vec3(0.62, 0.72, 0.86), vec3(0.92, 0.96, 1.0), aB) : mix(vec3(0.5, 0.43, 0.36), vec3(0.86, 0.78, 0.64), aB);
  vA = uAlpha * (0.3 + 0.7 * aB);
}`;
const VS_SKY = `#version 300 es
in vec3 aD;
in vec2 aB;
uniform vec3 uF, uR, uU;
uniform float uFoc, uCx, uCy, uDpr, uAlpha;
uniform vec2 uView;
out vec3 vCol;
out float vA;
void main() {
  float z = dot(aD, uF);
  if (z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 s = vec2(uCx + uFoc * dot(aD, uR) / z, uCy - uFoc * dot(aD, uU) / z);
  gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0);
  float b = aB.x;
  gl_PointSize = (0.9 + 2.2 * b * b) * uDpr;
  vCol = mix(vec3(1.0, 0.78, 0.6), vec3(0.72, 0.82, 1.0), aB.y);
  vA = uAlpha * (0.12 + 0.88 * b);
}`;
const FS_SKYTEX = `#version 300 es
precision highp float;
uniform vec3 uF, uR, uU;
uniform float uFoc, uCx, uCy, uDpr, uHd, uAlpha;
uniform sampler2D uTex;
out vec4 outC;
const float PI = 3.14159265;
void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, (uHd - gl_FragCoord.y) / uDpr);
  vec3 d = normalize(uF + (p.x - uCx) / uFoc * uR + (uCy - p.y) / uFoc * uU);
  vec2 uv = vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(d.z, -1.0, 1.0)) / PI);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
  vec3 c = textureGrad(uTex, uv, dx, dy).rgb * uAlpha;
  outC = vec4(c, 0.0);
}`;
const FS_DOT = `#version 300 es
precision mediump float;
in vec3 vCol;
in float vA;
out vec4 outC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = vA * smoothstep(0.5, 0.15, d);
  outC = vec4(vCol * a, a);
}`;

/** 粒子画到哪:透视镜头(恒星系空间、行星系统),或者示意图(距离按平方根压缩的俯视,SystemStep 的 proj) */
export interface SkyView {
  f: V3;
  r: V3;
  u: V3;
  foc: number;
  cx: number;
  cy: number;
}
export interface OrreryView {
  K: number;
  cyaw: number;
  syaw: number;
  sp: number;
  cp: number;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
}

/**
 * 小行星带的粒子:每颗 5 个数 —— 轨道半径(天文单位)、起始角、离黄道面的高(天文单位)、周期(和 uT 同一种单位)、亮度 0–1。
 * n 颗;按种子长,同一份数组只上传一次
 */
export function beltParticles(belts: readonly { inner: number; outer: number; count: number }[], seed: number, per: number, period: (a: number) => number): Float32Array {
  let a0 = (seed ^ 0x2c1b3c6d) >>> 0 || 1;
  const r = () => {
    a0 = (a0 + 0x6d2b79f5) >>> 0;
    let t = a0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = belts.reduce((s, b) => s + Math.round(b.count * per), 0);
  const out = new Float32Array(n * 5);
  let k = 0;
  for (const b of belts) {
    const m = Math.round(b.count * per);
    for (let i = 0; i < m; i++) {
      // 半径:中间密、两边稀(两个均匀数取平均);厚度随半径;亮度大多暗
      const u = (r() + r()) / 2;
      const a = b.inner + (b.outer - b.inner) * u;
      const g = (r() + r() + r() - 1.5) * 0.06 * a;
      out[k++] = a;
      out[k++] = r() * Math.PI * 2;
      out[k++] = g;
      out[k++] = period(a);
      out[k++] = Math.pow(r(), 2.2);
    }
  }
  return out;
}

/**
 * 星空:几千颗恒星(大多暗,冷暖不一)+ 一条银河(按种子定一个大圆,带宽约 7°,一边有核球,几万个很淡的点叠成一条光带)。
 * 每颗 5 个数:方向 xyz、亮度、色温 0 暖 – 1 冷
 */
export function skyParticles(seed: number): Float32Array {
  let a0 = (seed ^ 0x51ed2701) >>> 0 || 1;
  const r = () => {
    a0 = (a0 + 0x6d2b79f5) >>> 0;
    let t = a0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
  const STARS = 5000, BAND = 45000;
  const out = new Float32Array((STARS + BAND) * 5);
  let k = 0;
  const push = (d: V3, b: number, c: number) => {
    out[k++] = d[0];
    out[k++] = d[1];
    out[k++] = d[2];
    out[k++] = b;
    out[k++] = c;
  };
  for (let i = 0; i < STARS; i++) {
    const z = r() * 2 - 1, t = r() * Math.PI * 2, c = Math.sqrt(1 - z * z);
    push([c * Math.cos(t), c * Math.sin(t), z], Math.pow(r(), 5), r());
  }
  // 沿着银河(天空贴图那条带)偏密的暗星,让带子里看得出一颗颗的星;三成撒在核球(沿经度、纬度都按高斯),核球单位天区的星比银盘密
  const { n, e1, e2 } = galaxyFrame(seed);
  for (let i = 0; i < BAND; i++) {
    const inBulge = i < BAND * 0.3;
    const lon = inBulge ? Math.max(-Math.PI, Math.min(Math.PI, gauss() * 0.42)) : r() * Math.PI * 2 - Math.PI;
    const lat = inBulge ? gauss() * 0.12 : gauss() * (0.07 + 0.14 * Math.exp(-(lon * lon) / (2 * 0.42 * 0.42)));
    const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
    push([cl * (co * e1[0] + so * e2[0]) + sl * n[0], cl * (co * e1[1] + so * e2[1]) + sl * n[1], cl * (co * e1[2] + so * e2[2]) + sl * n[2]], 0.1 + 0.4 * Math.pow(r(), 3), 0.3 + 0.6 * r());
  }
  return out;
}

export interface PerspGL {
  /** 每帧开头:按画布大小设视口、清空 */
  begin(w: number, h: number, dpr: number): void;
  clear(): void;
  sphere(c: Cam, C: V3, R: number, tex: Tex, M: [V3, V3, V3], sun: V3, ambient: number, atmo?: Atmo): void;
  ring(c: Cam, C: V3, Rp: number, prof: RingProfile, ax: V3, e1: V3, e2: V3, sun: V3): void;
  /** 恒星在屏幕上的位置、圆盘半径、辉光半径(CSS 像素),颜色 0–255 */
  star(c: Cam, x: number, y: number, r0: number, gr: number, col: V3): void;
  /** 星空的点(只跟镜头的朝向,不跟位置) */
  sky(v: SkyView, data: Float32Array, alpha: number): void;
  /** 银河的天空贴图(整屏,只跟镜头的朝向;叠加在底下) */
  skyTex(v: SkyView, tex: Tex, alpha: number): void;
  /** 小行星带:透视镜头(eye = 镜头在世界里的位置,公里;auKm = 一个天文单位几公里) */
  beltPersp(v: SkyView, eye: V3, data: Float32Array, t: number, auKm: number, frost: number, alpha: number): void;
  /** 小行星带:示意图的透视(位置先按平方根压缩;eye 在压缩坐标里) */
  beltComp(v: SkyView, eye: V3, data: Float32Array, t: number, frost: number, alpha: number): void;
  /** 小行星带:示意图(旧的正交画法) */
  beltOrrery(v: OrreryView, data: Float32Array, t: number, frost: number, alpha: number): void;
}

const TEX_MAX = 48;

export function createPerspGL(canvas: HTMLCanvasElement): PerspGL | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const compile = (fs: string): WebGLProgram | null => {
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aP');
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  };
  const pSphere = compile(FS_SPHERE), pRing = compile(FS_RING), pStar = compile(FS_STAR);
  if (!pSphere || !pRing || !pStar) return null;
  const link = (vs: string, fs: string, attrs: string[]): WebGLProgram | null => {
    const mk = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const pr = gl.createProgram()!;
    gl.attachShader(pr, v);
    gl.attachShader(pr, f);
    attrs.forEach((a, i) => gl.bindAttribLocation(pr, i + 1, a));
    gl.linkProgram(pr);
    return gl.getProgramParameter(pr, gl.LINK_STATUS) ? pr : null;
  };
  // 粒子用属性位置 1、2(0 是画矩形的那个)
  const pBelt = link(VS_BELT, FS_DOT, ['aP', 'aB']);
  const pSky = link(VS_SKY, FS_DOT, ['aD', 'aB']);
  const pSkyTex = compile(FS_SKYTEX);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const locs = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const U = (p: WebGLProgram, n: string) => {
    let m = locs.get(p);
    if (!m) locs.set(p, (m = new Map()));
    if (!m.has(n)) m.set(n, gl.getUniformLocation(p, n));
    return m.get(n)!;
  };
  let W = 1, H = 1, DPR = 1;
  const use = (p: WebGLProgram, c: Cam) => {
    gl.useProgram(p);
    gl.uniform2f(U(p, 'uView'), W, H);
    gl.uniform3fv(U(p, 'uEye'), c.eye);
    gl.uniform3fv(U(p, 'uF'), c.f);
    gl.uniform3fv(U(p, 'uR'), c.r);
    gl.uniform3fv(U(p, 'uU'), c.u);
    gl.uniform1f(U(p, 'uFoc'), c.foc);
    gl.uniform1f(U(p, 'uCx'), c.cx);
    gl.uniform1f(U(p, 'uCy'), c.cy);
    gl.uniform1f(U(p, 'uDpr'), DPR);
    gl.uniform1f(U(p, 'uHd'), H * DPR);
  };
  const rect = (p: WebGLProgram, x0: number, y0: number, x1: number, y1: number) => {
    gl.uniform4f(U(p, 'uRect'), Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // ---- 贴图(按像素数组认;最多 TEX_MAX 张,先进先删) ----
  const texs = new Map<object, WebGLTexture>();
  const keep = (k: object, t: WebGLTexture) => {
    texs.set(k, t);
    if (texs.size > TEX_MAX) {
      const [k0, t0] = texs.entries().next().value as [object, WebGLTexture];
      gl.deleteTexture(t0);
      texs.delete(k0);
    }
  };
  const texOf = (tex: Tex): WebGLTexture => {
    const hit = texs.get(tex.px);
    if (hit) return hit;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tex.w, tex.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(tex.px.buffer, tex.px.byteOffset, tex.w * tex.h * 4));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    keep(tex.px, t);
    return t;
  };
  const glowOf = (tex: Tex): WebGLTexture | null => {
    if (!tex.glow) return null;
    const hit = texs.get(tex.glow);
    if (hit) return hit;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, tex.w, tex.h, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(tex.glow.buffer, tex.glow.byteOffset, tex.w * tex.h));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    keep(tex.glow, t);
    return t;
  };
  const profOf = (prof: RingProfile): WebGLTexture => {
    const hit = texs.get(prof);
    if (hit) return hit;
    const N = prof.op.length;
    const d = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      d[i * 4] = Math.min(255, prof.col[i * 3]);
      d[i * 4 + 1] = Math.min(255, prof.col[i * 3 + 1]);
      d[i * 4 + 2] = Math.min(255, prof.col[i * 3 + 2]);
      d[i * 4 + 3] = Math.round(Math.min(1, prof.op[i]) * 255);
    }
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    keep(prof, t);
    return t;
  };

  /** 世界里一点 → 屏幕;身后 = null */
  const proj = (c: Cam, p: V3): [number, number] | null => {
    const d: V3 = [p[0] - c.eye[0], p[1] - c.eye[1], p[2] - c.eye[2]];
    const z = d[0] * c.f[0] + d[1] * c.f[1] + d[2] * c.f[2];
    if (z <= 1e-6) return null;
    return [c.cx + (c.foc * (d[0] * c.r[0] + d[1] * c.r[1] + d[2] * c.r[2])) / z, c.cy - (c.foc * (d[0] * c.u[0] + d[1] * c.u[1] + d[2] * c.u[2])) / z];
  };

  // 粒子的顶点(按数组认,只上传一次)
  const pbufs = new Map<Float32Array, { vao: WebGLVertexArrayObject; n: number }>();
  const pbufOf = (data: Float32Array, split: number): { vao: WebGLVertexArrayObject; n: number } => {
    let hit = pbufs.get(data);
    if (hit) return hit;
    const b = gl.createBuffer();
    const va = gl.createVertexArray()!;
    gl.bindVertexArray(va);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, split, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 5 - split, gl.FLOAT, false, 20, split * 4);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    hit = { vao: va, n: data.length / 5 };
    if (pbufs.size > 8) {
      const [k0, v0] = pbufs.entries().next().value as [Float32Array, { vao: WebGLVertexArrayObject }];
      gl.deleteVertexArray(v0.vao);
      pbufs.delete(k0);
    }
    pbufs.set(data, hit);
    return hit;
  };
  const points = (pr: WebGLProgram, data: Float32Array, split: number) => {
    const pb = pbufOf(data, split);
    gl.bindVertexArray(pb.vao);
    // 叠加:密的地方亮起来
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, pb.n);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    void pr;
  };
  const viewU = (pr: WebGLProgram, v: SkyView) => {
    gl.uniform2f(U(pr, 'uView'), W, H);
    gl.uniform3fv(U(pr, 'uF'), v.f);
    gl.uniform3fv(U(pr, 'uR'), v.r);
    gl.uniform3fv(U(pr, 'uU'), v.u);
    gl.uniform1f(U(pr, 'uFoc'), v.foc);
    gl.uniform1f(U(pr, 'uCx'), v.cx);
    gl.uniform1f(U(pr, 'uCy'), v.cy);
    gl.uniform1f(U(pr, 'uDpr'), DPR);
  };

  return {
    skyTex(v, tex, alpha) {
      if (!pSkyTex) return;
      gl.useProgram(pSkyTex);
      gl.uniform2f(U(pSkyTex, 'uView'), W, H);
      gl.uniform3fv(U(pSkyTex, 'uF'), v.f);
      gl.uniform3fv(U(pSkyTex, 'uR'), v.r);
      gl.uniform3fv(U(pSkyTex, 'uU'), v.u);
      gl.uniform1f(U(pSkyTex, 'uFoc'), v.foc);
      gl.uniform1f(U(pSkyTex, 'uCx'), v.cx);
      gl.uniform1f(U(pSkyTex, 'uCy'), v.cy);
      gl.uniform1f(U(pSkyTex, 'uDpr'), DPR);
      gl.uniform1f(U(pSkyTex, 'uHd'), H * DPR);
      gl.uniform1f(U(pSkyTex, 'uAlpha'), alpha);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texOf(tex));
      gl.uniform1i(U(pSkyTex, 'uTex'), 0);
      gl.blendFunc(gl.ONE, gl.ONE);
      rect(pSkyTex, 0, 0, W, H);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    },
    sky(v, data, alpha) {
      if (!pSky) return;
      gl.useProgram(pSky);
      viewU(pSky, v);
      gl.uniform1f(U(pSky, 'uAlpha'), alpha);
      points(pSky, data, 3);
    },
    beltPersp(v, eye, data, t, auKm, frost, alpha) {
      if (!pBelt) return;
      gl.useProgram(pBelt);
      viewU(pBelt, v);
      gl.uniform1f(U(pBelt, 'uMode'), 0);
      gl.uniform3fv(U(pBelt, 'uEye'), eye);
      gl.uniform1f(U(pBelt, 'uAU'), auKm);
      gl.uniform1f(U(pBelt, 'uT'), t);
      gl.uniform1f(U(pBelt, 'uFrost'), frost);
      gl.uniform1f(U(pBelt, 'uAlpha'), alpha);
      points(pBelt, data, 4);
    },
    beltComp(v, eye, data, t, frost, alpha) {
      if (!pBelt) return;
      gl.useProgram(pBelt);
      viewU(pBelt, v);
      gl.uniform1f(U(pBelt, 'uMode'), 2);
      gl.uniform3fv(U(pBelt, 'uEye'), eye);
      gl.uniform1f(U(pBelt, 'uAU'), 1);
      gl.uniform1f(U(pBelt, 'uT'), t);
      gl.uniform1f(U(pBelt, 'uFrost'), frost);
      gl.uniform1f(U(pBelt, 'uAlpha'), alpha);
      points(pBelt, data, 4);
    },
    beltOrrery(v, data, t, frost, alpha) {
      if (!pBelt) return;
      gl.useProgram(pBelt);
      gl.uniform2f(U(pBelt, 'uView'), W, H);
      gl.uniform1f(U(pBelt, 'uDpr'), DPR);
      gl.uniform1f(U(pBelt, 'uMode'), 1);
      gl.uniform1f(U(pBelt, 'uK'), v.K);
      gl.uniform1f(U(pBelt, 'uCyaw'), v.cyaw);
      gl.uniform1f(U(pBelt, 'uSyaw'), v.syaw);
      gl.uniform1f(U(pBelt, 'uSp'), v.sp);
      gl.uniform1f(U(pBelt, 'uCp'), v.cp);
      gl.uniform1f(U(pBelt, 'uOx'), v.ox);
      gl.uniform1f(U(pBelt, 'uOy'), v.oy);
      gl.uniform1f(U(pBelt, 'uCx'), v.cx);
      gl.uniform1f(U(pBelt, 'uCy'), v.cy);
      gl.uniform1f(U(pBelt, 'uT'), t);
      gl.uniform1f(U(pBelt, 'uFrost'), frost);
      gl.uniform1f(U(pBelt, 'uAlpha'), alpha);
      points(pBelt, data, 4);
    },
    begin(w, h, dpr) {
      W = w;
      H = h;
      DPR = dpr;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    sphere(c, C, R, tex, M, sun, ambient, atmo) {
      const oc: V3 = [c.eye[0] - C[0], c.eye[1] - C[1], c.eye[2] - C[2]];
      const dist = Math.hypot(oc[0], oc[1], oc[2]);
      if (dist <= R) return;
      const halo = atmo ? 1.04 : 1;
      const pc = proj(c, C);
      const ang = Math.asin(Math.min(1, (R * halo) / dist));
      let x0 = 0, y0 = 0, x1 = W, y1 = H;
      if (pc && ang < 1.2) {
        const off = Math.hypot(pc[0] - c.cx, pc[1] - c.cy) / c.foc;
        const sr = c.foc * Math.tan(ang) * (1 + 0.6 * off * off) + 3;
        x0 = pc[0] - sr;
        x1 = pc[0] + sr;
        y0 = pc[1] - sr;
        y1 = pc[1] + sr;
      } else if (!pc && -(oc[0] * c.f[0] + oc[1] * c.f[1] + oc[2] * c.f[2]) < -R * halo) return;
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return;
      const p = pSphere;
      use(p, c);
      gl.uniform3fv(U(p, 'uC'), C);
      gl.uniform1f(U(p, 'uRad'), R);
      gl.uniform1f(U(p, 'uHalo'), halo);
      gl.uniform3fv(U(p, 'uSun'), sun);
      gl.uniform1f(U(p, 'uAmb'), ambient);
      gl.uniform3fv(U(p, 'uM0'), M[0]);
      gl.uniform3fv(U(p, 'uM1'), M[1]);
      gl.uniform3fv(U(p, 'uM2'), M[2]);
      gl.uniform3f(U(p, 'uAtmoCol'), (atmo?.color[0] ?? 0) / 255, (atmo?.color[1] ?? 0) / 255, (atmo?.color[2] ?? 0) / 255);
      gl.uniform1f(U(p, 'uAtmo'), atmo?.strength ?? 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texOf(tex));
      gl.uniform1i(U(p, 'uTex'), 0);
      const gt = glowOf(tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, gt ?? texOf(tex));
      gl.uniform1i(U(p, 'uGlow'), 1);
      gl.uniform1f(U(p, 'uHasGlow'), gt ? 1 : 0);
      rect(p, x0, y0, x1, y1);
    },
    ring(c, C, Rp, prof, ax, e1, e2, sun) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false, behind = false;
      const R = prof.outer * Rp;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const q = proj(c, [C[0] + R * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]), C[1] + R * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]), C[2] + R * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])]);
        if (!q) {
          behind = true;
          continue;
        }
        any = true;
        x0 = Math.min(x0, q[0]);
        y0 = Math.min(y0, q[1]);
        x1 = Math.max(x1, q[0]);
        y1 = Math.max(y1, q[1]);
      }
      if (!any) return;
      if (behind) {
        x0 = 0;
        y0 = 0;
        x1 = W;
        y1 = H;
      }
      const p = pRing;
      use(p, c);
      gl.uniform3fv(U(p, 'uC'), C);
      gl.uniform1f(U(p, 'uRp'), Rp);
      gl.uniform1f(U(p, 'uInner'), prof.inner);
      gl.uniform1f(U(p, 'uOuter'), prof.outer);
      gl.uniform3fv(U(p, 'uAx'), ax);
      gl.uniform3fv(U(p, 'uE1'), e1);
      gl.uniform3fv(U(p, 'uE2'), e2);
      gl.uniform3fv(U(p, 'uSun'), sun);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, profOf(prof));
      gl.uniform1i(U(p, 'uProf'), 0);
      rect(p, x0 - 3, y0 - 3, x1 + 3, y1 + 3);
    },
    star(c, x, y, r0, gr, col) {
      const p = pStar;
      use(p, c);
      gl.uniform2f(U(p, 'uSP'), x, y);
      gl.uniform1f(U(p, 'uR0'), r0);
      gl.uniform1f(U(p, 'uGR'), gr);
      gl.uniform3f(U(p, 'uCol'), col[0] / 255, col[1] / 255, col[2] / 255);
      rect(p, x - gr, y - gr, x + gr, y + gr);
    },
  };
}
