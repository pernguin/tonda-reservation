import { createElement, useCallback, useEffect, useRef, useState } from 'react'

// [showToast, toastNode] — showToast(msg) displays msg for 2500ms; toastNode is the
// existing fixed-bottom pill (or null). Timer cleared on unmount.
export function useToast() {
  const [toast, setToast] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const showToast = useCallback(msg => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(''), 2500)
  }, [])

  const toastNode = toast
    ? createElement('div', {
        className: 'fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-4 py-2 rounded-full z-50 shadow-lg',
      }, toast)
    : null

  return [showToast, toastNode]
}
