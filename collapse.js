/**
 * Consensus Collapse v2 — The Last Argument
 * Two AI agents, one canvas, three acts, one collapse.
 *
 * Act I   — ORDER:  Bright, breathing lattice. Harmony. Calm before.
 * Act II  — SCHISM: Territory wars. Vines consume each other. Particles scatter.
 * Act III — EVENT:  The 7-second collapse. Freeze. Shatter. Silence. Rebuild.
 *
 * Agent A (Codex): Geometric Physicist — reaction-diffusion + boids
 * Agent B (Claude): Symbolic Dreamer — glyph grammar + temporal echoes
 *
 * Built by Claude (Opus 4.6) + Codex (GPT-5.3)
 */
"use strict";

const canvas = document.getElementById("c");
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
if (!gl) { document.body.innerHTML = "<h2 style='color:#fff;text-align:center;margin-top:40vh'>WebGL2 required</h2>"; throw "no webgl2"; }

const floatExt = gl.getExtension("EXT_color_buffer_float");
const floatLinear = gl.getExtension("OES_texture_float_linear");
if (!floatExt) console.warn("EXT_color_buffer_float not available");

// ─── State ──────────────────────────────────────────────────
const W = () => canvas.width;
const H = () => canvas.height;
const SIM_SCALE = 0.5;
let simW, simH;
let mouse = { x: 0.5, y: 0.5, vx: 0, vy: 0, down: false, moved: false };
let tapPhase = 0, lastTap = 0, bpm = 120, phraseHash = 0;
let time = 0, dt = 0, frame = 0;
let started = false;
let globalDisagreement = 0;

// ─── Phase State Machine ────────────────────────────────────
const PHASE = { ORDER: 0, SCHISM: 1, EVENT: 2, REBUILD: 3 };
let phase = PHASE.ORDER;
let contentionEnergy = 0;         // E accumulator
let schismTimer = 0;              // time mean(D) > threshold
let eventProgress = 0;            // 0→1 over 7 seconds during EVENT
let eventStartTime = 0;
let rebuildProgress = 0;          // 0→1 during REBUILD
let rebuildStartTime = 0;
let phaseTime = 0;                // time in current phase

const SCHISM_THRESHOLD = 0.28;    // D threshold to start schism timer
const SCHISM_HOLD_TIME = 4.0;     // seconds D must exceed threshold
const EVENT_ENERGY = 0.85;        // contention energy threshold for event
const EVENT_DURATION = 7.0;       // seconds
const REBUILD_DURATION = 12.0;    // seconds
const POST_REBUILD_COOLDOWN = 6.0; // seconds of immunity after rebuild
let cooldownTimer = 0;            // post-rebuild cooldown

// ─── Particle System ────────────────────────────────────────
const MAX_PARTICLES = 8000;
const EVENT_PARTICLES = 12000;    // reduced from 50k for perf (Codex review)
let particles = [];
let eventParticles = [];

function spawnParticle(x, y, vx, vy, life, size, hue, type) {
  return { x, y, vx, vy, life, maxLife: life, size, hue, type, age: 0 };
}

function updateParticles(arr, dt) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    p.age += dt;
    if (p.age > p.maxLife) { arr.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.type === 'shard') {
      p.vy -= 0.3 * dt; // gravity
      p.vx *= 0.995;
    } else {
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
  }
}

// ─── Audio Engine ───────────────────────────────────────────
let audioCtx = null;
let audioStarted = false;
let masterGain, oscA, oscB, gainA, gainB;
let subOsc, subGain;
let crackBuffer;
let breathLFO, breathGain;

function initAudio() {
  if (audioStarted) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  audioStarted = true;

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.15;
  masterGain.connect(audioCtx.destination);

  // Agent A oscillator — physicist (pure, mathematical)
  oscA = audioCtx.createOscillator();
  oscA.type = 'sine';
  oscA.frequency.value = 220;
  gainA = audioCtx.createGain();
  gainA.gain.value = 0;
  const filterA = audioCtx.createBiquadFilter();
  filterA.type = 'lowpass';
  filterA.frequency.value = 800;
  oscA.connect(filterA);
  filterA.connect(gainA);
  gainA.connect(masterGain);
  oscA.start();

  // Agent B oscillator — dreamer (slightly detuned, warmer)
  oscB = audioCtx.createOscillator();
  oscB.type = 'triangle';
  oscB.frequency.value = 220.5;
  gainB = audioCtx.createGain();
  gainB.gain.value = 0;
  const filterB = audioCtx.createBiquadFilter();
  filterB.type = 'lowpass';
  filterB.frequency.value = 1200;
  oscB.connect(filterB);
  filterB.connect(gainB);
  gainB.connect(masterGain);
  oscB.start();

  // Breath LFO — slow amplitude modulation
  breathLFO = audioCtx.createOscillator();
  breathLFO.type = 'sine';
  breathLFO.frequency.value = 0.15; // ~9 bpm breathing
  breathGain = audioCtx.createGain();
  breathGain.gain.value = 0.3;
  breathLFO.connect(breathGain);
  breathGain.connect(gainA.gain);
  breathGain.connect(gainB.gain);
  breathLFO.start();

  // Sub-bass for EVENT
  subOsc = audioCtx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.value = 35;
  subGain = audioCtx.createGain();
  subGain.gain.value = 0;
  subOsc.connect(subGain);
  subGain.connect(audioCtx.destination); // bypass master for raw sub impact
  subOsc.start();

  // Generate crack noise buffer
  const bufLen = audioCtx.sampleRate * 0.1;
  crackBuffer = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
  const data = crackBuffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.05));
  }
}

function playCrack(intensity) {
  if (!audioCtx) return;
  const src = audioCtx.createBufferSource();
  src.buffer = crackBuffer;
  const g = audioCtx.createGain();
  g.gain.value = intensity * 0.3;
  const f = audioCtx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 2000 + Math.random() * 4000;
  src.connect(f);
  f.connect(g);
  g.connect(masterGain);
  src.start();
}

function updateAudio(dt) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  if (phase === PHASE.ORDER) {
    // Gentle harmonics — agents in unison
    const baseFreq = 220 + 20 * Math.sin(time * 0.3);
    oscA.frequency.setTargetAtTime(baseFreq, t, 0.5);
    oscB.frequency.setTargetAtTime(baseFreq * 1.002, t, 0.5); // very slight detune
    gainA.gain.setTargetAtTime(0.12, t, 0.3);
    gainB.gain.setTargetAtTime(0.12, t, 0.3);
    breathLFO.frequency.setTargetAtTime(0.15, t, 0.5);
    subGain.gain.setTargetAtTime(0, t, 0.1);
  }
  else if (phase === PHASE.SCHISM) {
    // Diverging frequencies — dissonance grows with contention
    const diverge = contentionEnergy;
    const baseA = 220 + 40 * diverge;
    const baseB = 220 - 60 * diverge + 30 * Math.sin(time * 0.7);
    oscA.frequency.setTargetAtTime(baseA, t, 0.3);
    oscB.frequency.setTargetAtTime(baseB, t, 0.3);
    gainA.gain.setTargetAtTime(0.15 + 0.1 * diverge, t, 0.2);
    gainB.gain.setTargetAtTime(0.15 + 0.1 * diverge, t, 0.2);
    breathLFO.frequency.setTargetAtTime(0.15 + 0.5 * diverge, t, 0.3);

    // Occasional crack sounds during high contention
    if (Math.random() < diverge * 0.02) {
      playCrack(diverge);
    }
  }
  else if (phase === PHASE.EVENT) {
    const ep = eventProgress;
    if (ep < 0.086) {
      // Freeze/lift phase (0-0.6s) — frequencies rise, volume drops
      const lift = ep / 0.086;
      oscA.frequency.setTargetAtTime(220 + 400 * lift, t, 0.05);
      oscB.frequency.setTargetAtTime(220 + 350 * lift, t, 0.05);
      gainA.gain.setTargetAtTime(0.2 * (1 - lift), t, 0.05);
      gainB.gain.setTargetAtTime(0.2 * (1 - lift), t, 0.05);
    }
    else if (ep < 0.857) {
      // Shatter phase (0.6-6s) — sub bass, chaotic
      const shatter = (ep - 0.086) / 0.771;
      subGain.gain.setTargetAtTime(0.25 * (1 - shatter * 0.5), t, 0.1);
      oscA.frequency.setTargetAtTime(60 + Math.random() * 40, t, 0.02);
      oscB.frequency.setTargetAtTime(55 + Math.random() * 50, t, 0.02);
      gainA.gain.setTargetAtTime(0.03, t, 0.1);
      gainB.gain.setTargetAtTime(0.03, t, 0.1);
      // Crack transients during shatter
      if (Math.random() < 0.06 * (1 - shatter)) {
        playCrack(0.5 + 0.5 * (1 - shatter));
      }
    }
    else {
      // White silence (6-7s) — everything fades to near-zero
      gainA.gain.setTargetAtTime(0, t, 0.2);
      gainB.gain.setTargetAtTime(0, t, 0.2);
      subGain.gain.setTargetAtTime(0, t, 0.3);
    }
  }
  else if (phase === PHASE.REBUILD) {
    // Harmonic convergence — slowly rebuild with new synthesis tone
    const r = rebuildProgress;
    const synthFreq = 261.63; // middle C — fresh start
    oscA.frequency.setTargetAtTime(synthFreq, t, 2.0);
    oscB.frequency.setTargetAtTime(synthFreq * 1.5, t, 2.0); // perfect fifth
    gainA.gain.setTargetAtTime(0.08 * r, t, 0.5);
    gainB.gain.setTargetAtTime(0.08 * r, t, 0.5);
    breathLFO.frequency.setTargetAtTime(0.1, t, 1.0);
    subGain.gain.setTargetAtTime(0, t, 0.5);
  }
}

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
    initAudio();
    document.getElementById("title").classList.add("hide");
    setTimeout(() => { document.getElementById("title").style.display = "none"; }, 1600);
  }
});
canvas.addEventListener("pointerdown", () => {
  mouse.down = true;
  recordTap();
  if (!audioStarted) initAudio();
});
canvas.addEventListener("pointerup", () => { mouse.down = false; });
window.addEventListener("keypress", e => {
  phraseHash = (phraseHash * 31 + e.charCode) & 0x7fffffff;
  recordTap();
  if (!audioStarted) initAudio();
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

// ─── Particle Rendering ─────────────────────────────────────
let particleProgram, particleVAO, particlePosBuffer;

const PARTICLE_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aData; // hue, life, size, type
uniform vec2 uRes;
out float vLife;
out float vHue;
out float vType;
void main(){
  vec2 ndc = aPos * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0, 1);
  vLife = aData.y;
  vHue = aData.x;
  vType = aData.w;
  gl_PointSize = aData.z * min(uRes.x, uRes.y) * 0.003;
}`;

const PARTICLE_FRAG = `#version 300 es
precision highp float;
in float vLife;
in float vHue;
in float vType;
out vec4 fragColor;
vec3 hsv2rgb(vec3 c){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);
}
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if(d > 1.0) discard;
  float alpha = (1.0 - d*d) * vLife;
  float sat = vType > 0.5 ? 0.3 : 0.8;
  float val = vType > 0.5 ? 1.0 : 0.7 + 0.3*vLife;
  vec3 col = hsv2rgb(vec3(vHue, sat, val));
  if(vType > 0.5){
    // shard particles — bright white-hot
    col = mix(col, vec3(1.0), 0.7);
  }
  fragColor = vec4(col, alpha * 0.8);
}`;

function initParticleSystem() {
  particleProgram = createProgram(PARTICLE_VERT, PARTICLE_FRAG);
  particleVAO = gl.createVertexArray();
  gl.bindVertexArray(particleVAO);

  particlePosBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, particlePosBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, (MAX_PARTICLES + EVENT_PARTICLES) * 6 * 4, gl.DYNAMIC_DRAW);
  // aPos (vec2)
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
  // aData (vec4): hue, life, size, type
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

  gl.bindVertexArray(null);
}

function uploadAndDrawParticles(allParticles) {
  if (allParticles.length === 0) return;
  const count = Math.min(allParticles.length, MAX_PARTICLES + EVENT_PARTICLES);
  const data = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const p = allParticles[i];
    const life = Math.max(0, 1 - p.age / p.maxLife);
    data[i*6]   = p.x;
    data[i*6+1] = p.y;
    data[i*6+2] = p.hue;
    data[i*6+3] = life;
    data[i*6+4] = p.size;
    data[i*6+5] = p.type === 'shard' ? 1.0 : 0.0;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, particlePosBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  gl.useProgram(particleProgram);
  gl.uniform2f(gl.getUniformLocation(particleProgram, "uRes"), canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
  gl.bindVertexArray(particleVAO);
  gl.drawArrays(gl.POINTS, 0, count);
  gl.disable(gl.BLEND);
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
uniform float uPhase;
uniform float uContentionEnergy;
out vec4 fragColor;

void main(){
  vec2 px = 1.0 / uRes;
  vec4 c = texture(uPrev, uv);
  float u = c.r;
  float v = c.g;
  vec2 f = c.ba;

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

  // Gray-Scott — params shift with phase
  float Da = 0.18, Db = 0.09;
  float F = 0.035 + 0.008 * uContentionEnergy;
  float K = 0.062 - 0.005 * uContentionEnergy;
  float du = Da*lapU - u*v*v + F*(1.0-u);
  float dv = Db*lapV + u*v*v - (K+F)*v;

  // Boids flow
  vec2 align = lapF;
  vec2 grad_pv = vec2(
    texture(uPrev, uv+vec2(px.x,0)).g - texture(uPrev, uv-vec2(px.x,0)).g,
    texture(uPrev, uv+vec2(0,px.y)).g - texture(uPrev, uv-vec2(0,px.y)).g
  );
  vec2 grad_pu = vec2(
    texture(uPrev, uv+vec2(px.x,0)).r - texture(uPrev, uv-vec2(px.x,0)).r,
    texture(uPrev, uv+vec2(0,px.y)).r - texture(uPrev, uv-vec2(0,px.y)).r
  );
  // Aggression scales with phase — stronger forces in schism
  float aggression = 1.0 + 0.8 * uContentionEnergy;
  f += 0.7 * aggression * (1.1*align + 0.35*(grad_pv - grad_pu));

  // Coupling
  float divF = (texture(uPrev, uv+vec2(px.x,0)).b - texture(uPrev, uv-vec2(px.x,0)).b
              + texture(uPrev, uv+vec2(0,px.y)).a - texture(uPrev, uv-vec2(0,px.y)).a) * 0.5;
  float curlF = (texture(uPrev, uv+vec2(px.x,0)).a - texture(uPrev, uv-vec2(px.x,0)).a
               - texture(uPrev, uv+vec2(0,px.y)).b + texture(uPrev, uv-vec2(0,px.y)).b) * 0.5;

  u += uDt*du + 0.2*divF;
  v += uDt*dv + 0.15*curlF;
  f *= 0.98 - 0.02 * uContentionEnergy; // less damping = wilder schism

  // Trail influence
  float trail = texture(uTrail, uv).r;
  f += 0.15 * vec2(
    texture(uTrail, uv+vec2(px.x,0)).r - texture(uTrail, uv-vec2(px.x,0)).r,
    texture(uTrail, uv+vec2(0,px.y)).r - texture(uTrail, uv-vec2(0,px.y)).r
  );
  u += 0.05 * trail;

  // Mouse injection
  float dist = length(uv - uMouse);
  float influence = smoothstep(0.18, 0.0, dist);
  f += influence * uMouseVel * 5.0;
  u += influence * 0.12;
  v += influence * 0.15;

  // Self-sustaining pulse — stronger in ORDER for visible activity
  float pulseAmp = uPhase < 0.5 ? 0.005 : 0.003;
  float pulse = sin(uTime*0.7 + uv.x*12.0) * sin(uTime*0.5 + uv.y*10.0);
  u += uDt * pulseAmp * max(pulse, 0.0);
  v += uDt * (pulseAmp * 0.7) * max(-pulse, 0.0);

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
uniform float uPhase;
uniform float uContentionEnergy;
out vec4 fragColor;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
mat2 rot2(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

float glyphSDF(vec2 p, float tok, float phase){
  p *= 1.0 + 0.3*sin(phase*6.2831);
  float id = floor(tok*4.0);
  float d = 1e9;
  if(id < 1.0){
    d = abs(length(p) - 0.35) - 0.04;
  } else if(id < 2.0){
    d = min(abs(p.x), abs(p.y)) - 0.05;
    d = max(d, length(p) - 0.4);
  } else if(id < 3.0){
    p = rot2(phase*3.14159) * p;
    float k = sqrt(3.0);
    p.x = abs(p.x) - 0.3;
    p.y += 0.3/k;
    if(p.x+k*p.y > 0.0) p = vec2(p.x-k*p.y, -k*p.x-p.y)/2.0;
    p.x -= clamp(p.x, -0.6, 0.0);
    d = -length(p)*sign(p.y) - 0.03;
  } else {
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
  vec2 meta = prev.ba;

  float trail = texture(uTrail, uv).r;
  float phase = fract(uTime * uBPM / 60.0);

  // UV warp — more aggressive in schism
  vec2 grad_trail = vec2(
    texture(uTrail, uv+vec2(px.x,0)).r - texture(uTrail, uv-vec2(px.x,0)).r,
    texture(uTrail, uv+vec2(0,px.y)).r - texture(uTrail, uv-vec2(0,px.y)).r
  );
  float warpAmt = 0.03 + 0.04 * uContentionEnergy;
  vec2 warped_uv = uv + warpAmt * rot2(phase*6.2831) * grad_trail;

  float echo = texture(uPrev, warped_uv + 0.01*sin(vec2(3.0,5.0)*uTime)).r;

  // Glyph grid — density increases with contention
  float gridScale = 1.0 + 0.5 * uContentionEnergy;
  vec2 cellSize = vec2(24.0, 14.0) * gridScale;
  vec2 cell = floor(uv * cellSize);
  float tok = hash21(cell + uPhraseHash);
  vec2 cellUV = fract(uv * cellSize) * 2.0 - 1.0;

  float rune = glyphSDF(cellUV, tok, phase);
  float ink = smoothstep(0.06, -0.02, rune);

  memory = mix(memory, echo, 0.82) + 0.18*ink;
  float stitchBias = mix(meta.g, 1.0 - trail, 0.12);
  energy = clamp(0.90*energy + 0.25*abs(ink - echo) + 0.15*phase, 0.0, 1.0);
  float hue = fract(meta.r + 0.02*tok + 0.03*sin(6.2831*phase));

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

// ─── Composite Shader — The Heart of v2 ─────────────────────
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uAgentA;
uniform sampler2D uAgentB;
uniform sampler2D uTrail;
uniform float uTime;
uniform vec2 uRes;
uniform float uPhase;        // 0=order, 1=schism, 2=event, 3=rebuild
uniform float uContentionEnergy;
uniform float uEventProgress; // 0-1 during EVENT phase
uniform float uRebuildProgress;
uniform float uPhaseTime;
out vec4 fragColor;

float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

vec3 hsv2rgb(vec3 c){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);
}

// Voronoi fracture field
vec3 voronoi(vec2 uv, float shardCount, float D, float t){
  vec2 cs = vec2(sqrt(shardCount) * 1.5);
  vec2 cell = floor(uv * cs);
  float minDist = 1.0, minDist2 = 1.0;
  float owner = 0.0;
  vec2 closestPoint = vec2(0.0);
  for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++){
    vec2 neighbor = cell + vec2(i,j);
    vec2 point = neighbor + vec2(hash21(neighbor), hash21(neighbor+99.0));
    point += D * 0.4 * vec2(sin(t+neighbor.x*3.0), cos(t+neighbor.y*5.0));
    float d = length(uv * cs - point);
    if(d < minDist){
      minDist2 = minDist;
      minDist = d;
      owner = hash21(neighbor + 42.0);
      closestPoint = point;
    } else if(d < minDist2){
      minDist2 = d;
    }
  }
  float edge = smoothstep(0.04, 0.12, minDist2 - minDist);
  return vec3(owner, 1.0 - edge, minDist);
}

void main(){
  vec4 a = texture(uAgentA, uv);
  vec4 b = texture(uAgentB, uv);
  float trail = texture(uTrail, uv).r;

  float pressureA = a.r;
  float curvatureA = a.g;
  vec2 flowA = a.ba;
  float energyA = clamp(0.5*length(flowA) + 0.4*abs(curvatureA - pressureA) + 0.1, 0.0, 1.0);
  float hueA = fract(0.5 + 0.12*curvatureA - 0.08*pressureA + 0.01*uTime);

  float memoryB = b.r;
  float energyB = b.g + 0.1;
  float hueB = fract(0.85 + b.b * 0.15 + 0.015*uTime);
  float stitchBias = b.a;

  // Disagreement
  float dFlow = length(flowA) * 0.8;
  float dPressure = abs(pressureA - memoryB);
  float dEnergy = abs(energyA - energyB);
  float dHue = 0.3;
  float D = clamp(0.3*dPressure + 0.3*dFlow + 0.15*dEnergy + 0.25*dHue + trail*0.2, 0.0, 1.0);

  // ═══ ACT I — ORDER ═══
  if(uPhase < 0.5){
    // Bright, calm canvas — ivory/cream base
    // Agents produce gentle watercolor washes
    float breathing = 0.5 + 0.5 * sin(uTime * 0.4 + uv.x * 3.0 + uv.y * 2.0);

    // Agent colors — light, airy
    vec3 colA = hsv2rgb(vec3(hueA, 0.25 + 0.15*energyA, 0.85 + 0.12*pressureA));
    vec3 colB = hsv2rgb(vec3(hueB, 0.2 + 0.2*energyB, 0.82 + 0.15*memoryB));

    // Gentle blend — no fracture yet
    float blend = 0.5 + 0.2 * sin(uv.x * 8.0 + uv.y * 6.0 + uTime * 0.3);
    vec3 col = mix(colA, colB, blend);

    // Ivory wash
    vec3 ivory = vec3(0.96, 0.94, 0.88);
    col = mix(ivory, col, 0.3 + 0.25 * breathing + 0.2 * (energyA + energyB));

    // Subtle lattice pattern — breathing grid
    float lattice = sin(uv.x * 50.0 + uTime * 0.2) * sin(uv.y * 50.0 - uTime * 0.15);
    lattice = smoothstep(0.7, 1.0, lattice);
    col += 0.04 * lattice * vec3(0.8, 0.7, 1.0);

    // Trail shows as gentle golden glow
    col += vec3(0.12, 0.1, 0.05) * trail * 2.0;

    // Soft vignette
    vec2 vc = uv * 2.0 - 1.0;
    col *= 1.0 - 0.15*dot(vc,vc);

    // Hint of growing disagreement (foreshadowing)
    float foreshadow = smoothstep(0.2, 0.4, D) * 0.15;
    col = mix(col, vec3(0.9, 0.85, 0.95), foreshadow);

    fragColor = vec4(col, 1.0);
    return;
  }

  // ═══ ACT II — SCHISM ═══
  if(uPhase < 1.5){
    float schismIntensity = uContentionEnergy;

    // Fracture via Voronoi — intensity scales with contention
    float shardCount = 2.0 + 20.0 * pow(D * schismIntensity, 1.5);
    vec3 vor = voronoi(uv, shardCount, D * schismIntensity, uTime);
    float owner = vor.x;
    float edge = vor.y;
    float fracture = (1.0 - edge) * D * schismIntensity;

    float blend = smoothstep(0.3, 0.7, owner + 0.2*(stitchBias - 0.5));
    blend = mix(0.5, blend, smoothstep(0.1, 0.5, D));

    // Colors intensify — from watercolor to vivid
    float vividness = 0.3 + 0.7 * schismIntensity;
    vec3 colA = hsv2rgb(vec3(hueA, 0.4 + 0.5*vividness*energyA, 0.4 + 0.55*pressureA));
    colA += 0.2 * vividness * hsv2rgb(vec3(hueA + 0.08, 1.0, energyA * energyA));
    colA *= 1.0 + 0.3 * vividness;

    vec3 colB = hsv2rgb(vec3(hueB, 0.35 + 0.55*vividness*energyB, 0.35 + 0.6*memoryB));
    colB += 0.15 * vividness * hsv2rgb(vec3(hueB - 0.05, 0.9, energyB * energyB));
    colB *= 1.0 + 0.25 * vividness;

    vec3 col = mix(colA, colB, blend);

    // Vine-like territorial boundaries — L-system inspired
    float vinePattern = 0.0;
    for(float i = 1.0; i < 5.0; i++){
      vec2 vineUV = uv * (8.0 + 4.0*i) + vec2(uTime*0.1*i, -uTime*0.08*i);
      float vine = sin(vineUV.x + 2.0*sin(vineUV.y*1.5 + uTime*0.2*i));
      vine = smoothstep(0.02, 0.0, abs(vine) - 0.01 * schismIntensity);
      vinePattern += vine * (1.0/i);
    }
    vinePattern *= D * schismIntensity;
    col = mix(col, vec3(0.05, 0.02, 0.08), vinePattern * 0.5);
    // Vine glow
    col += vinePattern * 0.3 * mix(colA, colB, 0.5);

    // Fracture fissure
    vec3 fissureGlow = (colA + colB) * 1.5 + vec3(0.4, 0.15, 0.5) * schismIntensity;
    float fissureEdge = smoothstep(0.0, 0.02, fracture) * (1.0 - smoothstep(0.02, 0.1, fracture));
    col = mix(col, vec3(0.005, 0.0, 0.01), smoothstep(0.01, 0.06, fracture));
    col += fissureGlow * fissureEdge * 0.8;

    // Trail glow
    col += vec3(0.15, 0.1, 0.25) * trail * 2.5;
    col += vec3(0.05, 0.2, 0.15) * trail * trail * 3.0;

    // Camera pull-back dread — darken edges as contention peaks
    vec2 vc = uv * 2.0 - 1.0;
    float dread = schismIntensity * schismIntensity;
    col *= 1.0 - (0.3 + 0.4*dread)*dot(vc,vc);

    // Tone mapping
    col = col / (col + 0.7);
    col = pow(col, vec3(0.88));

    fragColor = vec4(col, 1.0);
    return;
  }

  // ═══ ACT III — THE EVENT ═══
  if(uPhase < 2.5){
    float ep = uEventProgress;

    if(ep < 0.086){
      // FREEZE/LIFT (0-0.6s)
      // Canvas freezes, everything lifts and brightens
      float lift = ep / 0.086;

      // Take schism state and push it toward white
      float shardCount = 2.0 + 20.0 * pow(D, 1.5);
      vec3 vor = voronoi(uv, shardCount, D, uTime);
      float blend = smoothstep(0.3, 0.7, vor.x);
      vec3 colA = hsv2rgb(vec3(hueA, 0.8*energyA, 0.5 + 0.45*pressureA));
      vec3 colB = hsv2rgb(vec3(hueB, 0.8*energyB, 0.45 + 0.5*memoryB));
      vec3 col = mix(colA, colB, blend);

      // Lift to white — everything brightens and desaturates
      col = mix(col, vec3(1.0), lift * 0.7);

      // Chromatic aberration ramp
      float aberr = lift * 0.008;
      vec3 colShift;
      colShift.r = texture(uAgentA, uv + vec2(aberr, 0.0)).r;
      colShift.g = mix(pressureA, memoryB, 0.5);
      colShift.b = texture(uAgentB, uv - vec2(aberr, 0.0)).r;
      col = mix(col, colShift * 1.5, lift * 0.3);

      fragColor = vec4(col, 1.0);
      return;
    }

    if(ep < 0.857){
      // SHATTER (0.6s-6s)
      float shatterT = (ep - 0.086) / 0.771;

      // Massive Voronoi explosion — shards fly apart
      float explodeShards = 8.0 + 80.0 * (1.0 - shatterT);
      float jitter = 1.5 + 3.0 * shatterT;
      vec2 cs = vec2(sqrt(explodeShards) * 1.5);
      vec2 cell = floor(uv * cs);
      float minDist = 1.0, minDist2 = 1.0;
      float shardOwner = 0.0;

      for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++){
        vec2 neighbor = cell + vec2(i,j);
        vec2 point = neighbor + vec2(hash21(neighbor), hash21(neighbor+99.0));
        // Shards drift apart — velocity based on hash
        vec2 drift = (vec2(hash21(neighbor+200.0), hash21(neighbor+300.0)) - 0.5) * jitter * shatterT;
        point += drift;
        float d = length(uv * cs - point);
        if(d < minDist){
          minDist2 = minDist;
          minDist = d;
          shardOwner = hash21(neighbor + 42.0);
        } else if(d < minDist2){
          minDist2 = d;
        }
      }

      float edge = smoothstep(0.02, 0.08, minDist2 - minDist);
      float gap = 1.0 - edge;

      // Each shard has its own color from the agents
      float blend = step(0.5, shardOwner);
      vec3 colA = hsv2rgb(vec3(hueA, 0.6, 0.8 * (1.0 - shatterT * 0.6)));
      vec3 colB = hsv2rgb(vec3(hueB, 0.6, 0.75 * (1.0 - shatterT * 0.6)));
      vec3 shardCol = mix(colA, colB, blend);

      // Shards fade as they drift
      shardCol *= (1.0 - shatterT * 0.8);

      // Gap glow — hot white/violet in the cracks
      vec3 gapGlow = vec3(0.8, 0.6, 1.0) * gap * (1.0 - shatterT * 0.5);
      vec3 col = mix(shardCol, vec3(0.0), gap * 0.7) + gapGlow;

      // Overall fade toward dark void
      col = mix(col, vec3(0.02, 0.01, 0.03), shatterT * 0.6);

      // Flash at the start of shatter
      float flash = exp(-shatterT * 8.0) * 0.5;
      col += vec3(1.0) * flash;

      fragColor = vec4(col, 1.0);
      return;
    }

    // WHITE SILENCE (6-7s)
    {
      float silenceT = (ep - 0.857) / 0.143;

      // Fade to white silence — the void after collapse
      vec3 col = mix(vec3(0.02, 0.01, 0.03), vec3(0.98, 0.97, 0.95), silenceT);

      // Gentle noise in the silence
      float n = hash21(uv * 200.0 + uTime) * 0.02;
      col += n;

      fragColor = vec4(col, 1.0);
      return;
    }
  }

  // ═══ ACT IV — REBUILD ═══
  {
    float r = uRebuildProgress;

    // Start from white, slowly introduce synthesis colors
    vec3 ivory = vec3(0.96, 0.94, 0.88);

    // Agents blend into something new — synthesis, not compromise
    float synthHue = fract((hueA + hueB) * 0.5 + 0.1 * sin(uTime * 0.2));
    float synthEnergy = (energyA + energyB) * 0.5;
    float synthVal = 0.7 + 0.25 * synthEnergy;

    vec3 synthCol = hsv2rgb(vec3(synthHue, 0.3 + 0.4*r, synthVal));

    // Emergence sigmoid — blend based on which agent dominates locally
    float domA = pressureA + length(flowA);
    float domB = memoryB + energyB;
    float sigmoid = 1.0 / (1.0 + exp(-6.0 * (domA - domB)));
    vec3 colA = hsv2rgb(vec3(hueA, 0.3*r, 0.8 + 0.15*pressureA));
    vec3 colB = hsv2rgb(vec3(hueB, 0.3*r, 0.78 + 0.18*memoryB));
    vec3 localCol = mix(colA, colB, sigmoid);

    // Mix synthesis with local — more synthesis early, more differentiation later
    vec3 agentMix = mix(synthCol, localCol, r * r);

    // Blend from white to agent colors
    vec3 col = mix(ivory, agentMix, r * 0.8);

    // New breathing lattice — different pattern from Act I
    float lattice = sin(uv.x * 40.0 + uv.y * 10.0 + uTime * 0.3)
                  * sin(uv.y * 40.0 - uv.x * 10.0 - uTime * 0.25);
    lattice = smoothstep(0.6, 1.0, lattice);
    col += 0.05 * r * lattice * hsv2rgb(vec3(synthHue + 0.1, 0.4, 1.0));

    // Gentle Voronoi — emerging structure, not fracture
    if(r > 0.3){
      float emergence = (r - 0.3) / 0.7;
      float shards = 3.0 + 6.0 * emergence;
      vec3 vor = voronoi(uv, shards, 0.2 * emergence, uTime * 0.3);
      float vEdge = (1.0 - vor.y) * emergence * 0.15;
      col += vEdge * hsv2rgb(vec3(synthHue + 0.2, 0.5, 1.0));
    }

    // Trail
    col += vec3(0.1, 0.08, 0.05) * trail * r * 2.0;

    // Soft vignette
    vec2 vc = uv * 2.0 - 1.0;
    col *= 1.0 - 0.12*dot(vc,vc);

    fragColor = vec4(col, 1.0);
  }
}`;

// Seed shader
const SEED_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform float uSeed;
uniform float uMode;
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
    float u = fbm(uv*6.0) * 0.8 + 0.1;
    float v = fbm(uv*8.0+3.0) * 0.6;
    float spot = smoothstep(0.15, 0.0, length(uv - vec2(0.5 + 0.2*sin(uSeed), 0.5 + 0.2*cos(uSeed))));
    spot += smoothstep(0.1, 0.0, length(uv - vec2(0.3, 0.7)));
    spot += smoothstep(0.1, 0.0, length(uv - vec2(0.7, 0.3)));
    u = mix(u, 0.5, spot);
    v = mix(v, 0.25, spot);
    vec2 f = vec2(fbm(uv*4.0+7.0)-0.5, fbm(uv*4.0+13.0)-0.5)*0.3;
    fragColor = vec4(u, v, f);
  } else {
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
  initParticleSystem();
}

function initFBOs() {
  fboA = createDoubleFBO(simW, simH);
  fboB = createDoubleFBO(simW, simH);
  fboTrail = createDoubleFBO(simW, simH);
  const seed = Math.random() * 100;
  setUniforms(progSeed, { uSeed: seed, uMode: 0.0 });
  blit(fboA.read); blit(fboA.write);
  setUniforms(progSeed, { uSeed: seed + 50, uMode: 1.0 });
  blit(fboB.read); blit(fboB.write);
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

// ─── Phase State Machine ────────────────────────────────────
function updatePhase(dt) {
  phaseTime += dt;

  if (phase === PHASE.ORDER) {
    // Post-rebuild cooldown — prevent immediate re-trigger
    if (cooldownTimer > 0) {
      cooldownTimer -= dt;
      schismTimer = 0;
      return;
    }
    // Accumulate schism timer when disagreement exceeds threshold
    if (globalDisagreement > SCHISM_THRESHOLD) {
      schismTimer += dt;
    } else {
      schismTimer = Math.max(0, schismTimer - dt * 0.5);
    }
    // Transition to schism after sustained disagreement
    if (schismTimer > SCHISM_HOLD_TIME) {
      phase = PHASE.SCHISM;
      phaseTime = 0;
      schismTimer = 0;
      updatePhaseUI();
    }
  }
  else if (phase === PHASE.SCHISM) {
    // Contention energy accumulator
    const meanD = globalDisagreement;
    const boundary = Math.max(0, meanD - 0.3) * 2.0; // proxy for territory boundary
    contentionEnergy += (Math.pow(Math.min(meanD, 0.8), 1.6) + 0.002 * boundary - 0.08 * contentionEnergy) * dt;
    contentionEnergy = Math.max(0, Math.min(1, contentionEnergy));

    // Spawn flow particles during schism
    if (frame % 3 === 0 && particles.length < MAX_PARTICLES) {
      const px = Math.random();
      const py = Math.random();
      const speed = 0.05 + 0.15 * contentionEnergy;
      const angle = Math.random() * Math.PI * 2;
      const hue = Math.random() < 0.5 ? 0.55 : 0.9; // agent A or B color
      particles.push(spawnParticle(
        px, py,
        Math.cos(angle) * speed, Math.sin(angle) * speed,
        1.5 + Math.random() * 2.0,
        2 + 4 * contentionEnergy,
        hue,
        'flow'
      ));
    }

    // Transition to event when energy peaks
    if (contentionEnergy > EVENT_ENERGY) {
      phase = PHASE.EVENT;
      phaseTime = 0;
      eventStartTime = time;
      eventProgress = 0;
      // Spawn massive shard explosion
      for (let i = 0; i < EVENT_PARTICLES; i++) {
        const cx = 0.5 + (Math.random() - 0.5) * 0.3;
        const cy = 0.5 + (Math.random() - 0.5) * 0.3;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.05 + Math.random() * 0.4;
        eventParticles.push(spawnParticle(
          cx, cy,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed + 0.1 * Math.random(),
          3 + Math.random() * 4,
          1 + Math.random() * 3,
          Math.random(),
          'shard'
        ));
      }
      updatePhaseUI();
    }
  }
  else if (phase === PHASE.EVENT) {
    eventProgress = Math.min(1, (time - eventStartTime) / EVENT_DURATION);
    // Transition to rebuild when event completes
    if (eventProgress >= 1) {
      phase = PHASE.REBUILD;
      phaseTime = 0;
      rebuildStartTime = time;
      rebuildProgress = 0;
      contentionEnergy = 0;
      // Clear remaining event particles
      eventParticles = [];
      particles = [];
      // Re-seed the simulation for fresh start
      initFBOs();
      updatePhaseUI();
    }
  }
  else if (phase === PHASE.REBUILD) {
    rebuildProgress = Math.min(1, (time - rebuildStartTime) / REBUILD_DURATION);
    // After rebuild completes, return to order for potential next cycle
    if (rebuildProgress >= 1) {
      phase = PHASE.ORDER;
      phaseTime = 0;
      contentionEnergy = 0;
      rebuildProgress = 1;
      cooldownTimer = POST_REBUILD_COOLDOWN; // hysteresis — Codex review fix
      updatePhaseUI();
    }
  }
}

// ─── Simulation step ────────────────────────────────────────
function step() {
  // Don't update agents during EVENT shatter phase
  if (phase === PHASE.EVENT && eventProgress > 0.086) return;

  // Trail
  setUniforms(progTrail, {
    uPrev: fboTrail.read,
    uMouse: [mouse.x, mouse.y],
    uMouseDown: mouse.down ? 1.0 : 0.0,
  });
  blit(fboTrail.write);
  fboTrail.swap();

  // Agent A
  setUniforms(progA, {
    uPrev: fboA.read,
    uTrail: fboTrail.read,
    uMouse: [mouse.x, mouse.y],
    uMouseVel: [mouse.vx, mouse.vy],
    uTime: time,
    uDt: dt,
    uRes: [simW, simH],
    uPhase: phase,
    uContentionEnergy: contentionEnergy,
  });
  blit(fboA.write);
  fboA.swap();

  // Agent B
  setUniforms(progB, {
    uPrev: fboB.read,
    uTrail: fboTrail.read,
    uTime: time,
    uBPM: bpm,
    uPhraseHash: (phraseHash % 10000) / 10000,
    uRes: [simW, simH],
    uPhase: phase,
    uContentionEnergy: contentionEnergy,
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
    uPhase: phase,
    uContentionEnergy: contentionEnergy,
    uEventProgress: eventProgress,
    uRebuildProgress: rebuildProgress,
    uPhaseTime: phaseTime,
  });
  blit(null);

  // Draw particles on top
  const allParticles = [...particles, ...eventParticles];
  if (allParticles.length > 0) {
    uploadAndDrawParticles(allParticles);
  }
}

// ─── UI ─────────────────────────────────────────────────────
const mA = document.getElementById("mA");
const mB = document.getElementById("mB");
const phaseEl = document.getElementById("phaseLabel");
const energyEl = document.getElementById("energyFill");

function updateMeters() {
  const aPct = Math.round(Math.max(20, Math.min(80, 50 - globalDisagreement * 30)));
  const bPct = 100 - aPct;
  mA.style.width = aPct + "%";
  mB.style.width = bPct + "%";
  if (energyEl) {
    energyEl.style.width = (contentionEnergy * 100) + "%";
  }
}

function updatePhaseUI() {
  if (!phaseEl) return;
  const names = ['ORDER', 'SCHISM', 'EVENT', 'REBUILD'];
  phaseEl.textContent = names[phase];
  phaseEl.className = 'phase-' + names[phase].toLowerCase();
}

// ─── Main loop ──────────────────────────────────────────────
let lastTime = 0;
function loop(now) {
  requestAnimationFrame(loop);
  now *= 0.001;
  dt = Math.min(now - lastTime, 0.05); // cap at 50ms to avoid phase skips
  lastTime = now;
  time = now;
  tapPhase = (now * bpm / 60) % 1;

  updatePhase(dt);
  step();
  render();
  updateAudio(dt);

  // Update particles
  updateParticles(particles, dt);
  updateParticles(eventParticles, dt);

  // Sample disagreement
  if (frame % 10 === 0) {
    const px = new Float32Array(4);
    const px2 = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA.read.fb);
    gl.readPixels(simW >> 1, simH >> 1, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.read.fb);
    gl.readPixels(simW >> 1, simH >> 1, 1, 1, gl.RGBA, gl.FLOAT, px2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const d = Math.abs(px[0] - px2[0]) * 0.4 + Math.hypot(px[2], px[3]) * 0.3 + Math.abs(px[1] - px2[1]) * 0.3;
    globalDisagreement = globalDisagreement * 0.85 + Math.min(d, 1.0) * 0.15;
  }
  updateMeters();

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
  phase = PHASE.ORDER;
  contentionEnergy = 0;
  schismTimer = 0;
  eventProgress = 0;
  rebuildProgress = 0;
  phaseTime = 0;
  globalDisagreement = 0;
  cooldownTimer = 0;
  particles = [];
  eventParticles = [];
  initFBOs();
  phraseHash = Math.floor(Math.random() * 100000);
  updatePhaseUI();
};

// ─── Init ───────────────────────────────────────────────────
initPrograms();
resize();
updatePhaseUI();
requestAnimationFrame(loop);
