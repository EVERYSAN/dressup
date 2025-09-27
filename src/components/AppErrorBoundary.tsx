import React from 'react';

type State = { hasError: boolean; info?: string };

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, info: String(error?.message || error) };
  }

  componentDidCatch(error: any, info: any) {
    // ここで任意のロギングサービスに送ってもOK
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto' }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong 😵</h1>
        <p style={{ color: '#666', whiteSpace: 'pre-wrap' }}>{this.state.info}</p>
        <button
          onClick={() => location.reload()}
          style={{ marginTop: 12, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6 }}
        >
          Reload
        </button>
      </div>
    );
  }
}
export default AppErrorBoundary;
