import type { CompanionReasonCode } from '../../shared/companion-contract.js'
import type { GmailMessage, GmailThread } from './gmail-client.js'

export interface CandidateClassification {
  eligible: boolean
  latestMessage?: GmailMessage
  sender: string
  subject: string
  receivedAt: string
  snippet: string
  reasonCodes: CompanionReasonCode[]
}

export function classifyGmailThread(
  thread: GmailThread,
  userAliases: readonly string[],
  prior: { state?: string; linked?: boolean } = {},
): CandidateClassification {
  const messages = [...(thread.messages ?? [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate))
  const meaningful = messages.filter((message) => !hasAnyLabel(message, ['DRAFT', 'SPAM', 'TRASH']))
  const latest = meaningful.at(-1)
  if (!latest) return excluded('DRAFT_SPAM_OR_TRASH')
  const headers = headerMap(latest)
  const sender = headers.get('from') ?? ''
  const subject = headers.get('subject') ?? '(no subject)'
  const receivedAt = new Date(Number(latest.internalDate)).toISOString()
  const snippet = [...(latest.snippet ?? '')].slice(0, 240).join('')

  if (prior.linked) return { ...excluded('ALREADY_LINKED'), latestMessage: latest, sender, subject, receivedAt, snippet }
  if (prior.state === 'dismissed') return { ...excluded('ALREADY_DISMISSED'), latestMessage: latest, sender, subject, receivedAt, snippet }
  if (isUserAddress(sender, userAliases)) return { ...excluded('LATEST_FROM_SELF'), latestMessage: latest, sender, subject, receivedAt, snippet }
  if (isAutomated(headers, sender)) return { ...excluded('AUTOMATED_MESSAGE'), latestMessage: latest, sender, subject, receivedAt, snippet }

  return {
    eligible: true,
    latestMessage: latest,
    sender,
    subject,
    receivedAt,
    snippet,
    reasonCodes: ['LATEST_FROM_OTHER', 'NO_LATER_SELF_REPLY', 'NOT_AUTOMATED'],
  }
}

function excluded(reason: CompanionReasonCode): CandidateClassification {
  return { eligible: false, sender: '', subject: '', receivedAt: '', snippet: '', reasonCodes: [reason] }
}

function headerMap(message: GmailMessage): Map<string, string> {
  return new Map((message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]))
}

function hasAnyLabel(message: GmailMessage, labels: string[]): boolean {
  return message.labelIds?.some((label) => labels.includes(label)) ?? false
}

function isUserAddress(value: string, aliases: readonly string[]): boolean {
  const normalized = value.toLowerCase()
  return aliases.some((alias) => normalized.includes(alias.trim().toLowerCase()))
}

function isAutomated(headers: Map<string, string>, sender: string): boolean {
  const autoSubmitted = headers.get('auto-submitted')?.toLowerCase()
  const precedence = headers.get('precedence')?.toLowerCase()
  return (Boolean(autoSubmitted) && autoSubmitted !== 'no')
    || ['bulk', 'list', 'junk'].includes(precedence ?? '')
    || headers.has('list-unsubscribe')
    || headers.has('list-id')
    || /(?:no-?reply|do-?not-?reply)@/i.test(sender)
}
