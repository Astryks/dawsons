"""In-memory job tracking (job_id -> JobRecord).

Implemented at M4. A single-process, single-job-at-a-time in-memory dict is
sufficient for Phase 1 — the sidecar's lifetime matches the app's, and
results are handed off to Rust for durable storage immediately on
completion, so the sidecar itself never needs to persist jobs across
restarts.
"""
