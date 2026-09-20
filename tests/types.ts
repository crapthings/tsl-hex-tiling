import { Texture } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { applyHexTiling, createHexTilingUniforms, hexTexture } from 'tsl-hex-tiling'
const uniforms = createHexTilingUniforms()
uniforms.patchScale.value = 3
uniforms.useContrastCorrectedBlending.value = true
hexTexture(new Texture(), { uniforms }).rgb.mul(0.5)
applyHexTiling(new MeshStandardNodeMaterial(), { aoMap: new Texture() })
// @ts-expect-error boolean uniforms cannot accept numbers
uniforms.useContrastCorrectedBlending.value = 1
// @ts-expect-error obsolete no-op option was removed
createHexTilingUniforms({ lookupSkipThreshold: 0.1 })
