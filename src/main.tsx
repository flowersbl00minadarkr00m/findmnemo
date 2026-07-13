import '@vitejs/plugin-react/preamble' // React Fast Refresh preamble (no-op in prod builds)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { WorkspaceRouter } from './WorkspaceRouter'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceRouter />
  </StrictMode>,
)
