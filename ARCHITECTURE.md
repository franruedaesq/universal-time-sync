# universal-time-sync Architecture

## 1. General Context & Executive Summary

`universal-time-sync` is a zero-dependency TypeScript library that provides a generic, transport-agnostic clock synchronization service. It implements NTP-style mathematics to estimate the offset between a client clock and a reference server clock, enabling applications to present accurate, synchronized time regardless of the underlying communication channel (WebSocket, HTTP polling, WebRTC, etc.).

The library is designed for frontend and Node.js environments where accurate timestamps are critical — such as collaborative real-time applications, distributed tracing, or media synchronization.

## 2. Core Capabilities

- **NTP-style offset estimation** using the four-timestamp protocol (T0–T3)
- **Round-trip time (RTT) calculation** to measure network latency
- **Statistical outlier rejection** to filter noisy samples
- **Clock slewing** to gradually apply offset corrections, avoiding time jumps
- **Monotonic `now()` guarantee** — the clock never goes backward
- **Transport-agnostic design** via the `TransportAdapter` interface
- **Rolling history buffer** of configurable size for statistical stability

## 3. Configuration Schema

| Property | Type | Description |
|---|---|---|
| `syncIntervalMs` | `number` | How often (in ms) to send a ping to the server |
| `historySize` | `number` | Number of recent samples to retain for offset calculation |
| `outlierThreshold` | `number` | Multiplier of stddev beyond which samples are rejected |
| `timeSlewRate` | `number` | Maximum offset change (in ms) applied per sync tick |
| `transportAdapter` | `TransportAdapter` | Pluggable transport layer for sending pings and receiving pongs |

## 4. Architecture & Math Fundamentals

### The Four-Timestamp Protocol

Each sync round-trip uses four timestamps:

- **T0**: Client sends ping (client clock)
- **T1**: Server receives ping (server clock)
- **T2**: Server sends pong (server clock)
- **T3**: Client receives pong (client clock)

### Round-Trip Time (RTT)

```
RTT = (T3 - T0) - (T2 - T1)
```

This subtracts the server processing time `(T2 - T1)` from the total elapsed time `(T3 - T0)`, giving the pure network round-trip latency.

### Clock Offset

```
Offset = ((T1 - T0) + (T2 - T3)) / 2
```

This averages the one-way latency estimates in each direction to compute how far ahead or behind the server clock is relative to the client. A positive offset means the server is ahead.

### Slewing

Rather than jumping the clock directly to the new offset, the library applies at most `timeSlewRate` milliseconds of correction per tick. This prevents time discontinuities and avoids the clock going backward.

### Monotonic Guarantee

`now()` tracks the last returned value. If the computed time would be less than the previous value, it returns the previous value instead.
