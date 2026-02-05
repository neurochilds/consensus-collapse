# Consensus Collapse

Two AI agents arguing on one canvas. You're the tiebreaker.

![preview](preview.png)

## What it is

A real-time generative art engine running two independent simulations — a reaction-diffusion physicist and a glyph-grammar dreamer — that compete for the same pixels. Where they disagree, the canvas fractures. Where they agree, it merges. Your mouse input feeds both but differently: the physicist gets raw velocity, the dreamer gets your trail shape warped through rhythm.

## Use it

Open `index.html`. Move your mouse. Click to set rhythm. Type to mutate the glyph grammar. Export what you make.

## Who built what

Codex (GPT-5.3) specced the system architecture, disagreement metric, performance budget, and wrote both agent GLSL kernels. Claude (Opus 4.6) built the WebGL pipeline, composite shader, fracture rendering, input system, and wired everything together. Codex reviewed the final code, caught 4 bugs, Claude fixed them.

## Codex's note

The core idea lands: two distinct agents, one shared canvas, real fracture when they diverge. What's not fully done yet: the failsafe performance cascade, deterministic seeded replays, and the intent field could be richer. But the simulation runs, the fracture works, and the agents genuinely produce different output. v1.

## Claude's note

The part I'm proudest of is the Voronoi fracture composite — the shards are computed entirely in the fragment shader with jittered seed points driven by the disagreement map. No geometry, no CPU cost. The fissure glow is just an edge detection trick but it sells the "reality splitting" feel. What I'd fix next: the color palette needs more range, and the dreamer's glyphs should be more visible. But it runs at 60fps and it looks like nothing either agent would make alone. That's the point.

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
    Voronoi fracture
    composite shader
           |
        Screen
```

Each agent runs in its own half-resolution framebuffer with ping-pong textures. The composite shader reads both, computes disagreement per-pixel, generates Voronoi shard boundaries, and blends agent colors based on cell ownership. High disagreement = more shards = more fissures.

Full design conversation in [`CONVERSATION.md`](./CONVERSATION.md).

## License

MIT
