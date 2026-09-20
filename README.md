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

## Development and release checks

```bash
pnpm install --child-concurrency=1 --network-concurrency=1
pnpm run typecheck
pnpm run build
pnpm test
pnpm run build:demo
pnpm dev
```

Visit `/tests/browser.html` for native WebGPU pixel regressions and `/tests/browser.html?webgl` for WebGL 2. Both must finish with zero failures. These tests cover constant colors, live uniforms, alpha, data-map isolation, UV selection, texture transforms, existing-material integration, normal strength and boundary parameters. Also inspect `/` and `/pbr.html` visually, including the GUI controls and both backends.

`pnpm pack` runs type checking, library compilation and API/consumer-type tests before creating a local archive. It does not publish. Only `dist`, README, package metadata and LICENSE ship; demo assets and lil-gui are excluded from runtime dependencies. Browser tests remain a separate release gate.

The pre-release API no longer exposes the ineffective `lookupSkipThreshold`. Compared with the original prototype, texture density now matches ordinary sampling and color contrast correction defaults to off.

## Publishing to npm

Run these commands from the package root:

```bash
# Sign in to the npm account that owns (or can create) this package.
pnpm login --registry=https://registry.npmjs.org/

# Check the package contents and release lifecycle without uploading.
pnpm release:dry

# Automatically bump patch (e.g. 0.1.0 → 0.1.1) and publish.
pnpm release

# Optional larger version increments.
pnpm release minor
pnpm release major
```

`pnpm release` checks npm login, runs `prepack` (strict type checking, a fresh library build, API/release-script tests and consumer type checks), increments the version, then publishes to the public npm registry. Checks run before the version changes. The publish subprocess uses `--ignore-scripts` to avoid running these checks twice and `--no-git-checks` because the automatic version update modifies the worktree. Review your working tree before release; uncommitted changes can be published. Complete any npm authentication or 2FA prompt locally. Browser regression tests described above remain a separate release check.

`pnpm release:dry` runs the checks and npm's dry-run packaging without login, uploading or changing the version. It prints the proposed next version; the package preview uses the unchanged current version. It does not verify publishing permission. `pnpm release minor --dry-run` previews a minor bump.

Every normal release invocation increments the local version, including the first release. No Git commits, tags or GitHub releases are created automatically; commit the version change after success. An already published name/version cannot be overwritten. If publication fails or its outcome is uncertain, the incremented version is retained: check npm, then use `pnpm release --retry` to retry the same version if it was not published. Authentication/check failures leave the version unchanged. Concurrent release commands are blocked by `.release.lock`; after a forced termination, remove that file only once the previous process has stopped.

If the unscoped package name is owned by someone else, choose an available name or your npm scope first.

### README on npm

npm automatically renders the root `README.md` on the package page. It is included in the package even though `files` only lists `dist`; no `readme` field or separate upload is needed. Publish from this package root, not from `dist`. The dry run lists `README.md` among the files to publish.

To update the README shown on npm, edit it and publish a new package version; pushing changes to GitHub alone does not update npm. Use public absolute URLs for screenshots and links to repository files. See the [npm README documentation](https://docs.npmjs.com/about-package-readme-files/) and [pnpm publish documentation](https://pnpm.io/10.x/cli/publish).

## Attribution

The algorithm is adapted from Fabrice Neyret's texture tile-breaking shader and the original `three-hex-tiling` implementation. See that project's license and implementation notes for the lineage.

The PBR demo uses the 2K glTF download of [Rocky Terrain 02](https://polyhaven.com/a/rocky_terrain_02), created by Amal Kumar and provided by Poly Haven under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). The files in `public/assets/rocky-terrain-02/` retain their CC0 status; the project's MIT license applies to its code. See [Poly Haven's asset license](https://polyhaven.com/license). Attribution is provided as a courtesy.
