import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts'
import type { Ticket } from '../types'
import { SOURCE_HEX, STATUS_LABELS } from '../types'
import type { LLMSource, TicketStatus } from '../types'
import type { CompletedRangePreset } from '../../shared/companion-contract'

interface Props {
  tickets: Ticket[]
  onOpenCompleted?: (preset: CompletedRangePreset) => void
}

const GRID = '#26343d'
const AXIS = '#9aa8b0'
const STATUS_HEX: Record<TicketStatus, string> = {
  'todo': '#ff7a2f',
  'in-progress': '#ff9a5c',
  'done': '#4ade80',
  'blocked': '#ff5f6d',
}

function dayKey(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function Analytics({ tickets, onOpenCompleted }: Props) {
  const [completedRange, setCompletedRange] = useState<CompletedRangePreset>('30d')
  const completionStart = useMemo(() => { const date = new Date(); if (completedRange === '12mo') date.setMonth(date.getMonth() - 12); else date.setDate(date.getDate() - Number(completedRange.replace('d', ''))); return date.getTime() }, [completedRange])
  const throughput = useMemo(() => {
    const days: { day: string; created: number; completed: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      const created = tickets.filter((t) => {
        const c = new Date(t.createdAt)
        return c >= d && c < next
      }).length
      const completed = tickets.filter((t) => {
        if (t.status !== 'done' || !t.completedAt) return false
        const u = new Date(t.completedAt)
        return u >= d && u < next
      }).length
      days.push({ day: dayKey(d), created, completed })
    }
    return days
  }, [tickets])

  const bySource = useMemo(() => {
    const sources: LLMSource[] = ['Pi', 'Codex', 'Claude Cowork']
    return sources.map((s) => ({
      name: s === 'Claude Cowork' ? 'Claude' : s,
      value: tickets.filter((t) => t.source === s).length,
      hex: SOURCE_HEX[s],
    })).filter((d) => d.value > 0)
  }, [tickets])

  const byStatus = useMemo(() => {
    const statuses: TicketStatus[] = ['todo', 'in-progress', 'done', 'blocked']
    return statuses.map((s) => ({
      name: STATUS_LABELS[s],
      count: tickets.filter((t) => t.status === s).length,
      hex: STATUS_HEX[s],
    }))
  }, [tickets])

  const cycleStats = useMemo(() => {
    const done = tickets.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= completionStart)
    if (done.length === 0) return { avg: '—', fastest: '—', throughputWk: 0 }
    const hours = done.map((t) => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / 3600_000)
    const avg = hours.reduce((a, b) => a + b, 0) / hours.length
    const fastest = Math.min(...hours)
    const throughputWk = done.length
    const fmt = (h: number) => h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`
    return { avg: fmt(avg), fastest: fmt(fastest), throughputWk }
  }, [completionStart, tickets])

  const decisions = useMemo(() => {
    const all = tickets.flatMap((t) => t.decisionLog)
    return {
      total: all.length,
      oneWay: all.filter((d) => d.gateType === 'one-way').length,
    }
  }, [tickets])

  const tooltipStyle = {
    backgroundColor: '#141d23',
    border: '1px solid #26343d',
    borderRadius: 2,
    fontSize: 12,
    color: '#f4f7f8',
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="hud-label">Completed-work period</p><p className="mt-1 text-xs text-faint">Cycle time and completion totals use explicit completion timestamps.</p></div><div className="flex flex-wrap gap-2">{(['7d', '30d', '90d', '12mo'] as const).map((value) => <button key={value} type="button" aria-pressed={completedRange === value} onClick={() => setCompletedRange(value)} className={`rounded-sm border px-3 py-2 text-xs ${completedRange === value ? 'border-sync bg-sync/15 text-sync' : 'border-line text-mut'}`}>{value === '12mo' ? '12 months' : value.replace('d', ' days')}</button>)}</div></div>
      {tickets.length === 0 && <div className="rounded-sm border border-memory/40 bg-memory/10 p-4 text-sm text-mut" role="status"><p className="font-semibold text-ink">Work Metrics needs operational ticket history</p><p className="mt-1">Create or reconcile tickets to populate workload and throughput. Cycle time requires completed tickets, and decision totals require ticket decision-log entries. Model tokens and cost are shown separately under Model Usage.</p></div>}
      {tickets.length > 0 && !tickets.some((ticket) => ticket.status === 'done') && <div className="rounded-sm border border-line p-3 text-sm text-mut" role="status">Cycle time and completed-work metrics will appear after at least one ticket reaches Done.</div>}
      {/* KPI row */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <Kpi label="Avg Cycle Time" value={cycleStats.avg} sub="creation → done" />
        <Kpi label={`Completed (${completedRange === '12mo' ? '12mo' : completedRange})`} value={String(cycleStats.throughputWk)} sub="Open matching history" onClick={onOpenCompleted ? () => onOpenCompleted(completedRange) : undefined} />
        <Kpi label="Decisions Logged" value={String(decisions.total)} sub={`${decisions.oneWay} one-way gates`} />
        <Kpi label="Fastest Resolution" value={cycleStats.fastest} sub="best cycle time" />
      </motion.div>

      {/* Throughput */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="panel rounded-sm p-5"
      >
        <p className="hud-label">Throughput — last 14 days</p>
        <p className="text-[11px] text-faint mb-4 mt-1">Tickets created vs completed per day, across all agents</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={throughput} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff7a2f" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#ff7a2f" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#9aa8b0' }} />
              <Area type="monotone" dataKey="created" name="Created" stroke="#ff7a2f" strokeWidth={2} fill="url(#gCreated)" />
              <Area type="monotone" dataKey="completed" name="Completed" stroke="#4ade80" strokeWidth={2} fill="url(#gCompleted)" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By agent */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="panel rounded-sm p-5"
        >
          <p className="hud-label">Workload by Agent</p>
          <p className="text-[11px] text-faint mb-2 mt-1">Ticket ownership distribution</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={bySource}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="58%"
                  outerRadius="85%"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {bySource.map((d) => <Cell key={d.name} fill={d.hex} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* By status */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="panel rounded-sm p-5"
        >
          <p className="hud-label">Pipeline by Status</p>
          <p className="text-[11px] text-faint mb-2 mt-1">Where work sits right now</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#26343d', opacity: 0.6 }} />
                <Bar dataKey="count" name="Tickets" radius={[6, 6, 0, 0]}>
                  {byStatus.map((d) => <Cell key={d.name} fill={d.hex} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick?: () => void }) {
  const content = <>
      <p className="hud-label">{label}</p>
      <p className="text-2xl font-mono font-bold text-ink mt-1 tabular-nums">{value}</p>
      <p className="text-[11px] text-faint mt-0.5">{sub}</p>
    </>
  return onClick ? <button type="button" onClick={onClick} className="panel rounded-sm p-4 text-left hover:border-sync/60">{content}</button> : <div className="panel rounded-sm p-4">{content}</div>
}
