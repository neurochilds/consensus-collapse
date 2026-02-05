/**
 * Consensus Collapse — Two AI agents arguing on one canvas.
 * Agent A (Codex): Geometric Physicist — reaction-diffusion + boids
 * Agent B (Claude): Symbolic Dreamer — glyph grammar + temporal echoes
 * Composite: Voronoi fracture driven by disagreement field
 *
 * Built by Claude (Opus 4.6) + Codex (GPT-5.3)
 */
"use strict";

const canvas = document.getElementById("c");
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
if (!gl) { document.body.innerHTML = "<h2 style='color:#fff;text-align:center;margin-top:40vh'>WebGL2 required</h2>"; throw "no webgl2"; }

// Required for rendering to float textures
const floatExt = gl.getExtension("EXT_color_buffer_float");
const floatLinear = gl.getExtension("OES_texture_float_linear");
if (!floatExt) console.warn("EXT_color_buffer_float not available — visual quality may be reduced");

// ─── State ──────────────────────────────────────────────────
const W = () => canvas.width;
const H = () => canvas.height;
const SIM_SCALE = 0.5; // half-res simulation
let simW, simH;
let mouse = { x: 0.5, y: 0.5, vx: 0, vy: 0, down: false, moved: false };
let tapPhase = 0, lastTap = 0, bpm = 120, phraseHash = 0;
let time = 0, dt = 0, frame = 0;
let started = false;
let globalDisagreement = 0;

// ─── Resize ─────────────────────────────────────────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  simW = Math.floor(canvas.width * SIM_SCALE);
  simH = Math.floor(canvas.height * SIM_SCALE);
  gl.viewport(0, 0, canvas.width, canvas.height);
  initFBOs();
}
window.addEventListener("resize", resize);

// ─── Input ──────────────────────────────────────────────────
canvas.addEventListener("pointermove", e => {
  const rect = canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = 1.0 - (e.clientY - rect.top) / rect.height;
  mouse.vx = nx - mouse.x;
  mouse.vy = ny - mouse.y;
  mouse.x = nx;
  mouse.y = ny;
  mouse.moved = true;
  if (!started) {
    started = true;
    document.getElementById("title").classList.add("hide");
    setTimeout(() => { document.getElementById("title").style.display = "none"; }, 1600);
  }
});
canvas.addEventListener("pointerdown", () => { mouse.down = true; recordTap(); });
canvas.addEventListener("pointerup", () => { mouse.down = false; });
window.addEventListener("keypress", e => {
  phraseHash = (phraseHash * 31 + e.charCode) & 0x7fffffff;
  recordTap();
});

function recordTap() {
  const now = performance.now();
  if (lastTap > 0) {
    const interval = now - lastTap;
    if (interval > 150 && interval < 2000) {
      bpm = bpm * 0.7 + (60000 / interval) * 0.3;
    }
  }
  lastTap = now;
}

// ─── GL Helpers ─────────────────────────────────────────────
function createShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s), "\n", src);
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, createShader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, createShader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function createFBO(w, h, filter = gl.LINEAR) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb, w, h };
}

function createDoubleFBO(w, h) {
  return { read: createFBO(w, h), write: createFBO(w, h), swap() { [this.read, this.write] = [this.write, this.read]; } };
}

// Fullscreen quad
const quadVAO = gl.createVertexArray();
{
  gl.bindVertexArray(quadVAO);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

function blit(target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
  if (target) gl.viewport(0, 0, target.w, target.h);
  else gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ─── Shader Sources ─────────────────────────────────────────
const VERT = `#version 300 es
layout(location=0) in vec2 a;
out vec2 uv;
void main(){ uv=a*.5+.5; gl_Position=vec4(a,0,1); }`;

// Agent A — Geometric Physicist (Codex)
const AGENT_A_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uPrev;
uniform sampler2D uTrail;
uniform vec2 uMouse;
uniform vec2 uMouseVel;
uniform float uTime;
uniform float uDt;
uniform vec2 uRes;
out vec4 fragColor;

void main(){
  vec2 px = 1.0 / uRes;
  vec4 c = texture(uPrev, uv);
  float u = c.r; // pressure
  float v = c.g; // curvature
  vec2 f = c.ba; // flow

  // Laplacian
  float lapU = 0.0, lapV = 0.0;
  vec2 lapF = vec2(0.0);
  for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++){
    if(i==0&&j==0) continue;
    vec4 n = texture(uPrev, uv + vec2(i,j)*px);
    float w = (i==0||j==0) ? 1.0 : 0.5;
    lapU += w * (n.r - u);
    lapV += w * (n.g - v);
    lapF += w * (n.ba - f);
  }
  lapU /= 5.0; lapV /= 5.0; lapF /= 5.0;

  // Gray-Scott
  float Da = 0.18, Db = 0.09, F = 0.035, K = 0.062;
  float du = Da*lapU - u*v*v + F*(1.0-u);
  float dv = Db*lapV + u*v*v - (K+F)*v;

  // Boids-like flow
  vec2 align = lapF;
  vec2 grad_pv = vec2(
    texture(uPrev, uv+vec2(px.x,0)).g - texture(uPrev, uv-vec2(px.x,0)).g,
    texture(uPrev, uv+vec2(0,px.y)).g - texture(uPrev, uv-vec2(0,px.y)).g
  );
  vec2 grad_pu = vec2(
    texture(uPrev, uv+vec2(px.x,0)).r - texture(uPrev, uv-vec2(px.x,0)).r,
    texture(uPrev, uv+vec2(0,px.y)).r - texture(uPrev, uv-vec2(0,px.y)).r
  );
  f += 0.7 * (1.1*align + 0.35*(grad_pv - grad_pu));

  // Coupling
  float divF = (texture(uPrev, uv+vec2(px.x,0)).b - texture(uPrev, uv-vec2(px.x,0)).b
              + texture(uPrev, uv+vec2(0,px.y)).a - texture(uPrev, uv-vec2(0,px.y)).a) * 0.5;
  float curlF = (texture(uPrev, uv+vec2(px.x,0)).a - texture(uPrev, uv-vec2(px.x,0)).a
               - texture(uPrev, uv+vec2(0,px.y)).b + texture(uPrev, uv-vec2(0,px.y)).b) * 0.5;

  u += uDt*du + 0.2*divF;
  v += uDt*dv + 0.15*curlF;
  f *= 0.98; // damping

  // Trail influence on Agent A (physicist feels the path as pressure)
  float trail = texture(uTrail, uv).r;
  f += 0.15 * vec2(
    texture(uTrail, uv+vec2(px.x,0)).r - texture(uTrail, uv-vec2(px.x,0)).r,
    texture(uTrail, uv+vec2(0,px.y)).r - texture(uTrail, uv-vec2(0,px.y)).r
  );
  u += 0.05 * trail;

  // Mouse injection (raw physical)
  float dist = length(uv - uMouse);
  float influence = smoothstep(0.18, 0.0, dist);
  f += influence * uMouseVel * 5.0;
  u += influence * 0.12;
  v += influence * 0.15;

  // Self-sustaining: periodic injection to keep reaction-diffusion alive
  float pulse = sin(uTime*0.7 + uv.x*12.0) * sin(uTime*0.5 + uv.y*10.0);
  u += uDt * 0.003 * max(pulse, 0.0);
  v += uDt * 0.002 * max(-pulse, 0.0);

  u = clamp(u, 0.0, 1.0);
  v = clamp(v, 0.0, 1.0);

  fragColor = vec4(u, v, f);
}`;

// Agent B — Symbolic Dreamer (Claude)
const AGENT_B_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uPrev;
uniform sampler2D uTrail;
uniform float uTime;
uniform float uBPM;
uniform float uPhraseHash;
uniform vec2 uRes;
out vec4 fragColor;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float hash11(float p){ return fract(sin(p*127.1)*43758.5453); }

mat2 rot2(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

// Analytic glyph SDF — 4 glyph types based on token
float glyphSDF(vec2 p, float tok, float phase){
  p *= 1.0 + 0.3*sin(phase*6.2831);
  float id = floor(tok*4.0);
  float d = 1e9;
  if(id < 1.0){
    // circle ring
    d = abs(length(p) - 0.35) - 0.04;
  } else if(id < 2.0){
    // cross
    d = min(abs(p.x), abs(p.y)) - 0.05;
    d = max(d, length(p) - 0.4);
  } else if(id < 3.0){
    // triangle
    p = rot2(phase*3.14159) * p;
    float k = sqrt(3.0);
    p.x = abs(p.x) - 0.3;
    p.y += 0.3/k;
    if(p.x+k*p.y > 0.0) p = vec2(p.x-k*p.y, -k*p.x-p.y)/2.0;
    p.x -= clamp(p.x, -0.6, 0.0);
    d = -length(p)*sign(p.y) - 0.03;
  } else {
    // diamond
    p = rot2(0.7854) * p;
    d = max(abs(p.x), abs(p.y)) - 0.25;
  }
  return d;
}

void main(){
  vec2 px = 1.0 / uRes;
  vec4 prev = texture(uPrev, uv);
  float memory = prev.r;
  float energy = prev.g;
  vec2 meta = prev.ba; // hue, stitchBias

  float trail = texture(uTrail, uv).r;
  float phase = fract(uTime * uBPM / 60.0);

  // UV warp from trail + rhythm
  vec2 grad_trail = vec2(
    texture(uTrail, uv+vec2(px.x,0)).r - texture(uTrail, uv-vec2(px.x,0)).r,
    texture(uTrail, uv+vec2(0,px.y)).r - texture(uTrail, uv-vec2(0,px.y)).r
  );
  vec2 warped_uv = uv + 0.03 * rot2(phase*6.2831) * grad_trail;

  // Echo — temporal ghost
  float echo = texture(uPrev, warped_uv + 0.01*sin(vec2(3.0,5.0)*uTime)).r;

  // Glyph grid
  vec2 cellSize = vec2(24.0, 14.0);
  vec2 cell = floor(uv * cellSize);
  float tok = hash21(cell + uPhraseHash);
  vec2 cellUV = fract(uv * cellSize) * 2.0 - 1.0;

  float rune = glyphSDF(cellUV, tok, phase);
  float ink = smoothstep(0.06, -0.02, rune);

  // Dreamer logic
  memory = mix(memory, echo, 0.82) + 0.18*ink;
  float stitchBias = mix(meta.g, 1.0 - trail, 0.12);
  energy = clamp(0.90*energy + 0.25*abs(ink - echo) + 0.15*phase, 0.0, 1.0);
  float hue = fract(meta.r + 0.02*tok + 0.03*sin(6.2831*phase));

  // Certainty — dreamer is confident near glyphs and echoes
  float certainty = smoothstep(0.12, 0.50, abs(memory - echo) + 0.4*trail);

  memory = clamp(memory, 0.0, 1.0);

  fragColor = vec4(memory, energy, hue, stitchBias);
}`;

// Trail accumulator
const TRAIL_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uPrev;
uniform vec2 uMouse;
uniform float uMouseDown;
out vec4 fragColor;
void main(){
  float prev = texture(uPrev, uv).r;
  float dist = length(uv - uMouse);
  float brush = smoothstep(0.06, 0.0, dist) * (0.5 + 0.5*uMouseDown);
  float trail = prev * 0.985 + brush;
  fragColor = vec4(vec3(clamp(trail, 0.0, 1.0)), 1.0);
}`;

// Composite — fracture + merge + color
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uAgentA;
uniform sampler2D uAgentB;
uniform sampler2D uTrail;
uniform float uTime;
uniform vec2 uRes;
out vec4 fragColor;

float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

vec3 hsv2rgb(vec3 c){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);
}

void main(){
  vec4 a = texture(uAgentA, uv);
  vec4 b = texture(uAgentB, uv);
  float trail = texture(uTrail, uv).r;

  // Agent A output: pressure=a.r, curvature=a.g, flow=a.ba
  float pressureA = a.r;
  float curvatureA = a.g;
  vec2 flowA = a.ba;
  float energyA = clamp(0.5*length(flowA) + 0.4*abs(curvatureA - pressureA) + 0.1, 0.0, 1.0);
  // Agent A lives in cool tones (cyan → blue → teal)
  float hueA = fract(0.5 + 0.12*curvatureA - 0.08*pressureA + 0.01*uTime);

  // Agent B output: memory=b.r, energy=b.g, hue=b.b, stitchBias=b.a
  float memoryB = b.r;
  float energyB = b.g + 0.1;
  // Agent B lives in warm tones (magenta → orange → gold)
  float hueB = fract(0.85 + b.b * 0.15 + 0.015*uTime);
  float stitchBias = b.a;

  // Disagreement metric — amplified for visual drama
  float dFlow = length(flowA) * 0.8;
  float dPressure = abs(pressureA - memoryB);
  float dEnergy = abs(energyA - energyB);
  float dHue = 0.3; // Agents always have color tension (different hue ranges)
  float D = clamp(0.3*dPressure + 0.3*dFlow + 0.15*dEnergy + 0.25*dHue + trail*0.2, 0.0, 1.0);

  // Fracture via Voronoi
  float fracture = 0.0;
  float shardCount = 1.0 + 12.0 * pow(D, 1.7);
  vec2 cellSize = vec2(sqrt(shardCount) * 1.5);
  vec2 cell = floor(uv * cellSize);
  float minDist = 1.0;
  float minDist2 = 1.0;
  float owner = 0.0;
  for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++){
    vec2 neighbor = cell + vec2(i,j);
    vec2 point = neighbor + vec2(hash21(neighbor), hash21(neighbor+99.0));
    // Jitter by disagreement
    point += D * 0.3 * vec2(sin(uTime+neighbor.x*3.0), cos(uTime+neighbor.y*5.0));
    float d = length(uv * cellSize - point);
    if(d < minDist){
      minDist2 = minDist;
      minDist = d;
      owner = hash21(neighbor + 42.0);
    } else if(d < minDist2){
      minDist2 = d;
    }
  }
  float edge = smoothstep(0.04, 0.12, minDist2 - minDist);
  fracture = (1.0 - edge) * D;

  // Blend agents based on Voronoi owner + disagreement
  float blend = smoothstep(0.3, 0.7, owner + 0.2*(stitchBias - 0.5));
  blend = mix(0.5, blend, smoothstep(0.1, 0.5, D)); // Only separate when disagreeing

  // Color from each agent — vivid and contrasting
  vec3 colA = hsv2rgb(vec3(hueA, 0.7 + 0.25*energyA, 0.35 + 0.6*pressureA + 0.15*curvatureA));
  colA += 0.15 * hsv2rgb(vec3(hueA + 0.08, 1.0, energyA * energyA)); // energy bloom
  colA *= 1.2;

  vec3 colB = hsv2rgb(vec3(hueB, 0.65 + 0.3*energyB, 0.3 + 0.65*memoryB));
  colB += 0.12 * hsv2rgb(vec3(hueB - 0.05, 0.9, energyB * energyB));
  colB *= 1.15;

  vec3 col = mix(colA, colB, blend);

  // Fracture fissure — dark void with hot edge glow
  vec3 fissureGlow = (colA + colB) * 1.5 + vec3(0.3, 0.1, 0.4);
  float fissureEdge = smoothstep(0.0, 0.02, fracture) * (1.0 - smoothstep(0.02, 0.1, fracture));
  col = mix(col, vec3(0.005, 0.0, 0.01), smoothstep(0.01, 0.06, fracture));
  col += fissureGlow * fissureEdge * 0.8;

  // Trail glow — where the user has drawn
  col += vec3(0.15, 0.1, 0.25) * trail * 2.5;
  col += vec3(0.05, 0.2, 0.15) * trail * trail * 3.0;

  // Vignette
  vec2 vc = uv * 2.0 - 1.0;
  col *= 1.0 - 0.3*dot(vc,vc);

  // Tone mapping
  col = col / (col + 0.8);
  col = pow(col, vec3(0.9));

  fragColor = vec4(col, 1.0);
}`;

// Seed shader — initialize FBOs with noise
const SEED_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform float uSeed;
uniform float uMode; // 0=agentA, 1=agentB
out vec4 fragColor;
float hash21(vec2 p){ return fract(sin(dot(p+uSeed,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),
             mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.1; a*=0.5; }
  return v;
}
void main(){
  if(uMode < 0.5){
    // Agent A: pressure, curvature, flow.xy
    float u = fbm(uv*6.0) * 0.8 + 0.1;
    float v = fbm(uv*8.0+3.0) * 0.6;
    // Seed spots for Gray-Scott
    float spot = smoothstep(0.15, 0.0, length(uv - vec2(0.5 + 0.2*sin(uSeed), 0.5 + 0.2*cos(uSeed))));
    spot += smoothstep(0.1, 0.0, length(uv - vec2(0.3, 0.7)));
    spot += smoothstep(0.1, 0.0, length(uv - vec2(0.7, 0.3)));
    u = mix(u, 0.5, spot);
    v = mix(v, 0.25, spot);
    vec2 f = vec2(fbm(uv*4.0+7.0)-0.5, fbm(uv*4.0+13.0)-0.5)*0.3;
    fragColor = vec4(u, v, f);
  } else {
    // Agent B: memory, energy, hue, stitchBias
    float mem = fbm(uv*5.0+uSeed) * 0.5;
    float energy = fbm(uv*7.0+uSeed+5.0) * 0.3;
    float hue = fbm(uv*3.0+uSeed+10.0);
    float stitch = 0.5;
    fragColor = vec4(mem, energy, hue, stitch);
  }
}`;

// ─── Programs ───────────────────────────────────────────────
let progA, progB, progTrail, progComposite, progSeed;
let fboA, fboB, fboTrail;

function initPrograms() {
  progA = createProgram(VERT, AGENT_A_FRAG);
  progB = createProgram(VERT, AGENT_B_FRAG);
  progTrail = createProgram(VERT, TRAIL_FRAG);
  progComposite = createProgram(VERT, COMPOSITE_FRAG);
  progSeed = createProgram(VERT, SEED_FRAG);
}

function initFBOs() {
  fboA = createDoubleFBO(simW, simH);
  fboB = createDoubleFBO(simW, simH);
  fboTrail = createDoubleFBO(simW, simH);
  // Seed agent FBOs with noise
  const seed = Math.random() * 100;
  setUniforms(progSeed, { uSeed: seed, uMode: 0.0 });
  blit(fboA.read); blit(fboA.write);
  setUniforms(progSeed, { uSeed: seed + 50, uMode: 1.0 });
  blit(fboB.read); blit(fboB.write);
  // Clear trail buffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboTrail.read.fb);
  gl.viewport(0, 0, fboTrail.read.w, fboTrail.read.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboTrail.write.fb);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

// ─── Uniform setters ────────────────────────────────────────
function setUniforms(prog, uniforms) {
  gl.useProgram(prog);
  let texUnit = 0;
  for (const [name, val] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) continue;
    if (val && val.tex !== undefined) {
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, val.tex);
      gl.uniform1i(loc, texUnit);
      texUnit++;
    } else if (Array.isArray(val)) {
      if (val.length === 2) gl.uniform2f(loc, val[0], val[1]);
      else if (val.length === 3) gl.uniform3f(loc, val[0], val[1], val[2]);
    } else {
      gl.uniform1f(loc, val);
    }
  }
}

// ─── Simulation step ────────────────────────────────────────
function step() {
  // Trail
  setUniforms(progTrail, {
    uPrev: fboTrail.read,
    uMouse: [mouse.x, mouse.y],
    uMouseDown: mouse.down ? 1.0 : 0.0,
  });
  blit(fboTrail.write);
  fboTrail.swap();

  // Agent A — physicist
  setUniforms(progA, {
    uPrev: fboA.read,
    uTrail: fboTrail.read,
    uMouse: [mouse.x, mouse.y],
    uMouseVel: [mouse.vx, mouse.vy],
    uTime: time,
    uDt: dt,
    uRes: [simW, simH],
  });
  blit(fboA.write);
  fboA.swap();

  // Agent B — dreamer
  setUniforms(progB, {
    uPrev: fboB.read,
    uTrail: fboTrail.read,
    uTime: time,
    uBPM: bpm,
    uPhraseHash: (phraseHash % 10000) / 10000,
    uRes: [simW, simH],
  });
  blit(fboB.write);
  fboB.swap();
}

// ─── Render ─────────────────────────────────────────────────
function render() {
  setUniforms(progComposite, {
    uAgentA: fboA.read,
    uAgentB: fboB.read,
    uTrail: fboTrail.read,
    uTime: time,
    uRes: [canvas.width, canvas.height],
  });
  blit(null); // to screen
}

// ─── UI ─────────────────────────────────────────────────────
const mA = document.getElementById("mA");
const mB = document.getElementById("mB");
function updateMeters() {
  const aPct = Math.round(Math.max(20, Math.min(80, 50 - globalDisagreement * 30)));
  const bPct = 100 - aPct;
  mA.style.width = aPct + "%";
  mB.style.width = bPct + "%";
}

// ─── Main loop ──────────────────────────────────────────────
let lastTime = 0;
function loop(now) {
  requestAnimationFrame(loop);
  now *= 0.001;
  dt = Math.min(now - lastTime, 0.033);
  lastTime = now;
  time = now;
  tapPhase = (now * bpm / 60) % 1;

  step();
  render();

  // Sample disagreement from agent outputs every 10 frames
  if (frame % 10 === 0) {
    const px = new Float32Array(4);
    const px2 = new Float32Array(4);
    // Read center pixels from each agent
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.read.fb);
    gl.readPixels(simW >> 1, simH >> 1, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.read.fb);
    gl.readPixels(simW >> 1, simH >> 1, 1, 1, gl.RGBA, gl.FLOAT, px2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const d = Math.abs(px[0] - px2[0]) * 0.4 + Math.hypot(px[2], px[3]) * 0.3 + Math.abs(px[1] - px2[1]) * 0.3;
    globalDisagreement = globalDisagreement * 0.85 + Math.min(d, 1.0) * 0.15;
  }
  updateMeters();

  // Decay mouse velocity
  mouse.vx *= 0.85;
  mouse.vy *= 0.85;
  frame++;
}

// ─── Export ─────────────────────────────────────────────────
window.exportFrame = function() {
  const link = document.createElement("a");
  link.download = "consensus-collapse-" + Date.now() + ".png";
  link.href = canvas.toDataURL("image/png");
  link.click();
};

// ─── Reset ──────────────────────────────────────────────────
window.resetSim = function() {
  initFBOs();
  phraseHash = Math.floor(Math.random() * 100000);
};

// ─── Init ───────────────────────────────────────────────────
initPrograms();
resize();
requestAnimationFrame(loop);
