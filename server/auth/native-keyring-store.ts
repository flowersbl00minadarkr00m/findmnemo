import type { SecretStore } from './secret-store.js'

export const FINDMNEMO_KEYRING_SERVICE = 'FindMnemo'

export interface NativeKeyringEntry {
  setPassword(value: string): Promise<void>
  getPassword(): Promise<string | undefined>
  deleteCredential(): Promise<boolean>
}

export type NativeKeyringEntryFactory = (service: string, account: string) => NativeKeyringEntry

export class NativeKeyringSecretStore implements SecretStore {
  private readonly createEntry: NativeKeyringEntryFactory

  constructor(createEntry: NativeKeyringEntryFactory) { this.createEntry = createEntry }

  async get(key: string): Promise<string | undefined> { return this.entry(key).getPassword() }
  async set(key: string, value: string): Promise<void> { await this.entry(key).setPassword(value) }
  async delete(key: string): Promise<void> { await this.entry(key).deleteCredential() }
  async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined }

  private entry(key: string): NativeKeyringEntry {
    if (!/^[a-z0-9._-]+$/i.test(key)) throw new Error('Secret key contains unsupported characters.')
    return this.createEntry(FINDMNEMO_KEYRING_SERVICE, key)
  }
}
