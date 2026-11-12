import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './context/ThemeContext'

// The service worker is for the web build only. In the Capacitor shell the
// files are already on the phone and are served from a custom scheme, where a
// service worker is neither needed nor reliably supported. Capacitor's native
// bridge sets globalThis.Capacitor before any page script runs.
//
// This is the registration vite-plugin-pwa used to inject as registerSW.js
// (vite.config.js now sets injectRegister: null). Updates still apply
// themselves: the generated worker skips waiting and claims its clients, and
// the open page is never reloaded under someone who is typing.
const isNativeShell = Boolean(globalThis.Capacitor?.isNativePlatform?.())
if (import.meta.env.PROD && !isNativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('Service worker registration failed', error)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
