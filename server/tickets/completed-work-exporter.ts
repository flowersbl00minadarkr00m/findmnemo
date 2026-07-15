import type { CompletedWorkQueryDto } from '../../shared/companion-contract.js'
import type { CompletedWorkQueryService } from './completed-work-query-service.js'

export class CompletedWorkExporter {
  private readonly queries: CompletedWorkQueryService
  constructor(queries: CompletedWorkQueryService) { this.queries = queries }

  export(input: CompletedWorkQueryDto, format: 'json' | 'csv'): { contentType: string; body: string; fileName: string } {
    const result = this.queries.query({ ...input, cursor: undefined }, 10_001)
    if (result.records.length > 10_000 || result.nextCursor) throw new Error('COMPLETED_EXPORT_TOO_LARGE')
    if (format === 'json') return { contentType: 'application/json; charset=utf-8', body: JSON.stringify(result, null, 2), fileName: 'findmnemo-completed-work.json' }
    const columns = ['id', 'title', 'source', 'projectLabel', 'completedAt', 'status'] as const
    const lines = [columns.join(','), ...result.records.map((record) => columns.map((column) => csv(record[column])).join(','))]
    return { contentType: 'text/csv; charset=utf-8', body: lines.join('\r\n'), fileName: 'findmnemo-completed-work.csv' }
  }
}

function csv(value: string | null): string { if (value === null) return ''; const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
