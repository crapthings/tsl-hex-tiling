# tsl-hex-tiling

Non-repeating seamless texture tiling for modern Three.js node materials. It is a TSL port of the Neyret hex/triangular tile-breaking shader used by `three-hex-tiling`, designed for `WebGPURenderer` and WGSL while retaining Three.js' WebGL 2 fallback.

## Why a new package?

`three-hex-tiling` rewrites global GLSL `ShaderChunk` strings and patches `MeshStandardMaterial` prototypes. That works with `WebGLRenderer`, but WebGPU node materials are generated from a TSL graph and do not consume those GLSL chunks. This package builds the algorithm as a node graph instead:

- no global shader or material prototype mutation;
- explicit-gradient texture samples preserve mip selection across randomized seams;
- live uniforms can be edited without recompiling the material;
- base color, tangent-space normal, roughness, metalness and AO maps are supported;
- the same graph compiles to WGSL or GLSL through Three.js.

## Install

```bash
pnpm add tsl-hex-tiling three@~0.186.0
```

The supported Three.js release is r186 (`>=0.186.0 <0.187.0`). New revisions require renderer regression checks before widening this range. The command above is for consumers after publication; this repository is currently a release candidate.

TypeScript consumers also need matching Three.js declarations: `pnpm add -D @types/three@~0.186.0`.

## Quick start

```js
import * as THREE from 'three/webgpu'
import { applyHexTiling } from 'tsl-hex-tiling'

const material = new THREE.MeshStandardNodeMaterial({
  color: 0xffffff,
  roughness: 0.9,
  metalness: 0
})

const { uniforms } = applyHexTiling(material, {
  map: colorMap,
  normalMap,
  roughnessMap,
  metalnessMap,
  aoMap
}, {
  patchScale: 2,
  useContrastCorrectedBlending: false,
  textureSampleCoefficientExponent: 8
})

uniforms.patchScale.value = 3.5
```

Textures must be seamless, use `RepeatWrapping`, and have their color spaces configured correctly. Set `SRGBColorSpace` only on color maps; data maps such as normal, roughness and metalness maps must remain in `NoColorSpace`. The helper does not change texture metadata or take ownership of textures.

`texture.repeat` controls texture density, with the same scale as ordinary sampling. `patchScale` controls the frequency of randomized patches. `patchScale` and `textureSampleCoefficientExponent` accept finite values in `(0, 64]`; live numeric uniform values are clamped to `[0.0001, 64]` in the shader. Do not assign NaN or Infinity to uniforms.

Color contrast correction is opt-in. It preserves alpha coverage, but may clip high-contrast RGB values. `applyHexTiling()` always disables this correction for normal, roughness, metalness and AO data, even when the color correction uniform is enabled. Packed maps reuse one hex sample node when the same texture object is passed for multiple data channels.

The helper replaces the supplied maps' node slots and marks the material for recompilation. It reads the base `color`, `roughness`, `metalness`, `aoMapIntensity` and `normalScale` properties directly, so existing native maps are not multiplied twice. Other slots are left untouched. Changing `normalScale` updates the effect without recompiling. Custom node layers must be composed explicitly; cloning a configured material requires reapplying the helper because property references capture the original material.

## Low-level composition

Use `hexTexture()` when building a custom node graph:

```js
import { color } from 'three/tsl'
import { createHexTilingUniforms, hexTexture } from 'tsl-hex-tiling'

const uniforms = createHexTilingUniforms({ patchScale: 2 })
const tiled = hexTexture(colorMap, { uniforms })
material.colorNode = tiled.rgb.mul(color('#d9ccb0'))
```

You may pass `uvNode` for procedural/custom coordinates or `uvChannel` (0–3) for another geometry UV set. Otherwise the texture's own `channel` is used. Texture matrix transforms are applied once and update automatically when `matrixAutoUpdate` is enabled. With manual matrices, update `texture.matrix` yourself.

Use `hexTexture(dataTexture, { uniforms, dataMap: true })` for raw data. The helper supports RGB tangent-space normal maps; object-space and compressed two-channel normal encodings need custom decoding. Normal mapping uses Three.js' tangent frame, so custom UV projections/rotations must provide a matching tangent basis through a custom normal node.

## Performance

Each distinct tiled data map performs three gradient samples per fragment. Color maps add one coarse mip lookup when contrast correction is enabled; this assumes a complete mip chain down to 1×1. Samples are unconditional, with explicit gradients from the continuous, unshifted UVs. Separate maps still build separate lattice graphs; no cross-map GPU speedup is claimed without profiling generated shaders.

## Attribution

The algorithm is adapted from Fabrice Neyret's texture tile-breaking shader and the original `three-hex-tiling` implementation. See that project's license and implementation notes for the lineage.

The PBR demo uses the 2K glTF download of [Rocky Terrain 02](https://polyhaven.com/a/rocky_terrain_02), created by Amal Kumar and provided by Poly Haven under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). The files in `public/assets/rocky-terrain-02/` retain their CC0 status; the project's MIT license applies to its code. See [Poly Haven's asset license](https://polyhaven.com/license). Attribution is provided as a courtesy.
