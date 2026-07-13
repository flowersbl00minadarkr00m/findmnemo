export const GMAIL_METADATA_HEADERS = [
  'From', 'To', 'Cc', 'Reply-To', 'Subject', 'Date', 'Message-ID',
  'Auto-Submitted', 'Precedence', 'List-Unsubscribe', 'List-Id',
] as const

export interface GmailHeader { name: string; value: string }
export interface GmailMessage {
  id: string
  internalDate: string
  labelIds?: string[]
  snippet?: string
  payload?: { headers?: GmailHeader[] }
}
export interface GmailThread { id: string; historyId?: string; messages?: GmailMessage[] }
export interface GmailThreadPage { threads: Array<{ id: string }>; nextPageToken?: string; resultSizeEstimate?: number }
export interface GmailProfile { emailAddress: string; historyId: string }

export class GmailApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.name = 'GmailApiError'; this.status = status }
}

export class GmailMetadataClient {
  private readonly accessToken: () => Promise<string>
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string

  constructor(
    accessToken: () => Promise<string>,
    fetcher: typeof fetch = fetch,
    baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me',
  ) {
    this.accessToken = accessToken
    this.fetcher = fetcher
    this.baseUrl = baseUrl
  }

  profile(): Promise<GmailProfile> { return this.get('/profile') }

  listInbox(pageToken?: string): Promise<GmailThreadPage> {
    const params = new URLSearchParams({ labelIds: 'INBOX', maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    return this.get(`/threads?${params}`)
  }

  getThread(threadId: string, signal?: AbortSignal): Promise<GmailThread> {
    const params = new URLSearchParams({ format: 'metadata' })
    for (const header of GMAIL_METADATA_HEADERS) params.append('metadataHeaders', header)
    return this.get(`/threads/${encodeURIComponent(threadId)}?${params}`, signal)
  }

  async historyThreadIds(startHistoryId: string, maxPages = 20): Promise<{ threadIds: string[]; historyId?: string; truncated: boolean }> {
    const ids = new Set<string>()
    let pageToken: string | undefined
    let historyId: string | undefined
    let pages = 0
    do {
      if (++pages > maxPages) return { threadIds: [...ids], historyId, truncated: true }
      const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '500' })
      if (pageToken) params.set('pageToken', pageToken)
      const result = await this.get<{
        history?: Array<{ messagesAdded?: Array<{ message?: { threadId?: string } }> }>
        historyId?: string
        nextPageToken?: string
      }>(`/history?${params}`)
      for (const entry of result.history ?? []) for (const added of entry.messagesAdded ?? []) if (added.message?.threadId) ids.add(added.message.threadId)
      historyId = result.historyId ?? historyId
      pageToken = result.nextPageToken
    } while (pageToken)
    return { threadIds: [...ids], historyId, truncated: false }
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const token = await this.accessToken()
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new GmailApiError(response.status, `Gmail metadata request failed with ${response.status}.`)
    return await response.json() as T
  }
}
