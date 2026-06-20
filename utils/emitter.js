export class SimpleEmitter {
  constructor () {
    this.listeners = new Map()
  }

  on (event, handler) {
    const handlers = this.listeners.get(event) || new Set()
    handlers.add(handler)
    this.listeners.set(event, handlers)
    return this
  }

  once (event, handler) {
    const wrapped = (...args) => {
      this.off(event, wrapped)
      handler(...args)
    }
    return this.on(event, wrapped)
  }

  off (event, handler) {
    this.listeners.get(event)?.delete(handler)
    return this
  }

  emit (event, ...args) {
    for (const handler of this.listeners.get(event) || []) handler(...args)
    return this
  }
}
