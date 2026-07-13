import { readFile } from 'node:fs/promises'

const [main, preload, html, builder, contract] = await Promise.all([
  readFile(new URL('../desktop/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/preload.cts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop.html', import.meta.url), 'utf8'),
  readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
  readFile(new URL('../shared/lifecycle-contract.ts', import.meta.url), 'utf8'),
])

const LIFECYCLE_CHANNELS = [...contract.matchAll(/'findmnemo:lifecycle:[^']+'/g)].map((match) => match[0].slice(1, -1))

const checks = [
  [main.includes('requestSingleInstanceLock'), 'desktop must enforce a single application owner'],
  [main.includes("nodeIntegration: false"), 'renderer must not have Node integration'],
  [main.includes('contextIsolation: true'), 'renderer must use context isolation'],
  [main.includes('sandbox: true'), 'renderer must use sandboxing'],
  [main.includes('registerSchemesAsPrivileged') && main.includes("protocol.handle('findmnemo'") && main.includes("findmnemo://app/desktop.html"), 'renderer must use the registered bundled local scheme'],
  [!main.includes('loadFile('), 'renderer must not rely on privileged file protocol loading'],
  [main.includes("action: 'deny'"), 'new renderer windows must be denied'],
  [main.includes('setPermissionCheckHandler(() => false)') && main.includes('setPermissionRequestHandler'), 'renderer permissions must be denied'],
  [main.includes("'will-attach-webview'"), 'webview attachment must be denied'],
  [main.includes('assertTrustedSender'), 'IPC must validate its sender'],
  [preload.includes('contextBridge.exposeInMainWorld'), 'preload must expose a narrow bridge'],
  [![...preload.matchAll(/import (?!type).*from ['"]\.\./g)].length, 'sandboxed preload must not import application-local runtime modules'],
  [LIFECYCLE_CHANNELS.every((channel) => preload.includes(channel)), 'preload channel mirror must match the shared closed contract'],
  [!preload.includes('process.env'), 'preload must not expose environment variables'],
  [html.includes("connect-src 'none'"), 'local renderer CSP must deny network access'],
  [html.includes("object-src 'none'"), 'local renderer CSP must deny plugins'],
  [builder.includes('perMachine: false'), 'installer must be per-user'],
  [builder.includes('allowElevation: false'), 'normal install must not elevate'],
  [builder.includes('arch: [x64]'), 'MVP package must target Windows x64'],
  [builder.includes('runAsNode: false') && builder.includes('enableNodeOptionsEnvironmentVariable: false') && builder.includes('enableNodeCliInspectArguments: false'), 'dangerous Electron runtime fuses must be disabled'],
  [builder.includes('enableEmbeddedAsarIntegrityValidation: true') && builder.includes('onlyLoadAppFromAsar: true'), 'packaged code must use embedded ASAR integrity and ASAR-only loading'],
  [builder.includes('grantFileProtocolExtraPrivileges: false'), 'file protocol extra privileges must be disabled'],
  [main.includes('assertBundledRendererSender'), 'runtime IPC sender validation must use the tested exact-URL boundary'],
  [contract.includes('prepare-uninstall') && contract.includes('launch-uninstaller'), 'uninstall renderer surface must remain a closed plan/launch contract'],
  [contract.includes('TRUSTED_TARGETS') && ['hosted-app', 'local-app', 'support-docs'].every((target) => contract.includes(`'${target}'`)), 'trusted external targets must be closed'],
]

for (const [condition, message] of checks) {
  if (!condition) throw new Error(`Desktop boundary check failed: ${message}`)
}

console.log(`Desktop boundary checks passed (${checks.length} assertions).`)
