import * as THREE from 'three/webgpu'
import { texture, uv, vec4 } from 'three/tsl'
import { applyHexTiling, createHexTilingUniforms, hexTexture } from '../src/index.ts'

const results = document.querySelector('#results')
let passed = 0
let failed = 0
function assert (condition, message) { if (!condition) throw new Error(message) }
async function test (name, fn) {
  const item = document.createElement('li')
  try { await fn(); passed++; item.className = 'pass'; item.textContent = `PASS ${name}` }
  catch (error) { failed++; item.className = 'fail'; item.textContent = `FAIL ${name}: ${error.message}`; console.error(error) }
  results.append(item)
}

const forceWebGL = new URLSearchParams(location.search).has('webgl')
const renderer = new THREE.WebGPURenderer({ forceWebGL })
renderer.setSize(16, 16)
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
renderer.toneMapping = THREE.NoToneMapping
try {
  await renderer.init()
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU / WGSL' : 'WebGL 2 / GLSL'
  document.querySelector('#backend').textContent = backend
  assert(forceWebGL || renderer.backend.isWebGPUBackend, 'WebGPU requested but fell back to WebGL')
  const target = new THREE.RenderTarget(16, 16)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  camera.position.z = 2
  const geometry = new THREE.PlaneGeometry(2, 2)
  geometry.setAttribute('uv1', geometry.attributes.uv.clone())
  for (let i = 0; i < geometry.attributes.uv1.count; i++) {
    geometry.attributes.uv1.setXY(i, geometry.attributes.uv1.getX(i) * 2.7, geometry.attributes.uv1.getY(i) * 1.9)
  }
  const mesh = new THREE.Mesh(geometry)
  scene.add(mesh)
  const light = new THREE.DirectionalLight(0xffffff, 2)
  light.position.set(-3, 1, 3)
  scene.add(light)
  scene.add(new THREE.AmbientLight(0xffffff, 0.3))
  const resources = new Set([target, geometry])
  const makeMap = (constant) => {
    const bytes = new Uint8Array(8 * 8 * 4)
    for (let i = 0; i < 64; i++) {
      bytes.set(constant ?? [32 + (i * 37 % 192), 48 + (i * 13 % 160), 64 + (i * 29 % 128), 64], i * 4)
    }
    const map = new THREE.DataTexture(bytes, 8, 8)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.needsUpdate = true
    resources.add(map)
    return map
  }
  const map = makeMap()
  const materialFor = node => {
    const material = new THREE.MeshBasicNodeMaterial({ colorNode: node, toneMapped: false })
    resources.add(material)
    return material
  }
  const pixels = async material => {
    mesh.material = material
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 16, 16)
    return new Uint8Array(data)
  }
  const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
  const same = (a, b, label) => assert(maxDiff(a, b) <= 1, `${label}: max difference ${maxDiff(a, b)}`)

  await test('constant texture preserved with and without color correction', async () => {
    const constant = makeMap([96, 128, 160, 255])
    const expected = await pixels(materialFor(texture(constant)))
    assert(expected.some(v => v > 0), 'empty reference render')
    for (const correction of [false, true]) {
      same(expected, await pixels(materialFor(hexTexture(constant, { useContrastCorrectedBlending: correction }))), 'constant color')
    }
  })
  await test('data maps unchanged by live contrast toggle', async () => {
    const uniforms = createHexTilingUniforms()
    const material = materialFor(hexTexture(map, { uniforms, dataMap: true }))
    const before = await pixels(material)
    uniforms.useContrastCorrectedBlending.value = true
    same(before, await pixels(material), 'data map')
  })
  await test('color correction preserves alpha coverage', async () => {
    const uniforms = createHexTilingUniforms()
    const node = hexTexture(map, { uniforms })
    const material = materialFor(vec4(node.a, node.a, node.a, 1))
    const before = await pixels(material)
    uniforms.useContrastCorrectedBlending.value = true
    same(before, await pixels(material), 'alpha')
  })
  await test('live color contrast and patch controls affect pixels', async () => {
    const uniforms = createHexTilingUniforms({ textureSampleCoefficientExponent: 1 })
    const material = materialFor(hexTexture(map, { uniforms }))
    const before = await pixels(material)
    uniforms.useContrastCorrectedBlending.value = true
    assert(maxDiff(before, await pixels(material)) > 2, 'contrast toggle did not update')
    uniforms.useContrastCorrectedBlending.value = false
    uniforms.patchScale.value = 5
    assert(maxDiff(before, await pixels(material)) > 10, 'patch scale did not update')
  })
  await test('default texture channel matches explicit UV1 and differs from UV0', async () => {
    map.channel = 1
    const implicit = await pixels(materialFor(hexTexture(map)))
    same(implicit, await pixels(materialFor(hexTexture(map, { uvChannel: 1 }))), 'UV1')
    assert(maxDiff(implicit, await pixels(materialFor(hexTexture(map, { uvNode: uv(0) })))) > 10, 'UV sets not distinguished')
    map.channel = 0
  })
  await test('live texture transforms update without recompiling', async () => {
    const material = materialFor(hexTexture(map))
    const before = await pixels(material)
    map.repeat.set(2, 3)
    assert(maxDiff(before, await pixels(material)) > 10, 'repeat did not update')
    map.repeat.set(1, 1)
  })
  await test('existing native maps do not multiply hex maps a second time', async () => {
    const clean = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.2 })
    const existing = clean.clone()
    resources.add(clean); resources.add(existing)
    existing.map = existing.roughnessMap = existing.metalnessMap = map
    for (const material of [clean, existing]) {
      applyHexTiling(material, { map, roughnessMap: map, metalnessMap: map, aoMap: map })
    }
    const cleanPixels = await pixels(clean)
    assert(cleanPixels.some((v, i) => i % 4 !== 3 && v > 10), 'material rendered black')
    same(cleanPixels, await pixels(existing), 'existing maps')
  })
  await test('material Color uploads correctly and remains live', async () => {
    const constant = makeMap([128, 160, 192, 255])
    const native = new THREE.MeshStandardNodeMaterial({ color: 0xaaccff, map: constant })
    const hex = new THREE.MeshStandardNodeMaterial({ color: 0xaaccff })
    resources.add(native); resources.add(hex)
    applyHexTiling(hex, { map: constant })
    same(await pixels(native), await pixels(hex), 'material color')
    native.color.set(0xff8844); hex.color.set(0xff8844)
    same(await pixels(native), await pixels(hex), 'live material color')
  })
  await test('normal strength changes rendered lighting in place', async () => {
    const normal = makeMap([245, 128, 170, 255])
    const material = new THREE.MeshStandardNodeMaterial({ color: 0x808080, roughness: 0.7 })
    resources.add(material)
    applyHexTiling(material, { normalMap: normal })
    material.normalScale.setScalar(0)
    const flat = await pixels(material)
    material.normalScale.setScalar(2)
    const difference = maxDiff(flat, await pixels(material))
    assert(difference > 5, `normal strength had no visible effect (difference ${difference})`)
  })
  await test('zero live patch scale and high blend exponent stay renderable', async () => {
    const constant = makeMap([96, 128, 160, 255])
    const uniforms = createHexTilingUniforms({ textureSampleCoefficientExponent: 64 })
    uniforms.patchScale.value = 0
    same(await pixels(materialFor(texture(constant))), await pixels(materialFor(hexTexture(constant, { uniforms }))), 'boundary parameters')
  })
  renderer.setRenderTarget(null)
  for (const resource of resources) resource.dispose()
  await renderer.dispose()
  document.querySelector('#summary').textContent = `${passed} passed, ${failed} failed — ${backend}`
} catch (error) {
  document.querySelector('#summary').textContent = `FAILED: ${error.message}`
  console.error(error)
}
