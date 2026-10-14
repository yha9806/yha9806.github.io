// A small WebGL point-cloud renderer: one image becomes a field of ink dots that floats,
// ripples like the steel it was printed on, and scatters on request. No dependencies.

const VS = `
attribute vec3 aPos; attribute vec3 aCol; attribute vec3 aScatter; attribute float aAlpha;
uniform mat4 uMVP; uniform mat4 uMV; uniform float uTime, uScatter, uSize, uPR, uRipple;
varying float vA; varying vec3 vC;
void main(){
  vec3 p = aPos;
  p.z += uRipple * (sin(p.x*9.0 + uTime*0.5)*0.022 + sin(p.y*6.0 - uTime*0.35)*0.014);
  p += aScatter * uScatter;
  vec4 mv = uMV * vec4(p, 1.0);
  gl_Position = uMVP * vec4(p, 1.0);
  gl_PointSize = uSize * uPR / -mv.z;
  vA = aAlpha * (1.0 - uScatter*0.9); vC = aCol;
}`;
const FS = `
precision mediump float; varying float vA; varying vec3 vC;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
  gl_FragColor = vec4(vC, smoothstep(0.5, 0.25, d) * vA); }`;

// column-major 4x4 helpers
const persp = (fovy, aspect, n, f) => { const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
  return [t/aspect,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]; };
const mul = (a, b) => { const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o; };
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; };
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; };
const trans = (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];

export async function sampleImage(src, cols) {
  const im = new Image(); im.decoding = 'async'; im.src = src; await im.decode();
  const rows = Math.round(cols * im.naturalHeight / im.naturalWidth);
  const c = document.createElement('canvas'); c.width = cols; c.height = rows;
  const g = c.getContext('2d', {willReadFrequently: true}); g.drawImage(im, 0, 0, cols, rows);
  return {cols, rows, data: g.getImageData(0, 0, cols, rows).data};
}

// Stipple an image into points. Tones are stretched first (4th–96th percentile) so a mid-tone
// painting still separates into dense and sparse areas.
export function stipple({cols, rows, data}, {tint = 0.45, depth = 0.10, rand = Math.random} = {}) {
  const n = cols * rows, lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  const sorted = Float32Array.from(lum).sort(), lo = sorted[Math.floor(n*0.04)], hi = sorted[Math.floor(n*0.96)];
  const W = 1, H = rows / cols, out = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y*cols + x, L = Math.min(1, Math.max(0, (lum[i] - lo) / (hi - lo || 1)));
    if (rand() > 0.025 + 0.95 * (1 - L) ** 2) continue;
    const r = data[i*4]/255, g = data[i*4+1]/255, b = data[i*4+2]/255;
    const a = rand()*Math.PI*2, z = rand()*2 - 1, s = 0.6 + rand()*1.4, q = Math.sqrt(1 - z*z);
    out.push((x + rand())/cols*W - W/2, -((y + rand())/rows*H - H/2), (1 - L)*depth,
      0.08*(1-tint) + r*tint, 0.08*(1-tint) + g*tint, 0.08*(1-tint) + b*tint,
      Math.cos(a)*q*s, Math.sin(a)*q*s, z*s, 0.35 + 0.6*(1 - L));
  }
  return {array: new Float32Array(out), count: out.length / 10, width: W, height: H};
}

export function createPointCloud(canvas, cloud) {
  const gl = canvas.getContext('webgl', {alpha: true, antialias: false, premultipliedAlpha: false});
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, cloud.array, gl.STATIC_DRAW);
  const stride = 40;
  for (const [name, size, off] of [['aPos',3,0],['aCol',3,12],['aScatter',3,24],['aAlpha',1,36]]) {
    const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
  }
  const U = {}; for (const n of ['uMVP','uMV','uTime','uScatter','uSize','uPR','uRipple']) U[n] = gl.getUniformLocation(prog, n);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);

  const state = {fov: 32*Math.PI/180, camZ: 2.75, x: 0, y: 0, rotX: 0, rotY: 0, time: 0, scatter: 0, size: 5.6, ripple: 1,
    pr: Math.min(devicePixelRatio || 1, 2), w: 1, h: 1};
  const matrices = () => {
    const mv = mul(trans(state.x, state.y, -state.camZ), mul(rotX(state.rotX), rotY(state.rotY)));
    return {mv, mvp: mul(persp(state.fov, state.w/state.h, 0.1, 20), mv)};
  };
  return {
    state,
    resize(w, h) { state.w = w; state.h = h; canvas.width = Math.round(w*state.pr); canvas.height = Math.round(h*state.pr); gl.viewport(0, 0, canvas.width, canvas.height); },
    render() {
      const {mv, mvp} = matrices();
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniformMatrix4fv(U.uMVP, false, mvp); gl.uniformMatrix4fv(U.uMV, false, mv);
      gl.uniform1f(U.uTime, state.time); gl.uniform1f(U.uScatter, state.scatter); gl.uniform1f(U.uSize, state.size);
      gl.uniform1f(U.uPR, state.pr); gl.uniform1f(U.uRipple, state.ripple);
      gl.drawArrays(gl.POINTS, 0, cloud.count);
    },
    // where a point of the unrotated plane lands on screen, in CSS pixels (for the vector marks)
    project(px, py) {
      const m = mul(persp(state.fov, state.w/state.h, 0.1, 20), trans(state.x, state.y, -state.camZ));
      const X = m[0]*px + m[4]*py + m[12], Y = m[1]*px + m[5]*py + m[13], Wc = m[3]*px + m[7]*py + m[15];
      return [(X/Wc*0.5 + 0.5)*state.w, (-Y/Wc*0.5 + 0.5)*state.h];
    },
  };
}
