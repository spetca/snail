import React, { useEffect, useId, useRef, useState } from 'react'
import { parseNumericDraft, type NumericRules } from '../utils/numeric-input'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step'>, Omit<NumericRules, 'optional'> {
  value: number | undefined
  onValueChange: (value: number) => void
  /** Providing onClear makes a blank value valid (for optional bounds). */
  onClear?: () => void
  commitOnBlur?: boolean
}

/** Keep '-' / '1.' / '1e-' as editable text without contaminating numeric application state. */
export function NumericInput({ value, onValueChange, onClear, commitOnBlur = false, min, max, positive, integer, onBlur, onKeyDown, ...props }: Props): React.ReactElement {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [touched, setTouched] = useState(false)
  const editing = useRef(false)
  const emitted = useRef(value)
  const input = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const rules = { min, max, positive, integer, optional: !!onClear }
  const { error } = parseNumericDraft(draft, rules)

  useEffect(() => {
    // Parent echoes must not erase a decimal point, exponent, or trailing zero during editing.
    if (!editing.current || !Object.is(value, emitted.current)) setDraft(value == null ? '' : String(value))
    emitted.current = value
  }, [value])
  useEffect(() => { input.current?.setCustomValidity(error ?? '') }, [error])

  return <>
    <input {...props} ref={input} type="text" inputMode="decimal" data-numeric-input
      title={props.title ?? (commitOnBlur ? 'Apply with Enter or by leaving this field.' : undefined)}
      value={draft} aria-invalid={!!error} aria-describedby={error && touched ? errorId : props['aria-describedby']}
      onChange={event => {
        const text = event.target.value
        editing.current = true; setDraft(text)
        const parsed = parseNumericDraft(text, rules)
        event.currentTarget.setCustomValidity(parsed.error ?? '')
        if (!parsed.error && !commitOnBlur) {
          emitted.current = parsed.value
          if (parsed.value == null) onClear?.()
          else onValueChange(parsed.value)
        }
      }}
      onBlur={event => {
        editing.current = false; setTouched(true)
        const parsed = parseNumericDraft(draft, rules)
        if (commitOnBlur && !parsed.error) {
          emitted.current = parsed.value
          if (parsed.value == null) onClear?.()
          else onValueChange(parsed.value)
        }
        onBlur?.(event)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (error) { setTouched(true); event.currentTarget.reportValidity() }
          else event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value == null ? '' : String(value)); setTouched(false); editing.current = false
          event.stopPropagation()
        }
        onKeyDown?.(event)
      }} />
    {error && touched && <span id={errorId} style={{ display: 'block', color: 'var(--error, #ff6b6b)', fontSize: 10, marginTop: 3 }}>{error}</span>}
  </>
}
