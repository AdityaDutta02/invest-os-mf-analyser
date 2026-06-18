'use client'
import { useState, useEffect } from 'react'

export function useEmbedToken(): string | null {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only accept the token from the viewer shell that hosts this iframe.
      // Rejecting messages from any other window/frame prevents an unrelated
      // frame from injecting a forged embed token. We intentionally do not
      // hardcode an origin allowlist here because the Terminal AI shell origin
      // is not known to the app at build time; the source===parent check is the
      // reliable, non-breaking guard available in the embed model.
      if (event.source !== window.parent) return
      if (event.data?.type === 'TERMINAL_AI_TOKEN' && typeof event.data.token === 'string') {
        setToken(event.data.token)
      }
    }
    window.addEventListener('message', handleMessage)
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'TERMINAL_AI_READY' }, '*')
    }
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return token
}
