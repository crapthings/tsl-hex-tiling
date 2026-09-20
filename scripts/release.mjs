import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export function nextVersion (version, bump = 'patch') {
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('Use patch, minor or major.')
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable x.y.z version, received ${version}.`)
  }
  const parts = version.split('.').map(Number)
  const index = { major: 0, minor: 1, patch: 2 }[bump]
  parts[index]++
  parts.fill(0, index + 1)
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version exceeds safe integer range.')
  return parts.join('.')
}

export function release ({ cwd, args = [], run, log = console.log }) {
  const options = args.filter(arg => arg !== '--')
  const dry = options.includes('--dry-run')
  const retry = options.includes('--retry')
  const bumps = options.filter(arg => ['patch', 'minor', 'major'].includes(arg))
  if (options.some(arg => !['patch', 'minor', 'major', '--dry-run', '--retry'].includes(arg)) || bumps.length > 1 || (retry && bumps.length)) {
    throw new Error('Usage: pnpm release [patch|minor|major] [--dry-run], or pnpm release --retry')
  }
  const lock = resolve(cwd, '.release.lock')
  let fd
  try { fd = openSync(lock, 'wx') } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another release is running (.release.lock exists).')
    throw error
  }
  try {
    const manifestPath = resolve(cwd, 'package.json')
    const original = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(original)
    const target = retry ? manifest.version : nextVersion(manifest.version, bumps[0] ?? 'patch')
    const registry = manifest.publishConfig?.registry ?? 'https://registry.npmjs.org/'
    log(`${dry ? 'Dry run' : 'Release'}: ${manifest.name} ${manifest.version} → ${target}`)

    // Fail authentication and quality checks before changing the version.
    if (!dry) run(['whoami', `--registry=${registry}`])
    run(['run', 'prepack'])
    if (readFileSync(manifestPath, 'utf8') !== original) {
      throw new Error('package.json changed during checks; release aborted.')
    }
    if (!dry && !retry) {
      manifest.version = target
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    }
    try {
      // prepack already ran above. Skip Git checks because the version bump
      // intentionally leaves package.json modified; do not create commits/tags.
      run(['publish', '--ignore-scripts', '--no-git-checks', ...(dry ? ['--dry-run'] : [])])
    } catch (error) {
      if (!dry) log(`Publication failed or was not confirmed. Version ${target} is retained. Check npm before retrying with pnpm release --retry; do not blindly bump again.`)
      throw error
    }
    log(dry
      ? `Dry run complete. No upload or version change. The package preview uses ${manifest.version}; a real release will use ${target}.`
      : `Published ${manifest.name}@${target}. Remember to commit the version change.`)
  } finally {
    closeSync(fd)
    unlinkSync(lock)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    release({ cwd, args: process.argv.slice(2), run: args => {
      const pnpm = process.env.npm_execpath
      if (!pnpm) throw new Error('Run this script using pnpm release.')
      const result = spawnSync(process.execPath, [pnpm, ...args], { cwd, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`pnpm ${args[0]} failed (${result.signal ?? result.status}).`)
    } })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
