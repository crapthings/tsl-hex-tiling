// Keep repeated Vite edits from accumulating canvases, listeners and GPU objects.
export function manageDemo ({ renderer, scene, camera, controls, gui, extraMaterials = [] }) {
  const resize = () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  }
  window.addEventListener('resize', resize)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    renderer.setAnimationLoop(null)
    window.removeEventListener('resize', resize)
    window.removeEventListener('pagehide', onPageHide)
    controls.dispose()
    gui.destroy()
    const resources = new Set(extraMaterials)
    scene.traverse(object => {
      if (object.geometry) resources.add(object.geometry)
      for (const material of [object.material].flat()) {
        if (material) resources.add(material)
      }
      object.shadow?.dispose()
    })
    for (const resource of resources) {
      for (const value of Object.values(resource)) {
        if (value?.isTexture) resources.add(value)
      }
    }
    for (const resource of resources) resource.dispose()
    renderer.domElement.remove()
    void renderer.dispose()
  }
  // A page retained in the back/forward cache must remain usable on return.
  const onPageHide = event => { if (!event.persisted) dispose() }
  window.addEventListener('pagehide', onPageHide)
  return dispose
}
