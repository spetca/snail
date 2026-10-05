import { useEffect, useRef, useState } from 'react'

/** One trace read in flight; intermediate pan positions are replaced instead of queued. */
export function useLatestSamples(recordingId: string | undefined, start: number, count: number, stride: number, enabled: boolean) {
  const [result, setResult] = useState<{ key: string; samples: Float32Array } | null>(null)
  const latest = useRef<{ key: string; run: () => Promise<Float32Array> } | null>(null)
  const active = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; latest.current = null } }, [])
  const key = `${recordingId}:${start}:${count}:${stride}`
  useEffect(() => {
    if (!enabled || !recordingId || count <= 0) { latest.current = null; return }
    latest.current = { key, run: () => window.snailAPI.getSamples(start, count, stride, recordingId) }
    const pump = async () => {
      if (active.current) return
      active.current = true
      try {
        while (mounted.current && latest.current) {
          const job = latest.current
          latest.current = null
          try {
            const samples = await job.run()
            if (mounted.current && !latest.current) setResult({ key: job.key, samples })
          } catch { /* A new recording can invalidate a pending request. */ }
        }
      } finally { active.current = false }
    }
    void pump()
  }, [recordingId, start, count, stride, enabled, key])
  return result?.key === key ? result.samples : null
}
