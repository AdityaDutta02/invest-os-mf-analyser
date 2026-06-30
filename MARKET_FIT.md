# Market Fit & Audience Psychology

> Machine-readable positioning brief. Companion to `TECH_STACK.md`.
> Product: **Lookr** — see-inside tool for Indian mutual-fund monthly portfolios.
> `[ASSUMED]` tags mark strategic inferences not yet validated by user research — treat as hypotheses.

---

## 1. The problem (job-to-be-done)

Indian retail investors own funds but **cannot see what they actually hold, month to month**.

- Factsheets are PDFs/XLS scattered across ~40+ AMC sites, in inconsistent formats.
- The data is disclosed (SEBI mandates monthly portfolio publication) but **not aggregated, not searchable, not interpreted**.
- Existing apps (Groww, Kuvera, Zerodha Coin, Value Research) optimize for *buying/tracking returns*, not *understanding composition and drift*.

**Core JTBD:** "Help me understand what's inside this fund and how it's positioned — without telling me what to buy."

---

## 2. Target audience

| Segment | Who | What they want | Psychology |
|---|---|---|---|
| **Primary — the curious DIY investor** | Self-directed retail, ₹5L–₹50L portfolios, reads factsheets but finds them painful. | "Show me holdings, concentration, cash, sector tilt — clearly." | Wants *agency and literacy*, distrusts advice-sellers. Values being treated as intelligent. |
| **Secondary — the prosumer / finance-curious builder** | People in/near fintech, analysts, content creators. | Clean structured data + comparison + drift. | Wants *signal density*, hates fluff. Will share if the tool looks credible (Palantir-grade UI signals seriousness). |
| **Tertiary — advisors / RIAs** `[ASSUMED]` | Independent advisors needing quick portfolio reads. | Fast cross-fund compare + factual interpretation. | Wants *defensible, source-attributed* data, not opinions. |

`[ASSUMED]` Segment sizing is inferred from category behavior, not measured. Validate before prioritizing.

---

## 3. Why people don't already do this themselves

- **Friction:** finding the right month's file per AMC is tedious; formats differ; XLS columns vary.
- **Cognition:** raw holdings rows ≠ understanding. People want *deployable cash %, concentration, tilt* — derived signals, not 73 spreadsheet lines.
- **Trust gap:** return-chasing apps feel like they're selling something. A descriptive, non-advisory tool reads as neutral.

The product collapses friction (one normalized contract, auto-fetch + upload) and adds the missing cognition layer (deterministic derivations + bounded AI interpretation).

---

## 4. Positioning & the trust wedge

**Positioning:** *A factual, source-attributed lens into what your funds actually hold — not advice, not a broker.*

The non-advisory stance is **the strategic moat, not a legal footnote:**

- AI is **descriptive/analytical, never advisory** (enforced in the prompt + product copy).
- Numbers are **deterministically derived**, never LLM-guessed → defensible.
- Attribution to **source org only** (AMFI/AMC) → credibility by provenance.
- "Not investment advice" stays visible.

`[ASSUMED]` Hypothesis: a tool that *refuses* to recommend earns more trust with literate DIY investors than one that does. This is the differentiation bet vs advice-led incumbents.

---

## 5. Audience psychology → product decisions

| Psychological driver | Design response (already in product) |
|---|---|
| "Don't sell me, inform me." | Strictly descriptive AI; no buy/sell/rate language. |
| "I want to feel competent, not lectured." | Signal-dense Palantir UI: metric chips, flag pills, sortable holdings — respects expertise. |
| "Is this data real?" | Source-org badges; deterministic numbers; honest "no data — upload" states instead of fabrication. |
| "Don't waste my screen / attention." | Compact collapsed AI strip (~1vh); expand on demand. Internal-scroll holdings table keeps page anchored. |
| "I don't trust black boxes." | Transparent failure reasons (`not_covered`/`not_published`/`parse_failed`/`transient`), confidence flags on AI-extracted PDFs. |
| Loss-aversion / risk-watching | AI surfaces `flags` (elevated cash, single-name concentration) — names risks without prescribing action. |

---

## 6. Differentiation map

| Player | Optimizes for | Gap this product fills |
|---|---|---|
| Groww / Kuvera / Coin | Buying, tracking returns, NAV | Doesn't explain *composition* or month-to-month drift. |
| Value Research / Morningstar | Ratings, recommendations | Advice-led; less about raw current holdings + neutral interpretation. |
| AMC factsheets | Compliance disclosure | Raw, scattered, uninterpreted, not comparable. |
| **Lookr** | **Understanding holdings + neutral interpretation** | Aggregates disclosure + derives signals + non-advisory read. |

`[ASSUMED]` Competitor intent is characterized from public positioning, not insider knowledge.

---

## 7. Adoption logic & moat

- **Wedge:** the curious DIY investor frustrated by factsheet friction.
- **Hook:** instant, clean read of a fund they already hold (curated funds work with zero setup).
- **Retention `[ASSUMED]`:** month-over-month drift + compare become sticky once corpus is broad (Phase 2).
- **Moat compounding:** every fetched/uploaded snapshot enriches the corpus → screener and "who holds stock X" become possible → network-of-data effect.
- **Defensibility:** normalized historical corpus + deterministic derivations + neutral brand are hard to copy quickly; raw data is public but the *aggregation + trust posture* is the asset.

---

## 8. Risks & open questions

| Risk | Note |
|---|---|
| Coverage breadth | Phase 1 covers ~15 AMCs + upload; broad value needs Phase-2 worker. Thin corpus weakens screener/compare. |
| Demand unproven `[ASSUMED]` | "Understand holdings" may be a smaller wedge than assumed; many retail users only care about returns. Validate. |
| Neutrality vs monetization tension `[ASSUMED]` | Non-advisory stance limits obvious monetization (no lead-gen to brokers). Need a model that doesn't betray the trust wedge. |
| Factsheet format drift | AMCs change formats; parser/recipes need maintenance. |
| PDF top-N disclosure | Some factsheets disclose only top-10 (~46% of NAV) → must frame as partial, lean on fund-wide metrics, never imply under-investment. |

---

## 9. One-line summary

**For literate DIY Indian MF investors who distrust advice-sellers — a fast, neutral, source-attributed lens that shows what a fund actually holds and how it's positioned, and interprets it without ever telling you what to buy.**
