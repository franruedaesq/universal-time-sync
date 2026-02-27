# universal-time-sync
An invisible, monotonic metronome that establishes a shared chronological reality. It uses NTP-style mathematics to calculate network latency and clock offsets, filters out network anomalies statistically, and smoothly "slews" the local clock to match the global time without ever jumping backward (time travel).
