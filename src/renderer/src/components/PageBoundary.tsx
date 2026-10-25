import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface State {
  error: Error | null
}

/** Route-level guard: a broken page must never leave the whole launcher blank. */
export default class PageBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[page] render failed:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page page-error">
        <div className="page-error-card">
          <span className="page-error-icon"><AlertTriangle size={22} /></span>
          <div>
            <h1>这个页面没有正常加载</h1>
            <p>页面组件发生了错误，其他页面仍可正常使用。可以先重试，或回到主页切换一个实例。</p>
            <pre>{this.state.error.message}</pre>
          </div>
          <div className="page-error-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ error: null })}>
              <RotateCcw size={14} /> 重试
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                window.location.hash = '#/'
                window.location.reload()
              }}
            >
              回到主页
            </button>
          </div>
        </div>
      </div>
    )
  }
}
