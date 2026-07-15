import type { CompletedRangeIntentDto, CompletedWorkQueryDto } from '../../shared/companion-contract'

export interface ResolvedCompletedRange { query: CompletedWorkQueryDto; startDate: string; endDate: string }

export function resolveCompletedRange(intent: CompletedRangeIntentDto, options: { now?: Date; timeZone?: string } = {}): ResolvedCompletedRange {
  const timeZone = intent.kind === 'custom' ? intent.timeZone : options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  assertTimeZone(timeZone)
  let startDate: string
  let endDate: string
  if (intent.kind === 'custom') {
    assertDate(intent.startDate); assertDate(intent.endDate)
    startDate = intent.startDate; endDate = intent.endDate
  } else {
    const today = formatLocalDate(options.now ?? new Date(), timeZone)
    endDate = today
    startDate = intent.value === '12mo' ? addMonths(today, -12) : addDays(today, -(Number(intent.value.slice(0, -1)) - 1))
  }
  if (startDate > endDate) throw new Error('COMPLETED_RANGE_INVALID')
  const startInclusive = localMidnightUtc(startDate, timeZone)
  const endExclusive = localMidnightUtc(addDays(endDate, 1), timeZone)
  if (Date.parse(endExclusive) - Date.parse(startInclusive) > 367 * 86_400_000) throw new Error('COMPLETED_RANGE_INVALID')
  return { query: { startInclusive, endExclusive, timeZone }, startDate, endDate }
}

function formatLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
function localMidnightUtc(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const target = Date.UTC(year, month - 1, day)
  let guess = target
  for (let index = 0; index < 4; index += 1) {
    const zoneName = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(guess)).find((part) => part.type === 'timeZoneName')?.value
    const match = zoneName?.match(/^GMT([+-])(\d{2}):(\d{2})$/)
    if (zoneName !== 'GMT' && !match) throw new Error('COMPLETED_RANGE_INVALID')
    const offset = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : 0
    const next = target - offset
    if (next === guess) break
    guess = next
  }
  return new Date(guess).toISOString()
}
function addDays(date: string, days: number): string { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10) }
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}
function assertDate(value: string): void { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('COMPLETED_RANGE_INVALID') }
function assertTimeZone(value: string): void { try { new Intl.DateTimeFormat('en', { timeZone: value }) } catch { throw new Error('COMPLETED_RANGE_INVALID') } }
