import { execFileSync, spawnSync } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('TOKSCALE_PACKAGE_ACCEPTANCE_REQUIRES_WINDOWS_X64')

const resourcesPath = resolve('release-desktop', 'win-unpacked', 'resources')
const collectorDirectory = join(resourcesPath, 'tokscale')
const collectorFiles = await readdir(collectorDirectory)
if (collectorFiles.length !== 1 || collectorFiles[0] !== 'tokscale.exe') throw new Error('TOKSCALE_PACKAGE_PLATFORM_ASSETS_INVALID')

const collector = join(collectorDirectory, 'tokscale.exe')
const collectorStat = await stat(collector)
if (!collectorStat.isFile() || collectorStat.size < 1024) throw new Error('TOKSCALE_PACKAGE_COLLECTOR_INVALID')

const notice = await readFile(join(resourcesPath, 'licenses', 'THIRD_PARTY_NOTICES.md'), 'utf8')
if (!notice.includes('Tokscale 4.5.2') || !notice.includes('MIT License') || !notice.includes('Copyright (c) 2025 Junho Yeo')) throw new Error('TOKSCALE_PACKAGE_NOTICE_INVALID')

const version = execFileSync(collector, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
if (!/(?:^|\s)v?4\.5\.2(?:\s|$)/.test(version)) throw new Error('TOKSCALE_PACKAGE_VERSION_UNSUPPORTED')

const acceptance = spawnSync(process.execPath, [resolve('scripts', 'verify-tokscale-windows.mjs')], {
  cwd: process.cwd(),
  env: { ...process.env, FINDMNEMO_ACCEPTANCE_RESOURCES_PATH: resourcesPath },
  encoding: 'utf8',
  timeout: 15 * 60_000,
})
if (acceptance.status !== 0) {
  process.stderr.write(acceptance.stdout ?? '')
  process.stderr.write(acceptance.stderr ?? '')
  throw new Error(`TOKSCALE_PACKAGE_COMPANION_ACCEPTANCE_FAILED_${acceptance.status ?? 'TIMEOUT'}`)
}

const evidence = JSON.parse(acceptance.stdout)
if (evidence.collectorMode !== 'packaged' || evidence.collectorSource !== 'embedded' || evidence.globalTokscalePathExcluded !== true) throw new Error('TOKSCALE_PACKAGE_RESOLUTION_EVIDENCE_INVALID')

console.log(JSON.stringify({
  packagedCollector: 'tokscale/tokscale.exe',
  packagedCollectorBytes: collectorStat.size,
  packagedVersion: '4.5.2',
  licenseNotice: 'present',
  otherPlatformAssets: 0,
  globalTokscaleRequired: false,
  companionAcceptance: evidence,
}, null, 2))
