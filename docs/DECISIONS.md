# Decisions

What this build decided where the PRD left a question open, why, and what
evidence would change it. §-references are to [`PRD.md`](PRD.md).

The PRD's own Appendix B says the sections most likely to be wrong are §7 (the
object model), §12 (monetisation) and the §13 thresholds. Two of those are now
implemented, which is a useful way to find out.

---

## The six open questions (§14)

### 1. Does anyone want work-level logging, or is the visit the natural unit?

**Not answerable from a keyboard, and the PRD is right to say so** — it wants a
fake-door test or a concierge pilot *before* code. What code can do is make the
question measurable and refuse to prejudge it:

- `/internal/metrics` computes the V0 gate live, and the first row is median
  works logged per active user per month against the threshold of 8. Running
  `npm run metrics` in CI means nobody has to remember to ask.
- The capture screen is built so a "no" would be visible rather than
  engineered around: after logging, it stays put and re-shortlists instead of
  navigating to a confirmation page. If people still log one work per visit,
  the number will say so plainly rather than being masked by a flow that makes
  a single log feel complete.

**What would change it:** the V0 gate failing on real users. The mitigation
would not be more social features — it would be re-examining whether the
Sighting is the right grain at all.

### 2. Which city?

**New York, and the reason is data, not market analysis.**

The PRD lists London, Berlin, New York and Paris, and notes all but Berlin have
an incumbent. But the launch catalogue has to come from somewhere, and the
constraint that actually binds is §10.3: almost nobody publishes what is
currently on the wall. Two institutions do it well enough to seed from — The
Met (a `Gallery Number` in its CC0 dump) and the Art Institute of Chicago (an
`is_on_view` flag in its API). That points at New York or Chicago, and New York
has the gallery density and the student population §14 asks for.

Berlin remains the more interesting strategic answer and the harder data
problem. Choosing it means building the on-view dataset from the crowd with no
institutional bootstrap at all — which the flywheel in §10.3 can do, but slowly,
and R3's cold start gets much worse.

**What would change it:** a partnership that supplies on-view data for a Berlin
or London institution. That single input flips the calculation, which is also
the answer to question 5.

### 3. Reproductions: in or out?

**In, as a distinct and clearly-labelled encounter type — and excluded from
everything that infers physical fact.**

`sightings.encounter` is `original | reproduction`. A reproduction sighting is a
real diary entry, appears in the feed, and can carry a rating and review. It is
excluded from Display inference entirely: seeing a poster of *The Night Watch*
says nothing about where the painting is, and letting it say something would
poison the one dataset nobody else has (§10.3).

This follows R2's reasoning that famous works partially escape geographic
fragmentation. It will annoy purists. The mitigation is labelling, not
prohibition: the type is shown on every sighting, and aggregate ratings on a
Work page can be filtered by it.

**What would change it:** evidence that reproduction sightings crowd out
original ones in the feed, or that ratings from reproductions materially skew
a work's average. Both are measurable once there is traffic.

### 4. Do we need recognition at V0?

**No — and the build treats that as the null hypothesis.**

`VERSO_RECOGNITION` defaults to `gallery-prior`, which uses no model at all. It
shortlists what is on the wall in the room you are standing in, ranked by what
you have not logged, and says so in the UI ("On display in Gallery 766") rather
than implying a match. Search-and-tap is the primary path and works offline.

The `http` provider is the seam for a real model, and the guardrail measures
whether one is needed: every capture records what was offered against what was
chosen, so "users accept the top suggestion 97% of the time" and "users search
instead half the time" are both observable before anyone signs a vendor
contract.

§3.3 says recognition is a commodity and not a moat. A commodity is exactly the
kind of thing to defer until the cheap version is proven insufficient.

**What would change it:** the shortlist being ignored — a high rate of
`chosen_rank = -1` (searched instead) would say the prior is not good enough
and pixels are needed.

### 5. What's the relationship with institutions — partner, customer, or neither?

**Customer, eventually; neither, for now — and the sequencing is deliberate.**

§12 puts institutional analytics first on the plausibility list and attaches a
condition: the aggregation and anonymisation policy must be written *before* the
first institutional conversation. So it is written, in code, in
`src/lib/domain/institutional.mjs`, and tested in
`tests/institutional.test.mjs`:

- k-anonymity at five distinct visitors; thin cells are suppressed, not rounded
- private sightings and private diaries excluded in the SQL, not filtered after
- no user identifier or review text can appear in any response
- no dwell time, no beacons, no location trails — everything is derived from
  logs people chose to make public

Partnership is a different relationship with a different cost: it buys image
rights (§10.5) and on-view data (§10.3), and it costs editorial independence
over the review corpus. The corpus is the only durable asset (§12), so
partnership terms that touch it are refused by default.

**What would change it:** an institution offering on-view data or image rights
with no claim over reviews. That is a partnership worth having and it changes
question 2 as well.

### 6. Is there an acquisition path that isn't organic?

**Not answered here.** It is a distribution question and code cannot settle it.
Two things are built that make the organic path less hopeless:

- **Year in Art** (`/u/<handle>/year/<year>`) — §8 calls the Wrapped mechanic
  Letterboxd's single most effective acquisition surface. It is built to be
  screenshotted: one column, large numbers, no interaction required.
- **Retrospective logging as onboarding** — §9.2. The first screen after signing
  up is a wall of works you have probably already seen, one tap each, undated.
  A profile worth showing someone on day one is the precondition for any
  sharing at all.

---

## Decisions the PRD didn't ask about

### Reviews are a field on a Sighting, not their own table

§7 draws Review as its own leaf. It is implemented as columns on `sightings`,
because a review without the encounter that produced it is an opinion rather
than a record — and reviewing the same work twice, ten years apart, is two
sightings with two reviews, which the separate-table version handles worse.

### Ratings are stored doubled

`rating` is an integer 1–10 meaning 0.5–5.0 stars. Half stars are in §8's V0
scope and floats in a ratings column are a rounding bug waiting to happen.

### Dates carry an explicit precision

`seen_on` is nullable and `date_precision` is one of `day | month | year |
unknown`. §9.2 wants logging from memory to be first-class; forcing a day
either produces fiction or stops the log happening. "Some time in 2019" renders
as "2019", not as 1 January.

### Idempotency is the client's job and the server's contract

Every sighting carries a client-minted UUID. The server returns the existing row
on replay rather than erroring, so the offline queue can retry blind. A replay
carrying a rating added after the first sync applies it; a replay with nulls
never erases what is there. This is what lets §9.1's offline requirement be
structural rather than a retry loop bolted on.

### Auto-accept thresholds are asymmetric on purpose

Reconciliation auto-accepts at 0.92 and queues anything above 0.70. An undated
title+artist match is capped below auto-accept even when both sides are
identical, because that is precisely where the multiple-versions problem §10.2
flags lives. A missed match leaves two rows a human can join later; a wrong
match silently pools two paintings' reviews and is close to undetectable
afterwards. The thresholds encode that asymmetry rather than optimising a
match rate.

### Gamification is absent, not deferred

R7 says points attract check-in farming and cheapen the corpus. There are no
points, no streaks, no badges and no leaderboards. The only counters are
factual — works seen, days out, times revisited — and reviews are never ranked
by anything except likes.

### The feed sorts reviews above bare logs

Within a day, sightings carrying a review sort above those carrying a rating,
which sort above bare logs. Twelve "logged a work" rows from one visit is what
an empty-feeling feed looks like even when the feed is full — a direct
consequence of the §4 bet that had to be handled somewhere.
