// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap = Record<string, any[]>

export class TypedEventEmitter<Events extends EventMap> {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on<K extends keyof Events & string>(event: K, handler: (...args: Events[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    const set = this.listeners.get(event)!
    const wrapper = handler as (...args: unknown[]) => void
    set.add(wrapper)
    return () => { set.delete(wrapper) }
  }

  off<K extends keyof Events & string>(event: K, handler: (...args: Events[K]) => void): void {
    const set = this.listeners.get(event)
    if (set) {
      set.delete(handler as (...args: unknown[]) => void)
    }
  }

  emit<K extends keyof Events & string>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event)
    if (set) {
      for (const handler of set) {
        handler(...(args as unknown[]))
      }
    }
  }
}
