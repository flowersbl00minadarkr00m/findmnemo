import type {
  LocalSourceAdapter,
  SourceCheckContext,
  SourceDescriptor,
  SourceRecordBatch,
} from '../companion-contract.js'

export function createSourceDescriptor(
  overrides: Partial<SourceDescriptor> = {},
): SourceDescriptor {
  return {
    id: 'agent-ledger',
    label: 'Test agent ledger',
    adapterVersion: '1.0.0',
    enabled: true,
    policy: 'auto-create',
    ...overrides,
  }
}

export class FakeSourceAdapter implements LocalSourceAdapter {
  readonly descriptor: SourceDescriptor
  readonly contexts: SourceCheckContext[] = []
  private readonly batches: readonly SourceRecordBatch[]

  constructor(
    batches: readonly SourceRecordBatch[],
    descriptor: SourceDescriptor = createSourceDescriptor(),
  ) {
    this.batches = batches
    this.descriptor = descriptor
  }

  async *check(context: SourceCheckContext): AsyncIterable<SourceRecordBatch> {
    this.contexts.push(context)
    for (const batch of this.batches) yield batch
  }
}
