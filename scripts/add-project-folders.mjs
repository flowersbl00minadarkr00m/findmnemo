import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { openFindMnemoDatabase } from '../dist-companion/server/db/database.js'
import { OperationalRepository } from '../dist-companion/server/db/operational-repository.js'
import { ProjectFolderDetector } from '../dist-companion/server/onboarding/project-folder-detector.js'
import { ProjectFolderRepository } from '../dist-companion/server/onboarding/project-folder-repository.js'
import { ProjectFolderService } from '../dist-companion/server/onboarding/project-folder-service.js'

const paths = process.argv.slice(2)
if (!paths.length) {
  stdout.write('Usage: npm run folders:add -- "C:\\path\\to\\project" [more folders]\n')
  process.exitCode = 1
} else {
  const database = await openFindMnemoDatabase()
  try {
    const service = new ProjectFolderService(new ProjectFolderRepository(database.db), new ProjectFolderDetector(), new OperationalRepository(database.db))
    const preview = await service.preview(paths)
    if (preview.state !== 'ready' || !preview.previewId) throw new Error(preview.errorCode ?? 'No folders selected')
    stdout.write(`${preview.items.map((item) => `- ${item.label}: ${item.detectedKind}${item.warning ? ` (${item.warning})` : ''}`).join('\n')}\n`)
    const prompt = createInterface({ input: stdin, output: stdout })
    const answer = await prompt.question('Connect these folders? [y/N] ')
    prompt.close()
    if (!/^y(es)?$/i.test(answer.trim())) stdout.write('No changes made.\n')
    else {
      const result = service.commit(preview.previewId, true)
      if (!result.committed) throw new Error(result.errorCode ?? 'Folders were not connected')
      stdout.write(`${result.folderIds.length} folder configuration(s) connected.\n`)
    }
  } finally { database.close() }
}
