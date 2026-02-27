/** A generic listener function for an event of type `T`. */
type Listener<T> = (data: T) => void;

/**
 * A lightweight, zero-dependency, generic event emitter.
 *
 * `TEventMap` is a record that maps event names to their payload types,
 * providing full type safety for every `on` / `emit` / `off` call.
 *
 * @typeParam TEventMap - An object whose keys are event names and whose values
 *   are the corresponding payload types.
 *
 * @example
 * ```ts
 * interface MyEvents { done: { result: string }; error: Error }
 * const emitter = new EventEmitter<MyEvents>();
 * const unsubscribe = emitter.on('done', ({ result }) => console.log(result));
 * emitter.emit('done', { result: 'ok' });
 * unsubscribe(); // remove the listener
 * ```
 */
export class EventEmitter<TEventMap> {
  private _listeners: Partial<{ [K in keyof TEventMap]: Array<Listener<TEventMap[K]>> }> = {};

  /**
   * Registers a listener for the given event.
   *
   * @param event - The event name.
   * @param listener - The callback to invoke when the event fires.
   * @returns An unsubscribe function that removes the listener when called.
   */
  on<K extends keyof TEventMap>(event: K, listener: Listener<TEventMap[K]>): () => void {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event]!.push(listener);
    return () => this.off(event, listener);
  }

  /**
   * Removes a previously registered listener for the given event.
   *
   * @param event - The event name.
   * @param listener - The exact callback reference that was passed to `on`.
   */
  off<K extends keyof TEventMap>(event: K, listener: Listener<TEventMap[K]>): void {
    const listeners = this._listeners[event];
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  /**
   * Emits an event, invoking all registered listeners with the provided data.
   *
   * @param event - The event name.
   * @param data - The payload delivered to every listener.
   */
  emit<K extends keyof TEventMap>(event: K, data: TEventMap[K]): void {
    const listeners = this._listeners[event];
    if (listeners) {
      // Iterate over a copy so that listeners removed during emission are safe.
      for (const listener of listeners.slice()) {
        listener(data);
      }
    }
  }

  /**
   * Removes all listeners for every event, freeing any captured references.
   * Called automatically by {@link SyncedClock.destroy}.
   */
  removeAllListeners(): void {
    this._listeners = {};
  }
}
