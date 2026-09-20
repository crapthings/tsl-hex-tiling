function showError (error) {
  console.error(error)
  const status = document.querySelector('#backend')
  status.textContent = `Demo failed to load: ${error?.message ?? error}. Check WebGPU/WebGL 2 support and reload.`
  status.setAttribute('role', 'alert')
  status.style.whiteSpace = 'normal'
}

window.addEventListener('unhandledrejection', event => showError(event.reason))
window.addEventListener('error', event => showError(event.error ?? event.message))

try {
  if (document.body.dataset.demo === 'pbr') await import('./pbr.js')
  else await import('./index.js')
} catch (error) {
  showError(error)
}
