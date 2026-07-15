import { readFile } from 'node:fs/promises'

const [main, preload, html, builder, contract, packageDocument, notices, tokscaleResolver, activityInstaller, activitySanitizer, activityLauncher, activityReporterCommand, uninstall] = await Promise.all([
  readFile(new URL('../desktop/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/preload.cts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop.html', import.meta.url), 'utf8'),
  readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
  readFile(new URL('../shared/lifecycle-contract.ts', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
  readFile(new URL('../server/usage/tokscale-executable.ts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/agent-activity/integration-installer.ts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/agent-activity/findmnemo-activity-entry.js', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/agent-activity/findmnemo-activity-launch.cmd', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/agent-activity/reporter-command.ts', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/lifecycle/uninstall.ts', import.meta.url), 'utf8'),
])

const packageJson = JSON.parse(packageDocument)

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
  [packageJson.dependencies?.['@tokscale/cli'] === '4.5.2', 'Tokscale collector dependency must remain exactly pinned'],
  [builder.includes('node_modules/@tokscale/cli-win32-x64-msvc/bin/tokscale.exe') && builder.includes('to: tokscale/tokscale.exe'), 'Windows x64 package must include only its qualified Tokscale collector asset'],
  [builder.includes('THIRD_PARTY_NOTICES.md') && notices.includes('Tokscale 4.5.2') && notices.includes('MIT License') && notices.includes('Copyright (c) 2025 Junho Yeo'), 'Tokscale MIT notice must ship with the package'],
  [!tokscaleResolver.includes('process.env.PATH') && !/\b(?:npm|npx|pnpm|yarn|bun)\s+(?:install|add)\b/.test(tokscaleResolver), 'collector resolution must not trust ambient PATH or install packages at runtime'],
  [activityInstaller.includes("const OWNER = 'findmnemo-agent-activity-v1'") && activityInstaller.includes('atomicWrite') && activityInstaller.includes('INTEGRATION_TARGET_NOT_OWNED'), 'agent activity setup must use owned markers, atomic writes, and scoped mutation'],
  [!activityInstaller.includes('x-findmnemo-activity-token') && !activityInstaller.includes('activityTokenReference'), 'agent hook configuration must not embed the activity token'],
  [builder.includes('findmnemo-activity-entry.js') && builder.includes('findmnemo-activity-launch.cmd'), 'Windows packages must include the owned activity sanitizer and lightweight launcher'],
  [activityReporterCommand.includes('cscript.exe //nologo //E:JScript') && activityReporterCommand.includes('findmnemo-activity-entry.js'), 'packaged activity setup must invoke the fast owned sanitizer'],
  [activitySanitizer.includes("['hook_event_name', 'session_id', 'model', 'generation', 'task_id', 'task_subject', 'notification_type']") && activitySanitizer.includes('parseTopLevelObject') && !/(?:transcript_path|last_assistant_message|tool_input)/i.test(activitySanitizer), 'activity sanitizer must parse only its closed safe-field allowlist'],
  [activitySanitizer.includes("new ActiveXObject('WScript.Shell').Run(command, 0, false)") && activitySanitizer.includes('<NUL >NUL 2>&1') && !/(?:token|secret|credential)/i.test(activitySanitizer), 'activity sanitizer must detach all delivery handles without waiting or embedding credentials'],
  [activityLauncher.includes('start "" /b "%ComSpec%"') && activityLauncher.includes('if "%~1"=="--deliver"') && activityLauncher.includes('FindMnemo Companion.exe') && !/(?:token|secret|credential)/i.test(activityLauncher), 'lightweight launcher must defer the packaged reporter behind a command-process hop without embedding credentials'],
  [activityInstaller.includes('child.unref()') && !activityInstaller.includes('await new Promise<void>') && activityInstaller.includes('timeout: 1'), 'Pi and installed command hooks must use bounded fire-and-forget reporting'],
  [uninstall.includes('removeLifecycleIntegrations') && uninstall.indexOf('removeLifecycleIntegrations') < uninstall.indexOf("join(this.dataRoot, 'updates')"), 'uninstall must remove owned integrations before touching retained data/cache'],
]

for (const [condition, message] of checks) {
  if (!condition) throw new Error(`Desktop boundary check failed: ${message}`)
}

console.log(`Desktop boundary checks passed (${checks.length} assertions).`)
