#!/usr/bin/env node
import { beginDesktopPackageRun, completeDesktopPackageRun } from './desktop-package-receipt.mjs'
import { verifyCheckedInWindowsIcon } from './windows-icon.mjs'

const action = process.argv[2]
if (action === 'prepare') {
  const run = await beginDesktopPackageRun()
  const icon = await verifyCheckedInWindowsIcon()
  console.log(JSON.stringify({
    phase: 'prepared',
    runId: run.runId,
    icon: {
      sourceSha256: icon.sourceSha256,
      outputSha256: icon.outputSha256,
      sizes: icon.sizes,
      tools: icon.tools,
    },
  }))
} else if (action === 'complete') {
  const receipt = await completeDesktopPackageRun()
  console.log(JSON.stringify({
    phase: 'completed',
    runId: receipt.runId,
    artifacts: receipt.artifacts,
  }))
} else {
  throw new Error('DESKTOP_PACKAGE_RUN_ACTION_REQUIRED')
}
