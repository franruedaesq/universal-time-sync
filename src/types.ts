export interface TransportAdapter {
  sendPing(payload: PingPayload): void;
  onPong(callback: (payload: PongPayload) => void): void;
}

export interface PingPayload {
  t0: number;
  id: string;
}

export interface PongPayload {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  id: string;
}

export interface SyncConfig {
  syncIntervalMs: number;
  historySize: number;
  outlierThreshold: number;
  timeSlewRate: number;
  transportAdapter: TransportAdapter;
}

export interface SyncSample {
  rtt: number;
  offset: number;
  timestamp: number;
}

export interface SyncPayload {
  t0: number;
  t1: number;
  t2: number;
  id: string;
}

export interface SyncManager {
  onReceivePong(payload: PongPayload): void;
}
