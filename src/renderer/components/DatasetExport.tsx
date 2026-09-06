import React, { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import type { DatasetJob, DatasetMode } from '../../shared/dataset'

export function DatasetExport(): React.ReactElement {
  const info = useStore(s => s.fileInfo)
  const project = useStore(s => s.eventProject)
  const sampleRate = useStore(s => s.sampleRate)
  const scanning = useStore(s => s.detectionProgress?.status === 'running')
  const [mode, setMode] = useState<DatasetMode>('manifest')
  const [job, setJob] = useState<DatasetJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const recordingId = info?.recordingId
  const current = () => useStore.getState().fileInfo?.recordingId === recordingId
  useEffect(() => {
    if (!recordingId) return
    let disposed = false, pending = false
    const refresh = async () => {
      if (disposed || pending) return
      pending = true
      try {
        const response = await window.snailAPI.getDatasetState(recordingId)
        if (!disposed) setJob(response)
      } catch (error) { if (!disposed) setError(String(error)) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(refresh, 500)
    return () => { disposed = true; clearInterval(timer) }
  }, [recordingId])
  const accepted = project?.proposals.filter(event => event.status === 'accepted').length ?? 0
  const running = job?.status === 'running'
  return <section aria-label="Dataset export" style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12, fontSize: 11 }}>
    <strong>Export accepted events ({accepted})</strong>
    <select aria-label="Dataset contents" value={mode} onChange={e => setMode(e.target.value as DatasetMode)} disabled={running || choosing} style={{ width: '100%', marginTop: 8 }}>
      <option value="manifest">Labels and source manifest</option>
      <option value="iq">Manifest + unfiltered IQ crops</option>
      <option value="channelized">Manifest + tuned and filtered IQ</option>
    </select>
    <p style={{ color: 'var(--text-muted)', margin: '8px 0' }}>Includes accepted revisions, source checksum, and recording groups for dataset splits. Hashing reads the whole source file.</p>
    {mode === 'channelized' && <p style={{ color: 'var(--text-muted)' }}>Tunes each event to DC and filters its band. Keeps the original sample rate and sample alignment. Very narrow or full-band selections may require unfiltered export.</p>}
    <button disabled={!accepted || scanning || running || choosing || sampleRate !== info?.sampleRate} onClick={async () => {
      if (!recordingId || !project) return
      setChoosing(true); setError(null)
      try {
        const response = await window.snailAPI.exportDataset({ recordingId, expectedRevision: project.revision, mode })
        if (current() && response) setJob(response)
      } catch (error) { if (current()) setError(String(error)) }
      finally { if (current()) setChoosing(false) }
    }} style={{ width: '100%' }}>{choosing ? 'Choose destination…' : 'Export accepted dataset'}</button>
    {error && <p role="alert" style={{ overflowWrap: 'anywhere' }}>{error}</p>}
    {job && <div role="status" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
      <div>{job.status} · {job.stage}{running && ` · ${Math.round(job.completed / Math.max(1, job.total) * 100)}%`}</div>
      {running && <><progress max={job.total || 1} value={job.completed} style={{ width: '100%' }} /><button onClick={async () => {
        try { await window.snailAPI.cancelDataset(job.recordingId, job.id) }
        catch (error) { if (current()) setError(String(error)) }
      }}>Cancel export</button></>}
      {job.outputPath && <p>Saved to {job.outputPath}</p>}
      {job.error && <p>{job.error}</p>}
    </div>}
  </section>
}
