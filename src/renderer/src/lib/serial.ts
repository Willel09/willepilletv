/**
 * One run at a time. A call while it runs asks for exactly one more run afterwards (however many calls came
 * in), so the newest request (a source added during a refresh, say) is never dropped.
 */
export function serial(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  let again = false
  const run = (): Promise<void> => {
    if (running) return (again = true), running
    running = fn().finally(() => {
      running = null
      if (again) (again = false), void run()
    })
    return running
  }
  return run
}
