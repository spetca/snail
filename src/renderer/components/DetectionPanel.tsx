import { pixelToFrequency } from '../utils/selection'
import { DatasetExport } from './DatasetExport'
import React, { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { recordingJob } from '../utils/recording'
import { DEFAULT_DETECTION_CONFIG, matchesEventFilters, type DetectionConfig, type DetectionFrequencyRange, type ReviewStatus } from '../../shared/detection'
import { formatFrequency, formatTimeValue } from '../../shared/units'

export function DetectionPanel(): React.ReactElement {
  const fileInfo = useStore(s => s.fileInfo)
  const frequencyMode = useStore(s => s.annotationFrequencyMode)
  const sampleRate = useStore(s => s.sampleRate)
  const project = useStore(s => s.eventProject)
  const progress = useStore(s => s.detectionProgress)
  const error = useStore(s => s.detectionError)
  const selectedId = useStore(s => s.selectedProposalId)
  const selection = useStore(s => s.selection)
  const focus = useStore(s => s.focusProposal)
  const [config, setConfig] = useState(DEFAULT_DETECTION_CONFIG)
  const [region, setRegion] = useState<'view' | 'selection' | 'recording'>('view')
  const [filter, setFilter] = useState<ReviewStatus>('proposed')
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [comment, setComment] = useState('')
  const [start, setStart] = useState('0'), [end, setEnd] = useState('0')
  const [low, setLow] = useState('0'), [high, setHigh] = useState('0')
  const proposals = project?.proposals ?? []
  const matching = proposals.filter(proposal => matchesEventFilters(proposal, fileInfo?.sampleRate ?? 1, config))
  const visible = matching.filter(proposal => proposal.status === filter)
  const selected = visible.find(proposal => proposal.id === selectedId)
  const running = progress?.status === 'running'

  useEffect(() => {
    if (!selected) return
    setLabel(selected.label); setComment(selected.comment)
    setStart(String(selected.sampleStart)); setEnd(String(selected.sampleStart + selected.sampleCount))
    setLow(String(selected.freqLowerEdge)); setHigh(String(selected.freqUpperEdge))
  }, [selected?.id, selected?.revision])

  const operation = async (work: () => Promise<void>) => {
    setBusy(true); useStore.getState().setDetectionError(null)
    try { await work() }
    catch (error) { if (useStore.getState().fileInfo?.recordingId === fileInfo?.recordingId) useStore.getState().setDetectionError(String(error)) }
    finally { setBusy(false) }
  }

  const startScan = () => operation(async () => {
    if (!fileInfo) return
    const state = useStore.getState(), job = recordingJob(fileInfo.recordingId)
    let startSample = 0, endSample = fileInfo.totalSamples
    let frequencyRange: DetectionFrequencyRange | undefined
    if (region === 'selection') {
      if (!selection) throw new Error('Select a time range using cursors first')
      startSample = Math.min(selection.sample1, selection.sample2)
      endSample = Math.max(selection.sample1, selection.sample2)
    } else if (region === 'view') {
      frequencyRange = {
        low: Math.max(-fileInfo.sampleRate / 2, pixelToFrequency(state.viewHeight, state)),
        high: Math.min(fileInfo.sampleRate / 2, pixelToFrequency(0, state))
      }
      startSample = Math.round(state.scrollOffset)
      endSample = Math.min(fileInfo.totalSamples, Math.ceil(startSample + state.viewWidth * Math.max(1, Math.round(state.fftSize / state.zoomLevel))))
    }
    const response = await window.snailAPI.startDetection({ recordingId: job.recordingId, startSample, endSample, config, frequencyRange })
    if (job.isCurrent()) state.applyDetectionState(response)
  })

  const review = (action: 'edit' | 'accept' | 'reject' | 'restore') => operation(async () => {
    if (!fileInfo || !selected) return
    const job = recordingJob(fileInfo.recordingId), state = useStore.getState()
    const patch = { sampleStart: Number(start), sampleCount: Number(end) - Number(start),
      freqLowerEdge: Number(low), freqUpperEdge: Number(high), label, comment }
    const result = await window.snailAPI.reviewProposal({ recordingId: job.recordingId, proposalId: selected.id,
      expectedRevision: selected.revision, action, patch, frequencyMode: state.annotationFrequencyMode })
    if (!job.isCurrent()) return
    state.applyDetectionState({ recordingId: job.recordingId, project: result.project, progress: state.detectionProgress })
    if (result.sigmfMetaJson) state.setSigmfMetadata(result.sigmfMetaJson)
    if (action === 'edit') focus(result.project.proposals.find(proposal => proposal.id === selected.id)!)
    else {
      const next = result.project.proposals.find(proposal => proposal.status === filter && proposal.id !== selected.id && matchesEventFilters(proposal, fileInfo.sampleRate, config))
      if (next) focus(next)
    }
  })

  const field = (title: string, value: string, change: (value: string) => void) => (
    <label style={{ display: 'block', marginTop: 8, fontSize: 11 }}>{title}
      <input aria-label={title} type="number" value={value} onChange={event => change(event.target.value)} style={{ width: '100%', marginTop: 3 }} />
    </label>
  )
  const rangeField = (title: string, key: keyof Pick<DetectionConfig, 'minPulseWidthSeconds' | 'maxPulseWidthSeconds' | 'minBandwidthHz' | 'maxBandwidthHz'>, scale: number) => (
    <label style={{ display: 'block', marginTop: 8, fontSize: 11 }}>{title}
      <input aria-label={title} type="number" min="0" step="any" placeholder="No limit"
        value={config[key] == null ? '' : config[key]! * scale}
        onChange={event => setConfig({ ...config, [key]: event.target.value === '' ? undefined : Number(event.target.value) / scale })}
        style={{ width: '100%', marginTop: 3 }} />
    </label>
  )
  const disabled = busy || !!running
  const count = (status: ReviewStatus) => matching.filter(proposal => proposal.status === status).length

  return <aside aria-label="Detection and review" style={{ width: 330, flexShrink: 0, overflowY: 'auto', padding: 16, background: 'var(--bg2)', borderLeft: '1px solid var(--border)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <strong>Detect & label</strong>
      <button aria-label="Close detection panel" onClick={() => useStore.getState().setShowDetectionPanel(false)}>×</button>
    </div>
    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0' }}>Find spectral activity, review its bounds, then save a label. Proposals are not annotations until accepted.</p>
    <fieldset disabled={disabled} style={{ border: 0, padding: 0 }}>
      <label style={{ display: 'block', fontSize: 11 }}>Scan range
        <select aria-label="Scan range" value={region} onChange={event => setRegion(event.target.value as typeof region)} style={{ width: '100%', marginTop: 4 }}>
          <option value="view">Current view (time + frequency)</option><option value="selection" disabled={!selection}>Cursor time range</option><option value="recording">Entire recording</option>
        </select>
      </label>
      <label style={{ display: 'block', marginTop: 8, fontSize: 11 }}>FFT size
        <select aria-label="Detection FFT size" value={config.fftSize} onChange={e => setConfig({ ...config, fftSize: Number(e.target.value) })} style={{ width: '100%', marginTop: 4 }}>
          {[128,256,512,1024,2048].map(size => <option key={size}>{size}</option>)}
        </select>
      </label>
      <label style={{ display: 'block', marginTop: 8, fontSize: 11 }}>Power threshold mode
        <select aria-label="Power threshold mode" value={config.thresholdMode ?? 'relative'}
          onChange={event => setConfig({ ...config, thresholdMode: event.target.value as 'relative' | 'absolute' })}
          style={{ width: '100%', marginTop: 4 }}>
          <option value="relative">Above estimated noise</option>
          <option value="absolute">Absolute power</option>
        </select>
      </label>
      {config.thresholdMode !== 'absolute' && field('Threshold above noise (dB)', String(config.thresholdDb), value => setConfig({ ...config, thresholdDb: Number(value) }))}
      {field(config.thresholdMode === 'absolute' ? 'Absolute threshold (dB)' : 'Minimum power (dB)', String(config.minimumPowerDb), value => setConfig({ ...config, minimumPowerDb: Number(value) }))}
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '8px 0' }}>
        {config.thresholdMode === 'absolute'
          ? 'Starts regions above this fixed FFT power level; follows their edges down to 4 dB below it. Use the same FFT size as the view when comparing power. Values are not calibrated dBm.'
          : 'Detects contrast above the median noise estimate, not simply the brightest signals. Broad signals filling the view can raise this estimate and be missed; try Absolute power for those.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {rangeField('Min pulse width (ms)', 'minPulseWidthSeconds', 1000)}
        {rangeField('Max pulse width (ms)', 'maxPulseWidthSeconds', 1000)}
        {rangeField('Min bandwidth (kHz)', 'minBandwidthHz', 0.001)}
        {rangeField('Max bandwidth (kHz)', 'maxBandwidthHz', 0.001)}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '8px 0' }}>Blank means no limit. Filters apply to new detections and the review queue; existing labels are preserved. Widths use the detected box, including FFT window support and allowed gaps.</p>
      <details style={{ marginTop: 8, fontSize: 11 }}><summary>Detection settings</summary>
        {field('Minimum frames', String(config.minFrames), value => setConfig({ ...config, minFrames: Number(value) }))}
        {field('Minimum frequency bins', String(config.minBins), value => setConfig({ ...config, minBins: Number(value) }))}
        {field('Allowed gap (frames)', String(config.maxGapFrames), value => setConfig({ ...config, maxGapFrames: Number(value) }))}
      </details>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '8px 0' }}>Overlapping FFT windows cover the full time range. Dense wideband signals can hide the noise floor; this is an activity detector, not a protocol classifier.</p>
      {sampleRate !== fileInfo?.sampleRate && <p role="alert">Detection uses the recording sample rate. Restore it or save corrected metadata and reopen before scanning.</p>}
      <button className="primary" onClick={startScan} disabled={!project || sampleRate !== fileInfo?.sampleRate} style={{ width: '100%' }}>Find transmissions</button>
    </fieldset>
    {progress && <div role="status" style={{ marginTop: 10, fontSize: 11 }}>
      <progress max={progress.endSample - progress.startSample} value={progress.processedUntil - progress.startSample} style={{ width: '100%' }} />
      <div>{progress.status} · {Math.round(100 * (progress.processedUntil - progress.startSample) / (progress.endSample - progress.startSample))}% scanned · {progress.candidateCount} candidates</div>
      {progress.error && <p>{progress.error}</p>}
      {progress.status === 'complete' && progress.candidateCount === 0 && <p>No activity matched this scan. Try lowering the threshold or relaxing width/bandwidth filters. For a very narrow frequency view, increase detection FFT size.</p>}
      {running && <button style={{ marginTop: 6 }} onClick={() => operation(async () => {
        if (fileInfo) await window.snailAPI.cancelDetection(fileInfo.recordingId, progress.id)
      })}>Cancel scan</button>}
      {progress.status === 'cancelled' && <p>Completed candidates are retained. Rescan to finish; unchanged candidates keep their review decisions.</p>}
    </div>}
    {error && <div role="alert" style={{ color: 'var(--error)', margin: '10px 0', overflowWrap: 'anywhere' }}>{error}
      <button onClick={() => operation(async () => {
        if (fileInfo) useStore.getState().applyDetectionState(await window.snailAPI.getDetectionState(fileInfo.recordingId))
      })}>Reload queue</button>
    </div>}
    <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 11 }}>Review queue · {matching.length} of {proposals.length} match
      <select aria-label="Review filter" value={filter} onChange={event => setFilter(event.target.value as ReviewStatus)} style={{ width: '100%', marginTop: 4 }}>
        <option value="proposed">Pending ({count('proposed')})</option><option value="accepted">Accepted ({count('accepted')})</option><option value="rejected">Rejected ({count('rejected')})</option>
      </select>
    </label>
    <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {visible.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No {filter === 'proposed' ? 'pending' : filter} proposals.</p>}
      {visible.map((proposal, index) => <button key={proposal.id} aria-label={`Review candidate ${index + 1}`} onClick={() => focus(proposal)}
        style={{ textAlign: 'left', borderColor: selectedId === proposal.id ? 'var(--accent)' : 'var(--border)' }}>
        <div>{proposal.label || `Candidate ${index + 1}`}</div>
        <small>{formatTimeValue(proposal.sampleStart / (fileInfo?.sampleRate ?? 1))} · width {formatTimeValue(proposal.sampleCount / (fileInfo?.sampleRate ?? 1))} · {formatFrequency(proposal.freqUpperEdge - proposal.freqLowerEdge)}</small>
      </button>)}
    </div>
    {selected && <section aria-label="Proposal editor" style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10 }}>
      <div style={{ fontSize: 11 }}>{selected.status} · revision {selected.revision} · {selected.peakAboveNoiseDb.toFixed(1)} dB above median noise</div>
      {selected.touchesBoundary && <p style={{ fontSize: 11 }}>Touches a scan/capture boundary; the transmission may continue outside this region.</p>}
      <fieldset disabled={disabled || sampleRate !== fileInfo?.sampleRate || selected.status !== 'proposed'} style={{ border: 0, padding: 0 }}>
        <label style={{ display: 'block', marginTop: 8, fontSize: 11 }}>Event label
          <input aria-label="Event label" type="text" value={label} maxLength={128} placeholder="e.g. FSK burst, unknown beacon" onChange={event => setLabel(event.target.value)} style={{ width: '100%', marginTop: 3 }} />
        </label>
        {field('Start sample', start, setStart)}{field('End sample (exclusive)', end, setEnd)}
        {field('Lower frequency (baseband Hz)', low, setLow)}{field('Upper frequency (baseband Hz)', high, setHigh)}
        <button disabled={!selection} style={{ marginTop: 8 }} onClick={() => {
          if (!selection) return
          setStart(String(Math.min(selection.sample1, selection.sample2))); setEnd(String(Math.max(selection.sample1, selection.sample2)))
          setLow(String(Math.min(selection.frequency1, selection.frequency2))); setHigh(String(Math.max(selection.frequency1, selection.frequency2)))
        }}>Use cursor bounds</button>
        <label style={{ display: 'block', marginTop: 8, fontSize: 11 }}>Review notes
          <input aria-label="Review notes" type="text" value={comment} maxLength={2000} onChange={e => setComment(e.target.value)} style={{ width: '100%', marginTop: 3 }} />
        </label>
        {frequencyMode === 'legacy-baseband' && <p style={{ fontSize: 11 }}>Accepting also converts existing legacy annotation frequencies to RF.</p>}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={() => review('edit')}>Save edits</button>
          <button className="primary" disabled={!label.trim()} onClick={() => review('accept')}>Accept label</button>
          <button onClick={() => review('reject')}>Reject</button>
        </div>
      </fieldset>
      {selected.status === 'rejected' && <button disabled={disabled} onClick={() => review('restore')}>Restore proposal</button>}
      <details style={{ fontSize: 10, marginTop: 10 }}><summary>Review history</summary>
        {selected.history.map(revision => <div key={revision.revision}>{revision.at} · {revision.action} · {revision.label || 'unlabeled'}</div>)}
      </details>
    </section>}
    <details style={{ marginTop: 16, fontSize: 11 }}>
      <summary>Queue management</summary>
      <p>Reset clears all proposals and scan history from this queue. Review history is archived locally; accepted SigMF labels are preserved. A fresh scan can propose those regions again.</p>
      <button disabled={disabled || !project} onClick={() => operation(async () => {
        if (!fileInfo || !project) return
        const job = recordingJob(fileInfo.recordingId)
        const result = await window.snailAPI.resetDetection(job.recordingId, project.revision)
        if (job.isCurrent()) {
          useStore.getState().applyDetectionState(result)
          useStore.setState({ selectedProposalId: null })
        }
      })}>Reset review queue</button>
    </details>
    <DatasetExport key={fileInfo?.recordingId} />
  </aside>
}
