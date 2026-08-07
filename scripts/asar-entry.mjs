export function indexAsarEntries(rawNames) {
  const normalizedNames = []
  const byNormalizedName = new Map()

  for (const rawName of rawNames) {
    if (typeof rawName !== 'string' || !rawName.length) throw new Error('ASAR_ENTRY_NAME_INVALID')
    const normalizedName = rawName.replaceAll('\\', '/')
    if (!normalizedName.startsWith('/')) throw new Error('ASAR_ENTRY_ROOT_INVALID')
    if (byNormalizedName.has(normalizedName)) throw new Error(`ASAR_ENTRY_NORMALIZED_DUPLICATE:${normalizedName}`)

    normalizedNames.push(normalizedName)
    byNormalizedName.set(normalizedName, {
      rawName,
      normalizedName,
      // listPackage roots names with one platform separator; extractFile expects
      // the same platform-native path without that archive-root marker.
      extractionPath: rawName.slice(1),
    })
  }

  return { normalizedNames, byNormalizedName }
}
