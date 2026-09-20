# Monetization: Freemium Model

## The core tension, and how the architecture already resolves most of it

"Free like GarageBand" and "charge for AI" pull against each other unless
we're precise about *which* AI work actually costs us money. Per
[`ARCHITECTURE.md`](ARCHITECTURE.md), the AI sidecar runs **on the user's
own machine**, not on our servers — Demucs separation, tempo/key/chord
detection, and (later) voice-to-instrument all execute on the user's CPU.
That means most of what people would call "the AI features" cost Dawsons
literally $0 marginal cost per run, no matter how many users run them.
**Those stay free forever** — there's no margin math needed because there's
no cost to recover.

The only place a real per-use cost exists is if we *also* offer a
**cloud-run** path — for users whose machines are too slow, or for future
generative features (Phase 5: arrangement completion, full generation)
that plausibly need bigger models than a laptop can run well. That cloud
path is genuinely new infrastructure we have not built (no server, no
billing, no accounts yet) — this document prices it; it doesn't build it.

## Tier structure

**Free — local processing, unlimited, forever**
- Song → stems/tempo/key/chords/sections (local Demucs + librosa + our chord detector)
- Voice → instrument (local DDSP, once built)
- Reverse & pitch-shift, unlimited projects, unlimited export, Voice Notes
- Cost to us: $0/user regardless of usage — all compute is the user's own hardware

**Pro — $X/month, bundled cloud-generation credits**
- Cloud-accelerated analysis (for slow machines) and future generative features (Phase 5) that run on our servers instead of the user's
- Priced per this document's formula, in credits, so cost scales with actual usage rather than flat-rate underwriting heavy users

## Pricing formula

```
price_per_credit = cost_per_credit / (1 - target_margin)
```

Target margin should sit meaningfully above the 30% floor, not exactly at
it — the cost estimate below is unvalidated (no real infra built yet), and
payment-processor fees, refunds, and idle/overhead compute all eat into
margin before it reaches 30%. Recommend pricing for a ~50-55% target
margin so the realized margin still clears 30% if true costs run 1.5-2x
the estimate.

## Worked example (illustrative — validate against real infra before pricing)

Assumptions (label these as assumptions when presenting to anyone — they
are not measured):
- Cloud GPU instance (e.g. a single mid-tier GPU) ≈ $0.60/hour ≈ $0.01/minute
- One generation/analysis job ≈ 30-45 seconds of GPU time ≈ $0.005-$0.0075
- Overhead (queueing, retries, idle capacity, storage/bandwidth) roughly doubles that → **~$0.015-$0.02 estimated cost per credit**

At target margin 55%: `price_per_credit ≈ $0.02 / 0.45 ≈ $0.044`, round to **$0.05/credit**.

**Suggested plan: Dawsons Pro — $9.99/month, 150 credits included**
- Compute cost: 150 × $0.02 ≈ $3.00
- Payment processing (~2.9% + $0.30, e.g. Stripe): ≈ $0.59
- Total cost ≈ $3.59 → realized margin ≈ **64%** at estimated cost, ≈ **28%** even if true cost is 3x the estimate — the buffer is the point, given the estimate is unvalidated.
- Unused credits **do not roll over** (bounds our liability — a subscriber who pays and never uses credits costs us nothing extra, but one who hoards them can't suddenly cash in 12 months of credits at once).
- Overage: **$0.08/credit** a la carte for users who exceed 150/month (still ≈75% margin at estimated cost).

## What this requires that doesn't exist yet

Before this can launch (distinct from documenting it):
1. **A real cloud inference backend** — GPU hosting, a job queue, an API the desktop app calls instead of (or in addition to) the local sidecar. This is new infrastructure, not a config change.
2. **Payment processing** — a Stripe (or similar) account, which is a real financial/business account only the user can create; subscription billing, webhooks, credit-balance tracking.
3. **User accounts** — something we've deliberately avoided so far (local-first, no login). Credits need to be tied to an identity, which is a scope change worth being deliberate about rather than backing into.
4. **Real cost benchmarking** — actual $/job on the actual chosen cloud provider, before the price in this doc is trusted rather than treated as a starting estimate.

None of this is built. This document is the pricing strategy to build
toward if/when cloud generation features are prioritized — it does not
change anything about the current local-first, zero-server Free tier,
which remains the entire product for now.
