import { useEffect, useState } from 'react'
import type { LLMSource, AgentState, View } from '../types'
import { SOURCE_TEXT_COLORS, AGENT_STATE_COLORS } from '../types'

interface AgentInfo {
  agent: LLMSource
  state: AgentState
  currentTask: string
  label: string
  icon: string
}

interface Props {
  agents: AgentInfo[]
  activeView: View
  onNavigate: (view: View) => void
  ticketCount: number
  emailCount: number
}

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: 'operations', label: 'Operations Desk', icon: 'O' },
  { id: 'brief', label: 'Daily Brief', icon: 'B' },
  { id: 'tickets', label: 'Tickets', icon: 'T' },
  { id: 'sdd', label: 'Projects/SDD', icon: 'S' },
  { id: 'routing', label: 'Model Routing', icon: 'R' },
  { id: 'analytics', label: 'Analytics', icon: 'A' },
  { id: 'emails', label: 'Emails', icon: 'E' },
]

function ClownfishDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <clipPath id="cfBody"><ellipse cx="29" cy="33" rx="20" ry="12.5" /></clipPath>
        <symbol id="cf" viewBox="0 0 64 64">
          <path d="M20 23 Q30 13 41 21 L37 25 Q30 20 24 25 Z" fill="#E8641C" />
          <path d="M25 44 Q30 51 37 46 L34 41 Q30 45 28 42 Z" fill="#E8641C" />
          <path d="M48 33 L62 21 L58 33 L62 45 Z" fill="#E8641C" />
          <ellipse cx="29" cy="33" rx="20" ry="12.5" fill="#FF7A2F" />
          <g clipPath="url(#cfBody)" transform="rotate(-6 32 33)">
            <rect x="16.4" y="17" width="6" height="32" fill="#0b1013" opacity="0.32" />
            <rect x="17.2" y="17" width="4.4" height="32" fill="#F4F7F8" />
            <rect x="29.4" y="17" width="6" height="32" fill="#0b1013" opacity="0.32" />
            <rect x="30.2" y="17" width="4.4" height="32" fill="#F4F7F8" />
          </g>
          <circle cx="14" cy="30.5" r="3.4" fill="#F4F7F8" />
          <circle cx="13.2" cy="30.5" r="1.9" fill="#12181c" />
        </symbol>
        <symbol id="cfw" viewBox="0 0 64 64">
          <path d="M20 23 Q30 13 41 21 L37 25 Q30 20 24 25 Z" fill="#dfe6ea" />
          <path d="M25 44 Q30 51 37 46 L34 41 Q30 45 28 42 Z" fill="#dfe6ea" />
          <path d="M48 33 L62 21 L58 33 L62 45 Z" fill="#dfe6ea" />
          <ellipse cx="29" cy="33" rx="20" ry="12.5" fill="#F4F7F8" />
          <g clipPath="url(#cfBody)" transform="rotate(-6 32 33)">
            <rect x="16.6" y="17" width="5.6" height="32" fill="#E8641C" />
            <rect x="29.6" y="17" width="5.6" height="32" fill="#E8641C" />
          </g>
          <circle cx="14" cy="30.5" r="3.4" fill="#12181c" />
          <circle cx="15" cy="29.6" r="1" fill="#F4F7F8" />
        </symbol>
      </defs>
    </svg>
  )
}

export function Sidebar({ agents, activeView, onNavigate, ticketCount, emailCount }: Props) {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  )

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 768px)')
    const collapseForMobile = (event: MediaQueryListEvent) => {
      if (event.matches) setCollapsed(true)
    }
    if (mobileQuery.matches) setCollapsed(true)
    mobileQuery.addEventListener('change', collapseForMobile)
    return () => mobileQuery.removeEventListener('change', collapseForMobile)
  }, [])

  return (
    <aside className={`${collapsed ? 'w-14' : 'w-60'} bg-chrome/95 border-r border-chrome-line flex flex-col transition-all duration-200 shrink-0 shadow-[18px_0_42px_rgba(0,0,0,0.22)]`}>
      <ClownfishDefs />
      <div className={`h-14 flex items-center border-b border-chrome-line ${collapsed ? 'justify-center px-1' : 'px-3.5'}`}>
        {!collapsed && <span className="w-7 h-7 rounded-sm bg-[#FF7A2F] flex items-center justify-center shrink-0 select-none shadow-[0_0_24px_rgba(255,122,47,0.28)]">
          <svg width="20" height="20" aria-hidden="true"><use href="#cfw" /></svg>
        </span>}
        {!collapsed && (
          <div className="ml-2.5 min-w-0">
            <span className="block font-mono font-semibold text-sm tracking-[0.14em] text-chrome-ink leading-tight uppercase">FindMnemo</span>
            <span className="block text-[9px] font-mono text-chrome-mut uppercase tracking-[0.22em] leading-tight">Agent Ops Console</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`${collapsed ? '' : 'ml-auto'} text-chrome-mut hover:text-chrome-ink transition-colors text-sm px-2 py-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sync`}
        >
          {collapsed ? '>' : '<'}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            aria-current={activeView === item.id ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
              activeView === item.id
                ? 'bg-chrome-raised text-white border-r-2 border-sync shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'text-chrome-mut hover:text-chrome-ink hover:bg-chrome-raised/50'
            }`}
          >
            <span className={`text-xs font-mono ${activeView === item.id ? 'text-sync' : ''}`}>{item.icon}</span>
            {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
            {!collapsed && item.id === 'tickets' && ticketCount > 0 && (
              <span className="text-[10px] font-mono border border-chrome-line rounded-sm px-1.5 py-0.5 text-chrome-mut tabular-nums">{ticketCount}</span>
            )}
            {!collapsed && item.id === 'emails' && emailCount > 0 && (
              <span className="text-[10px] font-mono border border-memory/50 rounded-sm px-1.5 py-0.5 text-memory tabular-nums">{emailCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-chrome-line p-3 space-y-2">
        {!collapsed && (
          <p className="text-[9px] font-mono text-chrome-mut uppercase tracking-[0.2em] px-1">
            <span className="text-sync">|</span> Agents
          </p>
        )}
        {agents.map((a) => (
          <div key={a.agent} className="flex items-center gap-2 px-1" title={`${a.agent}: ${a.currentTask}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${AGENT_STATE_COLORS[a.state]} ${a.state === 'working' ? 'pulse-soft' : ''}`} />
            {!collapsed && (
              <>
                <span className={`text-xs ${SOURCE_TEXT_COLORS[a.agent]}`}>{a.label}</span>
                <span className="text-[10px] text-chrome-mut truncate flex-1">{a.currentTask}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {!collapsed && (
        <div className="border-t border-chrome-line px-4 py-2.5">
          <p className="text-[10px] font-mono text-chrome-mut/70">v3 - shared-brain enabled</p>
        </div>
      )}
    </aside>
  )
}
