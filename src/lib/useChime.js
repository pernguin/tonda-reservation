import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'admin-sound'

function readPref() {
  try { return localStorage.getItem(STORAGE_KEY) === 'on' } catch { return false }
}

// Two-tone chime via Web Audio. Browsers block audio until a user gesture, so the
// AudioContext is created/resumed on the first pointerdown anywhere in the document.
export function useChime() {
  const [soundOn, setSoundOn] = useState(readPref)
  const [primed, setPrimed] = useState(false)
  const ctxRef = useRef(null)

  const prime = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current.resume().then(() => setPrimed(true))
  }, [])

  useEffect(() => {
    const once = () => { prime(); document.removeEventListener('pointerdown', once) }
    document.addEventListener('pointerdown', once)
    return () => {
      document.removeEventListener('pointerdown', once)
      ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [prime])

  const toggle = useCallback(() => {
    setSoundOn(on => {
      const next = !on
      try { localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off') } catch { /* private mode */ }
      return next
    })
    prime()
  }, [prime])

  const play = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || ctx.state !== 'running') return
    const tone = (freq, at) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.2, at)
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.12)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.12)
    }
    tone(880, ctx.currentTime)
    tone(1175, ctx.currentTime + 0.14)
  }, [])

  return { soundOn, primed, toggle, play }
}
