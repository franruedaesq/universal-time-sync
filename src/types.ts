/**
 * Pluggable transport layer used by {@link SyncedClock} to send pings and
 * receive pongs over any channel (HTTP, WebSocket, WebRTC, etc.).
 */
export interface TransportAdapter {
  /** Send a ping to the time server. */
  sendPing(payload: PingPayload): void;
  /** Register a callback that is invoked whenever a pong is received. */
  onPong(callback: (payload: PongPayload) => void): void;
}

/** Payload sent by the client at the start of a sync round-trip. */
export interface PingPayload {
  /** Client-local timestamp at the moment the ping was sent (ms since epoch). */
  t0: number;
  /** Unique identifier for this ping/pong pair. */
  id: string;
}

/**
 * Payload received from the server, completing the four-timestamp protocol
 * required for NTP-style offset estimation.
 */
export interface PongPayload {
  /** Client timestamp when the ping was sent (echoed from {@link PingPayload.t0}). */
  t0: number;
  /** Server timestamp when the ping was received. */
  t1: number;
  /** Server timestamp when the pong was sent. */
  t2: number;
  /** Client timestamp when the pong was received. */
  t3: number;
  /** Unique identifier matching the originating {@link PingPayload.id}. */
  id: string;
}

/** Configuration object passed to the {@link SyncedClock} constructor. */
export interface SyncConfig {
  /** How often (in ms) to send a ping to the time server. */
  syncIntervalMs: number;
  /** Number of recent samples to retain in the rolling history buffer. */
  historySize: number;
  /**
   * Multiplier of the standard deviation beyond which a sample is rejected as
   * an outlier (e.g. `2` means reject samples more than 2σ from the mean RTT).
   */
  outlierThreshold: number;
  /** Maximum clock-offset correction (in ms) applied per {@link SyncedClock.now} call. */
  timeSlewRate: number;
  /** Pluggable transport layer used to send pings and receive pongs. */
  transportAdapter: TransportAdapter;
  /**
   * Offset magnitude (in ms) above which a `"drift_warning"` event is emitted.
   * @defaultValue `500`
   */
  driftWarningThreshold?: number;
  /**
   * If the sync interval fires more than this many milliseconds late, a system
   * sleep/wake cycle is assumed and the sample history is reset.
   * @defaultValue `10 * syncIntervalMs`
   */
  sleepDetectionThresholdMs?: number;
}

/** A single timestamped sync sample produced by one ping/pong round-trip. */
export interface SyncSample {
  /** Measured round-trip time in milliseconds. */
  rtt: number;
  /** Estimated clock offset in milliseconds (positive = server is ahead). */
  offset: number;
  /** Client wall-clock time when this sample was recorded. */
  timestamp: number;
}

/** Intermediate payload used internally during sync-round processing. */
export interface SyncPayload {
  /** Client send time. */
  t0: number;
  /** Server receive time. */
  t1: number;
  /** Server send time. */
  t2: number;
  /** Unique identifier. */
  id: string;
}

/** Interface for classes that can process an incoming pong payload. */
export interface SyncManager {
  /** Called when a pong is received from the transport layer. */
  onReceivePong(payload: PongPayload): void;
}

/**
 * Lifecycle state of a {@link SyncedClock} instance.
 *
 * - `"UNSYNCED"` — the clock has been created but has not yet completed a
 *   sync round-trip.  `now()` returns `Date.now()` without any offset.
 * - `"SYNCING"` — the first ping has been sent and the clock is waiting for
 *   the corresponding pong.
 * - `"SYNCED"` — at least one valid pong has been received and the offset has
 *   been applied.
 */
export type SyncState = 'UNSYNCED' | 'SYNCING' | 'SYNCED';

/**
 * Map of events emitted by {@link SyncedClock} through its `events` emitter.
 * Use `clock.events.on(eventName, callback)` to subscribe.
 */
export interface SyncEventMap {
  /** Fired immediately before a ping is sent to the server. */
  sync_start: { timestamp: number };
  /** Fired after a pong is processed and the offset has been updated. */
  sync_success: { offset: number; rtt: number; timestamp: number };
  /**
   * Fired when the estimated clock offset exceeds
   * {@link SyncConfig.driftWarningThreshold}.
   */
  drift_warning: { offset: number; threshold: number; timestamp: number };
  /**
   * Fired when the sync interval fires significantly later than expected,
   * indicating the host device likely entered a sleep/suspend state.
   */
  sleep_detected: { gapMs: number; timestamp: number };
  /** Fired whenever the internal {@link SyncState} transitions. */
  state_change: { from: SyncState; to: SyncState };
}
