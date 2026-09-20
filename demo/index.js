import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import GUI from 'lil-gui'
import { applyHexTiling } from '../src/index.ts'
import { manageDemo } from './lifecycle.js'

const app = document.querySelector('#app')
// `?webgl` is useful for validating the same TSL graph through the fallback
// backend on machines or CI runners without a WebGPU adapter.
const forceWebGL = new URLSearchParams(location.search).has('webgl')
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
app.append(renderer.domElement)
await renderer.init()

document.querySelector('#backend').textContent = renderer.backend.isWebGPUBackend ? 'WebGPU / WGSL' : 'WebGL 2 fallback / GLSL'

const scene = new THREE.Scene()
scene.background = new THREE.Color('#101419')
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 5.8, 10)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.35, 0)
controls.enableDamping = true

const map = await new THREE.TextureLoader().loadAsync('/textures/mossy-stone-seamless-512.png')
map.colorSpace = THREE.SRGBColorSpace
map.wrapS = map.wrapT = THREE.RepeatWrapping
map.repeat.set(9, 9)
map.anisotropy = 8
map.updateMatrix()
const geometry = new THREE.SphereGeometry(2.2, 192, 96)

const baseline = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: 0.82 })
baseline.colorNode = texture(map)
const left = new THREE.Mesh(geometry, baseline)
left.position.x = -2.45
scene.add(left)

const tiled = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: 0.82 })
const { uniforms } = applyHexTiling(tiled, { map }, {
  // Color contrast correction is optional and can clip high-contrast colors.
  useContrastCorrectedBlending: false
})
const right = new THREE.Mesh(geometry, tiled)
right.position.x = 2.45
scene.add(right)

const key = new THREE.DirectionalLight('#fff3d8', 4.2)
key.position.set(4, 7, 5)
scene.add(key)
const fill = new THREE.DirectionalLight('#8bb8ff', 1.4)
fill.position.set(-5, 2, -4)
scene.add(fill)

const params = {
  autoRotate: true,
  patchScale: uniforms.patchScale.value,
  blendExponent: uniforms.textureSampleCoefficientExponent.value,
  contrastCorrection: uniforms.useContrastCorrectedBlending.value
}

const gui = new GUI({ title: 'TSL Hex Tiling · Basic' })
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

const dispose = manageDemo({ renderer, scene, camera, controls, gui, extraMaterials: [map] })
if (import.meta.hot) import.meta.hot.dispose(dispose)

let previousTime = null
renderer.setAnimationLoop(time => {
  const delta = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.1)
  previousTime = time
  if (params.autoRotate) {
    left.rotation.y += 0.09 * delta
    right.rotation.y += 0.09 * delta
  }
  controls.update()
  renderer.render(scene, camera)
})
