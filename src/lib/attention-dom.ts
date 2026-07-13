function safeDomSuffix(itemId: string) {
  return itemId.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function attentionRowId(itemId: string) {
  return `attention-row-${safeDomSuffix(itemId)}`
}

export function dailyBriefRowId(itemId: string) {
  return `brief-row-${safeDomSuffix(itemId)}`
}
