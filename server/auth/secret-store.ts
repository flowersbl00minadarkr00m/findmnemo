export interface SecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  has(key: string): Promise<boolean>
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: string) { this.values.set(key, value) }
  async delete(key: string) { this.values.delete(key) }
  async has(key: string) { return this.values.has(key) }
}
