import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { release, nextVersion } from '../scripts/release.mjs'

test('release version increments', () => {
  assert.equal(nextVersion('0.1.0'), '0.1.1')
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0')
  assert.throws(() => nextVersion('1.2.3-beta.1'))
  assert.throws(() => nextVersion('1.2.3', 'oops'))
})

function fixture (fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'hex-release-test-'))
  const path = join(cwd, 'package.json')
  writeFileSync(path, JSON.stringify({ name: 'test-only', version: '0.1.0' }))
  try { fn(cwd, () => JSON.parse(readFileSync(path)).version) }
  finally { rmSync(cwd, { recursive: true, force: true }) }
}

test('checks precede bump and publish; dry run never changes version', () => {
  for (const dry of [false, true]) fixture((cwd, version) => {
    const calls = []
    release({ cwd, args: dry ? ['--dry-run'] : [], log () {}, run (args) {
      calls.push(args)
      assert.equal(version(), args[0] === 'publish' && !dry ? '0.1.1' : '0.1.0')
    } })
    assert.deepEqual(calls.map(args => args[0]), dry ? ['run', 'publish'] : ['whoami', 'run', 'publish'])
    assert.equal(calls.at(-1).includes('--dry-run'), dry)
    assert.equal(version(), dry ? '0.1.0' : '0.1.1')
    assert.equal(existsSync(join(cwd, '.release.lock')), false)
  })
})

test('check failure does not bump; publish failure preserves version for retry', () => {
  for (const stage of ['whoami', 'run', 'publish']) fixture((cwd, version) => {
    assert.throws(() => release({ cwd, log () {}, run (args) {
      if (args[0] === stage) throw new Error('simulated failure')
    } }))
    assert.equal(version(), stage === 'publish' ? '0.1.1' : '0.1.0')
    assert.equal(existsSync(join(cwd, '.release.lock')), false)
    if (stage === 'publish') {
      release({ cwd, args: ['--retry'], log () {}, run () {} })
      assert.equal(version(), '0.1.1')
    }
  })
})
