import { useEffect, useState } from 'react'

// True while the element is in the viewport. Loops use it to pause when off-screen.
export default function useOnScreen(ref) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return visible
}
