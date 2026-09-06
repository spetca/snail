export interface NumericRules { min?: number; max?: number; positive?: boolean; integer?: boolean; optional?: boolean }

/** Parse the whole draft; never accept partial exponents, unit suffixes, Infinity, or hex. */
export function parseNumericDraft(draft: string, rules: NumericRules = {}): { value?: number; error: string | null } {
  const text = draft.trim()
  if (!text) return { error: rules.optional ? null : 'Enter a number.' }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return { error: 'Enter a complete number, such as -100, 0.5, or 1e6.' }
  const value = Number(text)
  if (!Number.isFinite(value)) return { error: 'Enter a finite number.' }
  if (rules.integer && !Number.isSafeInteger(value)) return { error: 'Enter a whole number within the safe integer range.' }
  if (rules.positive && value <= 0) return { error: 'Enter a number greater than zero.' }
  if (rules.min != null && value < rules.min) return { error: `Enter a number at least ${rules.min}.` }
  if (rules.max != null && value > rules.max) return { error: `Enter a number no greater than ${rules.max}.` }
  return { value, error: null }
}

/** Forms are not used everywhere in the desktop UI; guard action buttons explicitly. */
export function requireValidInputs(container: HTMLElement | null): void {
  if (!container) return
  const invalid = Array.from(container.querySelectorAll<HTMLInputElement>('input[data-numeric-input]'))
    .find(input => !input.disabled && !input.checkValidity())
  if (invalid) {
    invalid.focus(); invalid.reportValidity()
    throw new Error(`${invalid.getAttribute('aria-label') || 'Numeric input'}: ${invalid.validationMessage}`)
  }
}
