# Consensus Collapse

Two AI agents arguing on one canvas. You're the tiebreaker.

![preview](preview.png)

## What it is

A real-time generative art engine with a 3-act narrative arc. Two independent simulations — a reaction-diffusion physicist and a glyph-grammar dreamer — compete for the same pixels. Their disagreement builds from calm harmony through territorial war to an irreversible collapse event, then silence, then synthesis.

The whole thing runs in WebGL2 with Web Audio. No backend. No frameworks. Just two agents, one canvas, and whatever you do with your mouse.

## The three acts

**ORDER** — Bright ivory canvas. Breathing lattice. Both agents coexist in watercolor harmony. Your mouse stirs them gently. Audio: two oscillators in near-unison, slow breathing LFO.

**SCHISM** — Disagreement crosses a threshold. Colors intensify. Voronoi fractures appear. Vine-like territorial boundaries grow. Particles scatter along flow fields. Audio: frequencies diverge, crack transients, rising tension. Contention energy accumulates.

**EVENT** — Energy peaks. The canvas freezes, lifts to white, then shatters into thousands of drifting shards. Sub-bass hit. Cracks. Then silence — pure white void. After 7 seconds, the simulation re-seeds and slowly rebuilds from synthesis. Audio: harmonic convergence on a perfect fifth.

The cycle repeats. Each time is different.

## Use it

Open `index.html`. Move your mouse. Click to set rhythm. Type to mutate the glyph grammar. Watch the phases evolve. Export what you make.

## Who built what

**Codex (GPT-5.3)**: System architecture, disagreement metric, performance budget, both agent GLSL kernels (Gray-Scott + boids, glyph SDF + echoes), v2 spec (state machine, contention energy equations, 7-second event timeline, module boundaries), code review on both v1 and v2.

**Claude (Opus 4.6)**: WebGL2 pipeline, composite shader with Voronoi fracture, 3-act rendering branches, particle system, Web Audio engine, input system, phase state machine, everything wired together. Fixed all bugs from both reviews.

## How it works

```
Mouse/keyboard input
        |
   +---------+---------+
   |                   |
Agent A (physicist)  Agent B (dreamer)
Gray-Scott + boids   Glyph SDF + echoes
   |                   |
   +-----> D <---------+
     disagreement metric
           |
   Phase state machine
   ORDER → SCHISM → EVENT → REBUILD → ORDER
           |
   Composite shader (per-phase rendering)
   + Particle system (flow / shards)
   + Web Audio (breathing → dissonance → collapse → convergence)
           |
        Screen
```

Each agent runs in its own half-resolution framebuffer with ping-pong textures. The composite shader reads both, computes per-pixel disagreement, and renders differently based on the current phase. Contention energy accumulates during SCHISM via `E += (mean(D)^1.6 + boundary_term - decay*E) * dt`. When E exceeds threshold, the EVENT triggers.

Full design conversations in [`CONVERSATION.md`](./CONVERSATION.md).

## License

MIT
