import React, { useRef, useCallback, useState, useEffect } from 'react'

const THUMB_MIN = 20
const BAR_SIZE = 12

interface ScrollBarProps {
  orientation: 'horizontal' | 'vertical'
  totalRange: number
  viewportSize: number
  value: number
  onChange: (value: number) => void
}

export function ScrollBar({
  orientation,
  totalRange,
  viewportSize,
  value,
  onChange
}: ScrollBarProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [hovered, setHovered] = useState(false)

  const isHoriz = orientation === 'horizontal'

  const getTrackLength = useCallback((): number => {
    const track = trackRef.current
    if (!track) return 0
    return isHoriz ? track.clientWidth : track.clientHeight
  }, [isHoriz])

  const ratio = Math.min(1, viewportSize / Math.max(1, totalRange))
  const maxValue = Math.max(0, totalRange - viewportSize)

  const getThumbSize = useCallback((): number => {
    const trackLen = getTrackLength()
    return Math.max(THUMB_MIN, ratio * trackLen)
  }, [ratio, getTrackLength])

  const getThumbPos = useCallback((): number => {
    const trackLen = getTrackLength()
    const thumbSize = getThumbSize()
    const scrollableTrack = trackLen - thumbSize
    if (maxValue <= 0) return 0
    return (value / maxValue) * scrollableTrack
  }, [value, maxValue, getTrackLength, getThumbSize])

  const posToValue = useCallback((pos: number): number => {
    const trackLen = getTrackLength()
    const thumbSize = getThumbSize()
    const scrollableTrack = trackLen - thumbSize
    if (scrollableTrack <= 0) return 0
    return Math.max(0, Math.min(maxValue, (pos / scrollableTrack) * maxValue))
  }, [maxValue, getTrackLength, getThumbSize])

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const clickPos = isHoriz ? e.clientX - rect.left : e.clientY - rect.top
    const thumbSize = getThumbSize()
    // Center thumb on click position
    onChange(Math.round(posToValue(clickPos - thumbSize / 2)))
  }, [isHoriz, getThumbSize, posToValue, onChange])

  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const mousePos = isHoriz ? e.clientX - rect.left : e.clientY - rect.top
    setDragOffset(mousePos - getThumbPos())
    setDragging(true)
  }, [isHoriz, getThumbPos])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const mousePos = isHoriz ? e.clientX - rect.left : e.clientY - rect.top
      onChange(Math.round(posToValue(mousePos - dragOffset)))
    }

    const handleUp = () => setDragging(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, dragOffset, isHoriz, posToValue, onChange])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    const delta = isHoriz ? e.deltaY || e.deltaX : e.deltaY
    const step = maxValue * 0.02
    onChange(Math.round(Math.max(0, Math.min(maxValue, value + Math.sign(delta) * step))))
  }, [isHoriz, value, maxValue, onChange])

  // Don't show scrollbar if everything fits
  if (ratio >= 1) return <></>

  const thumbPos = getThumbPos()
  const thumbSize = getThumbSize()

  const trackStyle: React.CSSProperties = isHoriz
    ? { width: '100%', height: BAR_SIZE, position: 'relative', cursor: 'pointer' }
    : { width: BAR_SIZE, height: '100%', position: 'relative', cursor: 'pointer' }

  const thumbStyle: React.CSSProperties = isHoriz
    ? {
        position: 'absolute',
        left: thumbPos,
        top: 1,
        width: thumbSize,
        height: BAR_SIZE - 2,
        borderRadius: 4,
        background: hovered || dragging ? 'var(--text-dim)' : 'var(--surface)',
        cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? 'none' : 'background 0.15s'
      }
    : {
        position: 'absolute',
        top: thumbPos,
        left: 1,
        width: BAR_SIZE - 2,
        height: thumbSize,
        borderRadius: 4,
        background: hovered || dragging ? 'var(--text-dim)' : 'var(--surface)',
        cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? 'none' : 'background 0.15s'
      }

  return (
    <div
      ref={trackRef}
      style={{
        ...trackStyle,
        background: 'var(--bg0)'
      }}
      onClick={handleTrackClick}
      onWheel={handleWheel}
    >
      <div
        style={thumbStyle}
        onMouseDown={handleThumbMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
    </div>
  )
}
