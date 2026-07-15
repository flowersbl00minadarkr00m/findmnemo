import { createPlatformSecretStore } from '../dist-companion/server/auth/platform-secret-store.js'
import { OpenRouterOAuthService } from '../dist-companion/server/routing/openrouter-oauth-service.js'

if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Run this command in an interactive local terminal.')
const capability = await createPlatformSecretStore()
if (!capability.store) throw new Error(capability.capability.guidance)
process.stdout.write('Paste your OpenRouter key (input is hidden): ')
process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
let key = ''
await new Promise((resolve, reject) => {
  const onData = (chunk) => {
    if (chunk === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return }
    if (chunk === '\r' || chunk === '\n') { cleanup(); resolve(); return }
    if (chunk === '\u007f' || chunk === '\b') key = key.slice(0, -1)
    else if ([...chunk].every((character) => character.charCodeAt(0) >= 32)) key += chunk
  }
  const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n') }
  process.stdin.on('data', onData)
})
await new OpenRouterOAuthService(capability.store).storeExistingKey(key.trim())
key = ''
process.stdout.write('OpenRouter is stored in your operating-system protected FindMnemo credential store.\n')
