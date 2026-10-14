// Relations painting 1 as a 3D object: a rippled mirror-steel sheet carrying the print.
// From the record: the size (121 × 130 cm) and the material (transfer print on mirror-finish rippled steel).
// Approximated: the thickness, the ripple pattern (procedural, not a scan) and the room it reflects.
// Units match js/pointcloud.js (the width is 1), so the two can share one camera. No dependencies; WebGL 1.

const VS = `
attribute vec2 aUV;
uniform mat4 uMVP, uM; uniform vec2 uSize; uniform float uAmp, uOff;
varying vec3 vPosW, vNW; varying vec2 vUV;
float h(vec2 q){
  return uAmp * ( 0.50*sin(q.x*31.0 + 1.7*sin(q.y*17.0))
                + 0.35*sin(q.y*27.0 + q.x*9.0 + 1.3)
                + 0.18*sin((q.x + q.y)*53.0)
                + 0.10*sin(q.x*71.0 - q.y*44.0 + 0.7) );
}
void main(){
  vec2 q = vec2(aUV.x - 0.5, 0.5 - aUV.y) * uSize;
  float e = 0.002, z = h(q);
  vec3 n = normalize(vec3(-(h(q + vec2(e,0.0)) - z)/e, -(h(q + vec2(0.0,e)) - z)/e, 1.0));
  vec4 w = uM * vec4(q, z + uOff, 1.0);
  vPosW = w.xyz; vNW = mat3(uM) * n; vUV = aUV;
  gl_Position = uMVP * vec4(q, z + uOff, 1.0);
}`;

const FS = `
precision highp float;
uniform sampler2D uTex; uniform vec4 uCrop; uniform vec3 uEye; uniform float uTime, uLight, uBack;
varying vec3 vPosW, vNW; varying vec2 vUV;
// a quiet studio: pale walls like the page, a floor a little darker, two soft lights that drift
vec3 env(vec3 r){
  vec3 c = mix(vec3(0.62,0.61,0.59), vec3(0.97,0.96,0.94), smoothstep(-0.6, 0.5, r.y));
  float s1 = exp(-pow((r.x - 0.55*sin(uTime*0.13)) / 0.07, 2.0)) * smoothstep(-0.2, 0.4, r.y);
  float s2 = exp(-pow((r.y - 0.35 - 0.2*sin(uTime*0.09 + 1.0)) / 0.05, 2.0));
  return c + uLight * (1.6*s1 + 0.9*s2) * vec3(1.0, 0.98, 0.95);
}
void main(){
  vec3 N = normalize(vNW), V = normalize(uEye - vPosW);
  bool front = gl_FrontFacing && uBack < 0.5; if (!gl_FrontFacing) N = -N;
  vec3 R = reflect(-V, N);
  float fres = 0.55 + 0.45*pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col;
  if (front) {
    vec3 t = texture2D(uTex, mix(uCrop.xy, uCrop.zw, vUV)).rgb;
    float lum = dot(t, vec3(0.299, 0.587, 0.114));
    float dif = 0.78 + 0.22*max(dot(N, normalize(vec3(-0.3, 0.6, 0.8))), 0.0);
    col = t*dif*0.9 + env(R)*fres*(0.12 + 0.30*lum);
  } else {
    col = env(R)*fres*0.62 + vec3(0.06);   // the bare steel back
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SIDE_VS = `
attribute vec3 aP; attribute vec2 aN; uniform mat4 uMVP, uM; varying vec3 vPosW, vNW;
void main(){ vPosW = (uM*vec4(aP,1.0)).xyz; vNW = mat3(uM)*vec3(aN,0.0); gl_Position = uMVP*vec4(aP,1.0); }`;
const SIDE_FS = `
precision highp float; uniform vec3 uEye; uniform float uTime, uLight; varying vec3 vPosW, vNW;
vec3 env(vec3 r){
  vec3 c = mix(vec3(0.62,0.61,0.59), vec3(0.97,0.96,0.94), smoothstep(-0.6, 0.5, r.y));
  float s1 = exp(-pow((r.x - 0.55*sin(uTime*0.13)) / 0.07, 2.0)) * smoothstep(-0.2, 0.4, r.y);
  return c + uLight*1.6*s1;
}
void main(){ vec3 N = normalize(vNW), V = normalize(uEye - vPosW); if (dot(N,V) < 0.0) N = -N;
  gl_FragColor = vec4(env(reflect(-V, N))*0.55 + vec3(0.05), 1.0); }`;

const persp =(fovy, aspect, n, f) => { const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
  return [t/aspect,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]; };
const mul = (a, b) => { const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o; };
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; };
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; };
const trans = (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
const apply = (m, p) => { const [x,y,z] = p, w = m[3]*x + m[7]*y + m[11]*z + m[15];
  return [(m[0]*x + m[4]*y + m[8]*z + m[12])/w, (m[1]*x + m[5]*y + m[9]*z + m[13])/w, w]; };

export async function createPanel(canvas, {src, crop, widthCm = 121, heightCm = 130, thickCm = 2.5, grid = 220}) {
  const gl = canvas.getContext('webgl', {alpha: true, antialias: true, premultipliedAlpha: false});
  if (!gl) return null;
  const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  // grid of (grid+1)^2 vertices, drawn as indexed triangles (WebGL 1: indices must stay under 65536)
  const n = Math.min(grid, 250), uv = new Float32Array((n+1)*(n+1)*2), idx = new Uint16Array(n*n*6);
  for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++) { uv[k++] = i/n; uv[k++] = j/n; }
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j*(n+1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aUV'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  const im = new Image(); im.decoding = 'async'; im.src = src; await im.decode();
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
  for (const [p, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]])
    gl.texParameteri(gl.TEXTURE_2D, p, v);

  const uvBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING), idxBuf = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  const U = {}; for (const u of ['uMVP','uM','uSize','uAmp','uOff','uBack','uTex','uCrop','uEye','uTime','uLight']) U[u] = gl.getUniformLocation(prog, u);
  // 1 unit = the width (121 cm), as in the point cloud
  const size = [1, heightCm/widthCm];
  gl.uniform2f(U.uSize, size[0], size[1]); gl.uniform4f(U.uCrop, ...crop); gl.uniform1i(U.uTex, 0);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

  const state = {fov: 32*Math.PI/180, camZ: 2.75, x: 0, y: 0, rotX: 0, rotY: 0, time: 0, amp: 0.0065, light: 1,
    thick: thickCm/widthCm, pr: Math.min(devicePixelRatio || 1, 2), w: 1, h: 1};

  // the sheet's edges: strips from the rippled front edge back by the thickness (same ripple formula as the shader)
  const hJS = (x, y) => state.amp*(0.50*Math.sin(x*31 + 1.7*Math.sin(y*17)) + 0.35*Math.sin(y*27 + x*9 + 1.3)
    + 0.18*Math.sin((x + y)*53) + 0.10*Math.sin(x*71 - y*44 + 0.7));
  const [hw, hh] = [size[0]/2, size[1]/2], E = 160, side = [];
  const edge = (x0, y0, x1, y1, nx, ny) => { for (let i = 0; i < E; i++) {
    const a = i/E, b = (i + 1)/E, xa = x0 + (x1 - x0)*a, ya = y0 + (y1 - y0)*a, xb = x0 + (x1 - x0)*b, yb = y0 + (y1 - y0)*b;
    const za = hJS(xa, ya), zb = hJS(xb, yb), t = state.thick;
    side.push(xa,ya,za,nx,ny, xb,yb,zb,nx,ny, xa,ya,za - t,nx,ny, xb,yb,zb,nx,ny, xb,yb,zb - t,nx,ny, xa,ya,za - t,nx,ny); } };
  edge(-hw, hh, hw, hh, 0, 1); edge(hw, hh, hw, -hh, 1, 0); edge(hw, -hh, -hw, -hh, 0, -1); edge(-hw, -hh, -hw, hh, -1, 0);
  const sideProg = gl.createProgram();
  gl.attachShader(sideProg, sh(gl.VERTEX_SHADER, SIDE_VS)); gl.attachShader(sideProg, sh(gl.FRAGMENT_SHADER, SIDE_FS)); gl.linkProgram(sideProg);
  const sideBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sideBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(side), gl.STATIC_DRAW);
  const sideCount = side.length/5, SU = {}; for (const u of ['uMVP','uM','uEye','uTime','uLight']) SU[u] = gl.getUniformLocation(sideProg, u);
  const sP = gl.getAttribLocation(sideProg, 'aP'), sN = gl.getAttribLocation(sideProg, 'aN');
  const mats = () => { const M = mul(rotX(state.rotX), rotY(state.rotY)), V = trans(state.x, state.y, -state.camZ);
    const P = persp(state.fov, state.w/state.h, 0.1, 20); return {M, PV: mul(P, V), MVP: mul(P, mul(V, M))}; };
  return {
    state, size,
    resize(w, h) { state.w = w; state.h = h; canvas.width = Math.round(w*state.pr); canvas.height = Math.round(h*state.pr); gl.viewport(0, 0, canvas.width, canvas.height); },
    render() {
      const {M, MVP} = mats();
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // front sheet, then the back sheet one thickness behind
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.uniformMatrix4fv(U.uMVP, false, MVP); gl.uniformMatrix4fv(U.uM, false, M);
      gl.uniform3f(U.uEye, -state.x, -state.y, state.camZ);
      gl.uniform1f(U.uAmp, state.amp); gl.uniform1f(U.uTime, state.time); gl.uniform1f(U.uLight, state.light);
      gl.uniform1f(U.uOff, 0); gl.uniform1f(U.uBack, 0); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      gl.uniform1f(U.uOff, -state.thick); gl.uniform1f(U.uBack, 1); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(loc);
      // edges
      gl.useProgram(sideProg); gl.bindBuffer(gl.ARRAY_BUFFER, sideBuf);
      gl.enableVertexAttribArray(sP); gl.vertexAttribPointer(sP, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(sN); gl.vertexAttribPointer(sN, 2, gl.FLOAT, false, 20, 12);
      gl.uniformMatrix4fv(SU.uMVP, false, MVP); gl.uniformMatrix4fv(SU.uM, false, M);
      gl.uniform3f(SU.uEye, -state.x, -state.y, state.camZ); gl.uniform1f(SU.uTime, state.time); gl.uniform1f(SU.uLight, state.light);
      gl.drawArrays(gl.TRIANGLES, 0, sideCount);
      gl.disableVertexAttribArray(sP); gl.disableVertexAttribArray(sN);
    },
    // a point on the panel (panel units, unrotated) → CSS pixels on screen
    project(px, py) { const {MVP} = mats(), [X, Y] = apply(MVP, [px, py, 0]);
      return [(X*0.5 + 0.5)*state.w, (-Y*0.5 + 0.5)*state.h]; },
    // CSS pixels on screen → [u, v] on the sheet (0–1 from the top left), or null if the ray misses it
    pick(sx, sy) {
      const t = Math.tan(state.fov/2), d = [(sx/state.w*2 - 1)*t*state.w/state.h, (1 - sy/state.h*2)*t, -1], o = [-state.x, -state.y, state.camZ];
      const {M} = mats(), inv = v => [M[0]*v[0] + M[1]*v[1] + M[2]*v[2], M[4]*v[0] + M[5]*v[1] + M[6]*v[2], M[8]*v[0] + M[9]*v[1] + M[10]*v[2]];
      const om = inv(o), dm = inv(d); if (Math.abs(dm[2]) < 1e-6) return null;
      const k = -om[2]/dm[2]; if (k <= 0) return null;
      const u = (om[0] + dm[0]*k)/size[0] + 0.5, v = 0.5 - (om[1] + dm[1]*k)/size[1];
      return (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? [u, v] : null; },
  };
}
