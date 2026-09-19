import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'admin-sound'

function readPref() {
  try { return localStorage.getItem(STORAGE_KEY) === 'on' } catch { return false }
}

// Three-note rising chime, repeated once, via Web Audio. Browsers block audio until a user
// gesture, so the AudioContext is created/resumed on the first pointerdown anywhere in the document.
export function useChime() {
  const [soundOn, setSoundOn] = useState(readPref)
  const [primed, setPrimed] = useState(false)
  const ctxRef = useRef(null)
  const busyUntilRef = useRef(0)

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
    if (ctx.currentTime < busyUntilRef.current) return
    const tone = (freq, at, dur = 0.16) => {
      const osc = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      filter.type = 'lowpass'
      filter.frequency.value = 2400
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.7, at + 0.01)
      gain.gain.setValueAtTime(0.7, at + dur - 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(filter).connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + dur)
    }
    const t0 = ctx.currentTime
    ;[0, 1].forEach(rep => {
      const base = t0 + rep * 0.6
      tone(660, base)
      tone(880, base + 0.18)
      tone(1175, base + 0.36, 0.22)
    })
    busyUntilRef.current = t0 + 1.25
  }, [])

  return { soundOn, primed, toggle, play }
}
