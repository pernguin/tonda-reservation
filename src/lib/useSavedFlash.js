import { useCallback, useEffect, useRef, useState } from 'react'

// [saved, flashSaved] — flashSaved() sets saved true for 2000ms, then resets.
export function useSavedFlash() {
  const [saved, setSaved] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const flashSaved = useCallback(() => {
    setSaved(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), 2000)
  }, [])

  return [saved, flashSaved]
}
