import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

export interface ScannedSddSpec {
  specId: string
  specTitle?: string
  rawStatus?: string
  artifactRefs: Array<{ kind: string; label: string; path: string }>
}

export interface ScannedSddProject {
  state: 'available' | 'missing' | 'uninitialized'
  specs: ScannedSddSpec[]
}

export async function scanSddProjectRoot(projectRoot: string): Promise<ScannedSddProject> {
  if (!projectRoot || !existsSync(projectRoot)) return { state: 'missing', specs: [] }
  const specsRoot = join(projectRoot, '.ai', 'sdd', 'specs')
  if (!existsSync(specsRoot)) return { state: 'uninitialized', specs: [] }
  const entries = await readdir(specsRoot, { withFileTypes: true })
  const specDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => join(specsRoot, entry.name)).sort()
  if (!specDirs.length) return { state: 'uninitialized', specs: [] }
  const specs: ScannedSddSpec[] = []
  for (const specDir of specDirs) {
    specs.push({
      specId: basename(specDir), specTitle: await readSpecTitle(specDir),
      rawStatus: (await readText(join(specDir, '.status')))?.trim(),
      artifactRefs: await artifactRefs(projectRoot, specDir),
    })
  }
  return { state: 'available', specs }
}

async function readText(filePath: string): Promise<string | undefined> {
  try { return await readFile(filePath, 'utf8') } catch { return undefined }
}

async function readSpecTitle(specDir: string): Promise<string | undefined> {
  for (const fileName of ['requirements.md', 'design.md', 'tasks.md']) {
    const heading = (await readText(join(specDir, fileName)))?.split(/\r?\n/).find((line) => line.startsWith('# '))
    if (heading) return heading.replace(/^#\s+/, '').trim()
  }
  return undefined
}

async function artifactRefs(projectRoot: string, specDir: string): Promise<ScannedSddSpec['artifactRefs']> {
  const refs: ScannedSddSpec['artifactRefs'] = []
  for (const [kind, fileName] of [['status', '.status'], ['requirements', 'requirements.md'], ['design', 'design.md'], ['tasks', 'tasks.md'], ['review', 'review.md']]) {
    const fullPath = join(specDir, fileName)
    if (existsSync(fullPath)) refs.push({ kind, label: fileName, path: relative(projectRoot, fullPath).replace(/\\/g, '/') })
  }
  const steering = join(projectRoot, '.ai', 'steering')
  if (existsSync(steering)) refs.push({ kind: 'steering', label: '.ai/steering', path: relative(projectRoot, steering).replace(/\\/g, '/') })
  return refs
}
