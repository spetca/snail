import type { FileInfo } from '../shared/sample-formats'

/** Owns IPC recording identity; native workers separately retain their source mapping. */
export class RecordingSession {
  private generation = 0
  current: FileInfo | null = null

  open(openSource: () => Omit<FileInfo, 'recordingId'>): FileInfo {
    const info = openSource() // Failure leaves the previous source/session usable.
    this.current = { ...info, recordingId: String(++this.generation) }
    return this.current
  }

  isCurrent(id: string | undefined): boolean {
    return !!id && this.current?.recordingId === id
  }

  assertCurrent(id: string | undefined): FileInfo {
    if (!this.isCurrent(id)) throw new Error('Recording changed. Run the operation again on the current recording.')
    return this.current!
  }

  async run<T>(id: string, work: () => T | Promise<T>): Promise<T> {
    this.assertCurrent(id)
    const result = await work()
    this.assertCurrent(id)
    return result
  }
}
