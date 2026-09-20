import test from 'node:test'
import assert from 'node:assert/strict'
import { Texture, Vector2, ObjectSpaceNormalMap } from 'three'
import { MeshStandardNodeMaterial, MeshPhysicalNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { applyHexTiling, createHexTilingUniforms, hexTexture } from '../dist/index.js'

test('validates initial parameters and exposes mutable uniforms', () => {
  for (const key of ['patchScale', 'textureSampleCoefficientExponent']) {
    for (const value of [0, -1, NaN, Infinity, 65]) {
      assert.throws(() => createHexTilingUniforms({ [key]: value }), RangeError)
    }
  }
  assert.throws(() => createHexTilingUniforms({ useContrastCorrectedBlending: 1 }), TypeError)
  const uniforms = createHexTilingUniforms()
  uniforms.patchScale.value = 3
  assert.equal(uniforms.patchScale.value, 3)
  assert.equal(uniforms.useContrastCorrectedBlending.value, false)
  assert.equal('lookupSkipThreshold' in uniforms, false)
})

test('rejects unsupported input and UV channels', () => {
  assert.throws(() => hexTexture({}), TypeError)
  for (const channel of [-1, 0.5, 4]) {
    assert.throws(() => hexTexture(new Texture(), { uvChannel: channel }), RangeError)
  }
  assert.throws(() => applyHexTiling(new MeshBasicNodeMaterial(), {}), TypeError)
  const material = new MeshStandardNodeMaterial()
  material.normalMapType = ObjectSpaceNormalMap
  assert.throws(() => applyHexTiling(material, { normalMap: new Texture() }), TypeError)
})

test('supports physical materials and invalidates an already compiled material', () => {
  const material = new MeshPhysicalNodeMaterial()
  const version = material.version
  const normalScale = new Vector2(2, -2)
  const maps = { map: new Texture(), normalMap: new Texture(), aoMap: new Texture() }
  const { uniforms } = applyHexTiling(material, maps, { normalScale })
  assert.ok(material.colorNode && material.normalNode && material.aoNode)
  assert.ok(material.version > version)
  assert.ok(uniforms.patchScale.isUniformNode)
  assert.equal(material.normalNode.scaleNode.value, normalScale)
})
