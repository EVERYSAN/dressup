// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { AppErrorBoundary } from './components/AppErrorBoundary'

/**
 * iOS Safari の 100vh 問題対策:
 * ウィンドウの「見えている高さ」を CSS 変数 --vh に入れる。
 * .app-viewport { height: calc(var(--vh) * 100) } で利用。
 */
function setVhVar() {
  const vh = window.innerHeight * 0.01
  document.documentElement.style.setProperty('--vh', `${vh}px`)
}

// 本番でも全例外をログ出力（元の挙動を維持）
if (typeof window !== 'undefined') {
  // 100vh 対策の初期化 & 監視
  setVhVar()
  window.addEventListener('resize', setVhVar)
  window.addEventListener('orientationchange', setVhVar)
  // iOS Safari のアドレスバー伸縮にも追従（対応端末のみ）
  if ((window as any).visualViewport?.addEventListener) {
    (window as any).visualViewport.addEventListener('resize', setVhVar)
  }

  // 既存のグローバルエラーハンドラ
  window.onerror = (msg, src, line, col, err) => {
    console.error('[GLOBAL] onerror:', { msg, src, line, col, err })
  }
  window.onunhandledrejection = (ev) => {
    console.error('[GLOBAL] unhandledrejection:', (ev as PromiseRejectionEvent).reason)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
