import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] uncaught render error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="fatal-screen">
          <div className="fatal-card">
            <span className="fatal-icon">!</span>
            <span className="eyebrow">界面错误</span>
            <h1>界面渲染出现异常</h1>
            <p>{this.state.error.message}</p>
            <div className="fatal-actions">
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                重新加载界面
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => this.setState({ error: null })}>
                尝试恢复
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
