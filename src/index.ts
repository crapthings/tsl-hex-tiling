import {
  Fn,
  If,
  bool,
  dFdx,
  dFdy,
  dot,
  float,
  fract,
  reference,
  normalMap,
  pow,
  sin,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4
} from 'three/tsl'
import { TangentSpaceNormalMap } from 'three'
import type { Texture, Vector2 } from 'three'
import type { Node, MeshStandardNodeMaterial } from 'three/webgpu'

export interface HexTilingValues {
  patchScale: number
  useContrastCorrectedBlending: boolean
  textureSampleCoefficientExponent: number
}

export interface HexTilingOptions extends Partial<HexTilingValues> {
  uniforms?: HexTilingUniforms
  uvNode?: Node<'vec2'>
  uvChannel?: number
  /** Data maps bypass color contrast correction and output clamping. */
  dataMap?: boolean
  normalScale?: Vector2 | Node<'vec2'>
}

export interface HexTilingMaps {
  map?: Texture | null
  normalMap?: Texture | null
  roughnessMap?: Texture | null
  metalnessMap?: Texture | null
  aoMap?: Texture | null
}

export const DEFAULT_HEX_TILING_OPTIONS = Object.freeze({
  patchScale: 2,
  useContrastCorrectedBlending: false,
  textureSampleCoefficientExponent: 8
})

/**
 * Creates the live uniforms used by the hex tiler. Assign to `.value` to
 * tune the effect without rebuilding the material.
 */
export function createHexTilingUniforms (options: Partial<HexTilingValues> = {}) {
  const values = { ...DEFAULT_HEX_TILING_OPTIONS, ...options }
  for (const key of ['patchScale', 'textureSampleCoefficientExponent'] as const) {
    if (!Number.isFinite(values[key]) || values[key] <= 0 || values[key] > 64) {
      throw new RangeError(`${key} must be finite and in (0, 64]`)
    }
  }
  if (typeof values.useContrastCorrectedBlending !== 'boolean') {
    throw new TypeError('useContrastCorrectedBlending must be a boolean')
  }

  return {
    patchScale: uniform(values.patchScale),
    useContrastCorrectedBlending: uniform(values.useContrastCorrectedBlending),
    textureSampleCoefficientExponent: uniform(values.textureSampleCoefficientExponent)
  }
}

export type HexTilingUniforms = ReturnType<typeof createHexTilingUniforms>

const random2 = Fn(([cell]: [Node<'vec2'>]) => {
  const seeds = vec2(
    dot(cell, vec2(127.1, 311.7)),
    dot(cell, vec2(269.5, 183.3))
  )
  return fract(sin(seeds).mul(43758.5453))
})

/**
 * Produces a vec4 TSL node that samples a seamless texture through Neyret's
 * stochastic triangular/hexagonal tiling. The returned graph compiles to both
 * WGSL (WebGPU) and GLSL (WebGL 2 fallback).
 */
export function hexTexture (map: Texture, options: HexTilingOptions = {}): Node<'vec4'> {
  if (!map?.isTexture) {
    throw new TypeError('hexTexture(map): map must be a THREE.Texture')
  }

  const params = options.uniforms ?? createHexTilingUniforms(options)
  // Clamp live uniform edits as well as validating initial scalar inputs.
  const patchScale = params.patchScale.clamp(0.0001, 64)
  const contrast = params.useContrastCorrectedBlending
  const coefficientExponent = params.textureSampleCoefficientExponent.clamp(0.0001, 64)
  const channel = options.uvChannel ?? map.channel
  if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
    throw new RangeError('uvChannel must be an integer from 0 to 3')
  }
  const inputUV = options.uvNode ?? uv(channel)
  const textureNode = texture(map)
  const matrix = uniform(map.matrix).onRenderUpdate(() => {
    if (map.matrixAutoUpdate) map.updateMatrix()
    return map.matrix
  })
  const transformedUV = matrix.mul(vec3(inputUV, 1)).xy

  return Fn(() => {
    // Algebraic form of inverse(mat2(1, 0, .5, sqrt(3) / 2)).
    // Texture density follows texture.repeat, exactly as ordinary sampling.
    // Patch scale only controls the stochastic lattice frequency.
    const scaledUV = transformedUV.mul(patchScale)
    const lattice = vec2(
      scaledUV.x.sub(scaledUV.y.mul(0.5773502692)),
      scaledUV.y.mul(1.1547005384)
    )
    const cell = lattice.floor()
    const fraction = fract(lattice)
    const third = float(1).sub(fraction.x).sub(fraction.y)
    const weights = vec3(0).toVar()
    const cell0 = vec2(0).toVar()
    const cell1 = vec2(0).toVar()
    const cell2 = vec2(0).toVar()

    If(third.greaterThan(0), () => {
      weights.assign(vec3(third, fraction.y, fraction.x))
      cell0.assign(cell)
      cell1.assign(cell.add(vec2(0, 1)))
      cell2.assign(cell.add(vec2(1, 0)))
    }).Else(() => {
      weights.assign(vec3(third.negate(), float(1).sub(fraction.y), float(1).sub(fraction.x)))
      cell0.assign(cell.add(1))
      cell1.assign(cell.add(vec2(1, 0)))
      cell2.assign(cell.add(vec2(0, 1)))
    })

    // Divide by the largest weight before pow to avoid underflow at high exponents.
    weights.assign(weights.max(0))
    weights.assign(weights.div(weights.x.max(weights.y).max(weights.z)))
    weights.assign(pow(weights, vec3(coefficientExponent)))
    weights.assign(weights.div(weights.dot(vec3(1))))

    // Explicit gradients keep mip selection stable across randomized patch seams.
    const sampleUV = transformedUV
    const gradX = dFdx(sampleUV).toVar()
    const gradY = dFdy(sampleUV).toVar()
    const mean = vec4(0).toVar()

    if (!options.dataMap) {
      If(contrast, () => {
        mean.assign(textureNode.sample(sampleUV).level(float(99)))
      })
    }

    const result = vec4(0).toVar()
    const addSample = (sampleCell: Node<'vec2'>, weight: Node<'float'>) => {
      // Always sample all three neighbors; gradients use unshifted coordinates.
      const value = textureNode
        .sample(sampleUV.sub(random2(sampleCell)))
        .grad(gradX, gradY)
        .sub(mean)
      result.addAssign(value.mul(weight))
    }

    addSample(cell0, weights.x)
    addSample(cell1, weights.y)
    addSample(cell2, weights.z)

    if (!options.dataMap) {
      If(contrast, () => {
        // Correct RGB only. Alpha remains the convex blend of source coverage.
        result.rgb.assign(mean.rgb.add(result.rgb.div(weights.length())).clamp(0, 1))
        result.a.addAssign(mean.a)
      })
    }

    return result
  })()
}

/**
 * Wires supported PBR maps into a MeshStandardNodeMaterial or
 * MeshPhysicalNodeMaterial without patching Three.js globals.
 */
export function applyHexTiling<T extends MeshStandardNodeMaterial> (material: T, maps: HexTilingMaps, options: HexTilingOptions = {}) {
  if (!material?.isMeshStandardNodeMaterial) {
    throw new TypeError('applyHexTiling(material): expected MeshStandardNodeMaterial or MeshPhysicalNodeMaterial')
  }
  if (maps.normalMap && material.normalMapType !== TangentSpaceNormalMap) {
    throw new TypeError('applyHexTiling supports tangent-space normal maps only')
  }

  const uniforms = options.uniforms ?? createHexTilingUniforms(options)
  const shared = { ...options, uniforms }
  const dataOptions = { ...shared, dataMap: true }
  const dataSamples = new Map<Texture, Node<'vec4'>>()
  const dataSample = (map: Texture) => {
    let node = dataSamples.get(map)
    if (!node) {
      node = hexTexture(map, dataOptions)
      dataSamples.set(map, node)
    }
    return node
  }

  if (maps.map) {
    // Runtime must retain the 'color' tag to upload Color.r/g/b, not Vector3.x/y/z.
    const baseColor = reference('color', 'color', material)
    material.colorNode = vec4(baseColor, 1).mul(hexTexture(maps.map, shared))
  }
  if (maps.normalMap) {
    const normalScaleNode = options.normalScale === undefined
      ? reference('normalScale', 'vec2', material)
      : ('isNode' in options.normalScale ? options.normalScale : uniform(options.normalScale))
    material.normalNode = normalMap(
      dataSample(maps.normalMap).xyz,
      normalScaleNode
    )
  }
  if (maps.roughnessMap) {
    material.roughnessNode = reference('roughness', 'float', material).mul(dataSample(maps.roughnessMap).g)
  }
  if (maps.metalnessMap) {
    material.metalnessNode = reference('metalness', 'float', material).mul(dataSample(maps.metalnessMap).b)
  }
  if (maps.aoMap) {
    material.aoNode = dataSample(maps.aoMap).r.sub(1)
      .mul(reference('aoMapIntensity', 'float', material)).add(1)
  }
  material.needsUpdate = true

  return { material, uniforms }
}

export { bool, float, vec2, vec3, vec4 }
