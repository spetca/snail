export const IPC = {
  OPEN_FILE: 'snail:open-file',
  GET_SAMPLES: 'snail:get-samples',
  COMPUTE_FFT_TILE: 'snail:compute-fft-tile',
  EXPORT_SIGMF: 'snail:export-sigmf',
  CORRELATE: 'snail:correlate',
  READ_FILE_SAMPLES: 'snail:read-file-samples',
  SHOW_OPEN_DIALOG: 'snail:show-open-dialog',
  SHOW_SAVE_DIALOG: 'snail:show-save-dialog',
  SAVE_ANNOTATION: 'snail:save-annotation'
} as const
