import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  createMcpPackageRuntimeEnvironment,
} from './mcp-package-runtime-environment.mjs'

const verifierPath = resolve('scripts', 'verify-mcp-package-windows.mjs')

test('preserves USERPROFILE while isolating application data, temp, and HOME', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'findmnemo-verifier-environment-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))

  const parentEnvironment = {
    USERPROFILE: String.raw`C:\Users\verifier-parent`,
    APPDATA: String.raw`C:\Users\verifier-parent\AppData\Roaming`,
    LOCALAPPDATA: String.raw`C:\Users\verifier-parent\AppData\Local`,
    TEMP: String.raw`C:\Users\verifier-parent\AppData\Local\Temp`,
    TMP: String.raw`C:\Users\verifier-parent\AppData\Local\Temp`,
    HOME: String.raw`C:\Users\verifier-parent`,
    PATH: String.raw`C:\Windows\System32`,
    FINDMNEMO_ACTIVITY_ACCEPTANCE: 'parent-value',
  }
  const isolatedLocalAppData = join(temporaryRoot, 'LocalAppData')

  const environment = createMcpPackageRuntimeEnvironment({
    parentEnvironment,
    temporaryRoot,
    phase: 'gui-first',
    localAppData: isolatedLocalAppData,
  })

  assert.equal(environment.USERPROFILE, parentEnvironment.USERPROFILE)
  assert.equal(environment.LOCALAPPDATA, isolatedLocalAppData)
  assert.equal(environment.APPDATA, join(temporaryRoot, 'gui-first', 'Roaming'))
  assert.equal(environment.TEMP, join(temporaryRoot, 'gui-first', 'Temp'))
  assert.equal(environment.TMP, join(temporaryRoot, 'gui-first', 'Temp'))
  assert.equal(environment.HOME, join(temporaryRoot, 'gui-first', 'Home'))
  assert.notEqual(environment.APPDATA, parentEnvironment.APPDATA)
  assert.notEqual(environment.LOCALAPPDATA, parentEnvironment.LOCALAPPDATA)
  assert.notEqual(environment.TEMP, parentEnvironment.TEMP)
  assert.notEqual(environment.TMP, parentEnvironment.TMP)
  assert.notEqual(environment.HOME, parentEnvironment.HOME)
  assert.equal(environment.PATH, parentEnvironment.PATH)
  assert.equal(environment.FINDMNEMO_ACTIVITY_ACCEPTANCE, '')
  assert.equal('ELECTRON_DISABLE_GPU' in environment, false)
  assert.equal('LIBGL_ALWAYS_SOFTWARE' in environment, false)

  const verifierSource = await readFile(verifierPath, 'utf8')
  for (const forbiddenFlag of [
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--use-angle',
    '--use-gl',
  ]) {
    assert.equal(
      verifierSource.includes(forbiddenFlag),
      false,
      `The package verifier must not introduce Chromium GPU flag ${forbiddenFlag}.`,
    )
  }
})

test('fails closed when the parent USERPROFILE is unavailable', () => {
  assert.throws(
    () => createMcpPackageRuntimeEnvironment({
      parentEnvironment: {},
      temporaryRoot: String.raw`C:\isolated`,
      phase: 'gui-first',
      localAppData: String.raw`C:\isolated\LocalAppData`,
    }),
    /MCP_PACKAGE_USERPROFILE_UNAVAILABLE/,
  )
})

test('preserved USERPROFILE reaches minimal Electron readiness on Windows', {
  skip: process.platform !== 'win32',
  timeout: 15_000,
}, async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'findmnemo-electron-readiness-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const mainPath = join(temporaryRoot, 'main.cjs')
  await writeFile(mainPath, [
    "const { app } = require('electron')",
    'const deadline = setTimeout(() => app.exit(2), 5000)',
    'app.whenReady().then(() => {',
    '  clearTimeout(deadline)',
    "  process.stdout.write('ELECTRON_READY\\n', () => app.exit(0))",
    '})',
    '',
  ].join('\n'))

  const environment = createMcpPackageRuntimeEnvironment({
    parentEnvironment: process.env,
    temporaryRoot,
    phase: 'minimal-electron',
    localAppData: join(temporaryRoot, 'LocalAppData'),
  })
  assert.equal(environment.USERPROFILE, process.env.USERPROFILE)

  const child = spawn(
    resolve('node_modules', 'electron', 'dist', 'electron.exe'),
    [mainPath],
    {
      cwd: temporaryRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', resolveExit)
  })

  assert.equal(exitCode, 0, stderr)
  assert.equal(stdout.trim(), 'ELECTRON_READY')
})
