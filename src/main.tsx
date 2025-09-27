// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { AppErrorBoundary } from './components/AppErrorBoundary'

// 追加: 本番でも全例外をログ出力
if (typeof window !== 'undefined') {
  window.onerror = (msg, src, line, col, err) => {
    console.error('[GLOBAL] onerror:', { msg, src, line, col, err });
  };
  window.onunhandledrejection = (ev) => {
    console.error('[GLOBAL] unhandledrejection:', ev.reason);
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
