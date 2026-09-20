import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import GUI from 'lil-gui'
import { manageDemo } from './lifecycle.js'
import {
  applyHexTiling,
  createHexTilingUniforms
} from '../src/index.ts'

const forceWebGL = new URLSearchParams(location.search).has('webgl')
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
document.querySelector('#app').append(renderer.domElement)
await renderer.init()

document.querySelector('#backend').textContent = renderer.backend.isWebGPUBackend
  ? 'WebGPU / WGSL'
  : 'WebGL 2 fallback / GLSL'

const scene = new THREE.Scene()
scene.background = new THREE.Color('#070a0d')

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 0.4, 8.5)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 0, 0)

const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/rocky-terrain-02/rocky_terrain_02_2k.gltf`)
const sourceMesh = gltf.scene.getObjectByProperty('isMesh', true)
const sourceMaterial = sourceMesh.material
const maps = {
  map: sourceMaterial.map,
  normalMap: sourceMaterial.normalMap,
  armMap: sourceMaterial.roughnessMap
}

for (const map of new Set(Object.values(maps))) {
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.repeat.set(6, 6)
  map.anisotropy = 8
  map.updateMatrix()
}

const createMaterial = () => new THREE.MeshPhysicalNodeMaterial({
  color: '#ffffff',
  roughness: 1,
  metalness: 0,
  ior: 1.45,
  normalScale: sourceMaterial.normalScale.clone()
})

const baselineMaterial = createMaterial()
baselineMaterial.map = maps.map
baselineMaterial.normalMap = maps.normalMap
baselineMaterial.roughnessMap = maps.armMap
baselineMaterial.aoNode = texture(maps.armMap).r

const uniforms = createHexTilingUniforms({
  patchScale: 2,
  useContrastCorrectedBlending: false,
  textureSampleCoefficientExponent: 8
})
const hexMaterial = createMaterial()
applyHexTiling(hexMaterial, {
  map: maps.map,
  normalMap: maps.normalMap,
  roughnessMap: maps.armMap,
  aoMap: maps.armMap
}, { uniforms })

const mesh = new THREE.Mesh(sourceMesh.geometry, hexMaterial)
mesh.scale.setScalar(0.048)
mesh.castShadow = true
mesh.receiveShadow = true
scene.add(mesh)

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(5.5, 96),
  new THREE.MeshStandardNodeMaterial({ color: '#11171b', roughness: 0.92 })
)
floor.rotation.x = -Math.PI / 2
floor.position.y = -2.17
floor.receiveShadow = true
scene.add(floor)

const key = new THREE.DirectionalLight('#fff0d1', 4.8)
key.position.set(4, 6, 5)
key.castShadow = true
scene.add(key)

const rim = new THREE.DirectionalLight('#79a9df', 2.2)
rim.position.set(-4, 2, -5)
scene.add(rim)

const params = {
  hexTiling: true,
  autoRotate: true,
  patchScale: uniforms.patchScale.value,
  blendExponent: uniforms.textureSampleCoefficientExponent.value,
  contrastCorrection: uniforms.useContrastCorrectedBlending.value,
  normalStrength: 1
}

const gui = new GUI({ title: 'TSL Hex Tiling · PBR' })
gui.add(params, 'hexTiling').name('Hex tiling').onChange(enabled => {
  mesh.material = enabled ? hexMaterial : baselineMaterial
})
gui.add(params, 'autoRotate').name('Auto rotate')
gui.add(params, 'patchScale', 0.2, 8, 0.05).name('Patch scale').onChange(value => {
  uniforms.patchScale.value = value
})
gui.add(params, 'blendExponent', 1, 24, 0.5).name('Blend exponent').onChange(value => {
  uniforms.textureSampleCoefficientExponent.value = value
})
gui.add(params, 'contrastCorrection').name('Contrast correction').onChange(value => {
  uniforms.useContrastCorrectedBlending.value = value
})
gui.add(params, 'normalStrength', 0, 3, 0.05).name('Normal strength').onChange(value => {
  baselineMaterial.normalScale.copy(sourceMaterial.normalScale).multiplyScalar(value)
  hexMaterial.normalScale.copy(sourceMaterial.normalScale).multiplyScalar(value)
})

const dispose = manageDemo({ renderer, scene, camera, controls, gui,
  extraMaterials: [sourceMaterial, baselineMaterial, hexMaterial] })
if (import.meta.hot) import.meta.hot.dispose(dispose)

let previousTime = null
renderer.setAnimationLoop(time => {
  const delta = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.1)
  previousTime = time
  if (params.autoRotate) mesh.rotation.y += 0.15 * delta
  controls.update()
  renderer.render(scene, camera)
})
