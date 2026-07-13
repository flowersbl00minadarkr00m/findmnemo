export type WorkspaceKind = 'landing' | 'sample' | 'operational' | 'not-found'

export function getWorkspaceKind(pathname: string): WorkspaceKind {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'landing'
  if (path === '/demo' || path.startsWith('/demo/')) return 'sample'
  if (path === '/app' || path.startsWith('/app/')) return 'operational'
  return 'not-found'
}
