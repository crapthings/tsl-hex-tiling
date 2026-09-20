# Architecture and migration analysis

## What the original project does

`three-hex-tiling` has three layers:

1. `tileBreakingNeyret.frag` maps UV coordinates into a triangular lattice, hashes the three neighboring lattice vertices into random UV offsets, and blends up to three texture samples.
2. `shaders.ts` rewrites four Three.js `ShaderChunk` strings (`map`, normal, roughness, and metalness) and injects the GLSL function into standard/physical fragment shaders.
3. `materials.ts` patches the global standard and physical material prototypes. `onBeforeCompile`, `onBeforeRender`, and `customProgramCacheKey` manage defines, shader references, and mutable uniforms.

This is a pragmatic WebGL integration, but the rendering algorithm and its Three.js integration are tightly coupled.

## Why it cannot simply be made WebGPU-compatible

`WebGPURenderer` does not compile `ShaderLib.standard.fragmentShader`, and WGSL has no Three.js `ShaderChunk` include path to rewrite. `onBeforeCompile` is consequently the wrong extension boundary. The global prototype patches also create composition hazards for applications that install their own callbacks.

The portable extension boundary in current Three.js is the node graph:

```text
Texture + UV + uniforms
        │
        ▼
   hexTexture() ──────► vec4 Node
        │
        ├── colorNode
        ├── normalMap(...) ─► normalNode
        ├── .g ─────────────► roughnessNode
        └── .b ─────────────► metalnessNode
```

Three.js then lowers that graph to WGSL for WebGPU or GLSL for its WebGL 2 fallback.

## Porting decisions

### Pure TSL, no native WGSL string

The full algorithm uses TSL operators and `Fn`/`If`. This keeps one implementation for both backends and lets the graph compose with application nodes. A native `wgslFn` would prevent the fallback backend from compiling it.

### Explicit gradients

Random UV offsets create discontinuities at patch boundaries. Derivatives of the randomized coordinates therefore select unstable mip levels. The port derives gradients from the unshifted coordinate and uses `TextureNode.grad()`, equivalent to the original `textureGrad` calls.

### Texture color management

The original GLSL approximates sRGB conversion with `pow(2.2)`. Modern Three.js texture nodes already convert samples from the texture's declared color space into the working color space. Re-applying the manual conversion would double-decode color maps, so the TSL port relies on Three.js color management. Correct texture metadata is required.

### Runtime parameters

The old package copies plain object fields into shader uniforms during `onBeforeRender`. The new API returns the uniform nodes directly. Updating `.value` is explicit, has no shader lookup map, and does not require a material recompile.

### Material integration

`hexTexture()` is the low-level API. `applyHexTiling()` assigns color, tangent-space normal, roughness, metalness and AO nodes. Base material property references exclude built-in texture sampling, avoiding double multiplication on existing materials. Data maps bypass color contrast correction. A per-call texture cache reuses packed data samples across channels. Advanced users should compose nodes themselves for layered terrain, triplanar projection, masks or custom tangent frames.

## Behavioral compatibility

| Capability | Original | TSL port |
| --- | --- | --- |
| Renderer | WebGLRenderer | WebGPURenderer + WebGL 2 fallback |
| Material extension | Global prototype patch | Per-material node assignment |
| Base color | `map` shader chunk | `colorNode` |
| Normal | `normalMap` shader chunk | `normalMap(hexTexture(...))` |
| Roughness | green channel | green channel |
| Metalness | blue channel | blue channel |
| Mutable tuning | plain object copied each draw | uniform node `.value` |
| Custom UV graph | unavailable | `uvNode` option |
| Enable/disable after creation | material swap/recompile | node graph rebuild/material swap |

## Known constraints

- Inputs must be seamless textures. Stochastic tiling hides repetition, not discontinuous texture borders.
- A texture object is captured in the node graph. Replacing a map means rebuilding that node graph; changing uniform values does not.
- The helper handles tangent-space normal maps. Object-space normal maps and exotic channel packing should use the low-level API.
- Cost scales with distinct map count: three gradient samples and, for color contrast correction, one coarse mip sample. The unused `lookupSkipThreshold` was removed. Unconditional sampling resolved earlier visible artifacts; the exact original driver/compiler cause was not established.
- TSL is still evolving across Three.js revisions. The supported range is restricted to r186; new revisions must be exercised through both renderer backends before release.
- Texture density is independent of patch frequency. Unlike the original port, there is no hidden 0.435× scale on texture sampling.
- Public declarations are generated from strictly checked TypeScript; API tests and a consumer type fixture supplement real-renderer pixel regressions under `tests/`.
