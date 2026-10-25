import type { EmberAPI } from '../shared/types'

declare global {
  interface Window {
    ember: EmberAPI
    __emberSmoke?: {
      navigate: (path: string) => void
      setTheme: (theme: 'dark' | 'light' | 'system') => void
      openCreate: () => void
      openImport: () => void
      openAccount: () => void
      closeAll: () => void
      launchDemo: () => void
    }
  }
}

export {}
