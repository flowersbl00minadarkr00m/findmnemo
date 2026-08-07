export type WorkspaceKind = 'landing' | 'sample' | 'operational' | 'install' | 'not-found'

export function getWorkspaceKind(pathname: string): WorkspaceKind {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'landing'
  if (path === '/demo' || path.startsWith('/demo/')) return 'sample'
  if (path === '/app' || path.startsWith('/app/')) return 'operational'
  if (path === '/install' || path.startsWith('/install/')) return 'install'
  return 'not-found'
}
