/** Keeps only the latest viewport queued; existing work can still populate the cache. */
export class TileScheduler<T extends { key: string }> {
  private pending: T[] = []
  private active = new Set<string>()
  private disposed = false
  constructor(private has: (key: string) => boolean, private load: (task: T) => Promise<void>,
    private changed: (error?: unknown) => void, private concurrency = 2) {}
  update(tasks: T[]): void {
    this.pending = tasks.filter(task => !this.has(task.key) && !this.active.has(task.key))
    this.pump()
  }
  private pump(): void {
    if (this.disposed) return
    while (this.active.size < this.concurrency && this.pending.length) {
      const task = this.pending.shift()!
      if (this.has(task.key) || this.active.has(task.key)) continue
      this.active.add(task.key)
      void this.load(task).then(() => { if (!this.disposed) this.changed() }, error => {
        if (!this.disposed) this.changed(error)
      }).finally(() => { this.active.delete(task.key); this.pump() })
    }
  }
  dispose(): void { this.disposed = true; this.pending = [] }
}
