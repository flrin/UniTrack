import { useEffect, useState } from 'react'

/** The current time (ms since epoch), refreshed on an interval. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(intervalId)
  }, [intervalMs])

  return now
}
