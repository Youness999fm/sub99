# Subito Pizza — Requirements (Master Engineering Mission V6)

Source: mission brief given 2026-11-21. One row per requirement; status kept current in `progress.md`.

| ID | Priority | Name | Depends on |
|---|---|---|---|
| SBT-001 | P0 | Automatic restaurant availability (18:00–22:47 Europe/Paris, server-authoritative) | — |
| SBT-002 | P0 | Protected superior access (code 1109) + manual open/close override (AUTO/FORCE_OPEN/FORCE_CLOSED) | SBT-001 |
| SBT-003 | P0 | Scheduled orders while closed | SBT-001 |
| SBT-004 | P0 | Scheduled order reception (alert, list, detail, manual print) | SBT-003 |
| SBT-005 | P0 | Reliable H-45 preparation-ticket scheduling (durable backend job) | SBT-004 |
| SBT-006 | P0 | Thermal receipt category ordering (pizzas → sauce piquante → Tex-Mex box → desserts → drinks) | — |
| SBT-007 | P0 | Pizza size right-alignment on ticket | SBT-006 |
| SBT-008 | P0 | Tex-Mex visible box on ticket | SBT-006 |
| SBT-009 | P1 | Hot sauce choice for delivery, printed in bold | SBT-006 |
| SBT-010 | P1 | Beverage naming (customer vs ticket label) | — |
| SBT-011 | P1 | Customer account social networks page | — |
| SBT-012 | P1 | Professional merchant notification sound | — |

## Discovery findings (2026-11-21, read-only audit before any edit)

- **SBT-001 — ALREADY EXISTS.** `serveur/horaires.js` (`HORAIRES_PAR_DEFAUT='18:00-22:47'`, `creneauActif()`, `commandesOuvertes()`), enforced in `serveur/routes/order_create.js:50-58` (422 `closed` with `opens_at`/`closes_at`) for immediate orders. Active on Vercel or when `HORAIRES_COMMANDES` env is set — off by default locally/tests (deliberate, for local dev convenience). No further work planned unless testing SBT-002 reveals a gap.
- **SBT-002 — PARTIALLY EXISTS.** Super-code (1109) infrastructure (`requireSuperCode()`, `SUPER_CODE_HASH`) already works — not touched. Open/close today is a plain boolean `store_open` in general Réglages (`serveur/routes/owner_settings.js:32-34`, UI in `commercant.js:827-851,1524-1528,2280`), NOT gated by the super code, NOT a tri-state, no "next transition" display. **Build:** AUTO/FORCE_OPEN/FORCE_CLOSED tri-state, moved inside the super-code-gated UI, with auto-expiry at the next scheduled AUTO transition.
- **SBT-003 — ALREADY EXISTS.** `scheduled_for`, `creneauValide()` (`serveur/planification.js:69-76`), `schedule_slots.js`. Will re-verify once SBT-002's override exists (a FORCE_CLOSED day must still accept scheduled orders per the mission).
- **SBT-004 — ALREADY EXISTS.** Dedicated "Programmées" queue (`scheduledOrders()`, `renderScheduled()`), distinct arrival toast, manual print button in the order dialog. Not touched.
- **SBT-005 — MISSING.** No job scheduler, no print-dispatch table anywhere. Printing today is 100% manual/browser-triggered. Needs a real durable job: `print_jobs` table, due-job computation server-side, tablet-poll-driven dispatch (no persistent server→printer channel exists — the architecture is poll-based), status tracking (pending/dispatched/confirmed/failed/unknown), idempotent dispatch, cancellation on reschedule/refusal.
- **SBT-006/007/008 — PARTIALLY EXISTS / MISSING.** `splitTicketItems()` only makes `plats` (pizzas + Tex-Mex together) and `desserts` — no 3rd Tex-Mex box. Pizza size is appended inline in the title string, not right-aligned as its own column (only price is). Size-rank grouping (`ticketSizeRank`) already exists and is reused. No drinks category grouping yet. No hot-sauce line (feature doesn't exist yet).
- **SBT-009 — MISSING.** No "sauce piquante"/`hot_sauce` anywhere in the repo.
- **SBT-010 — Catalog mismatch found.** Current catalog has 10 individual drinks (3 maxi + 7 canette, including TWO Oasis flavors: Pomme Poire AND Pomme Cassis Framboise). The mission's target table lists 9 drinks (3 maxi + 6 canette, only ONE Oasis flavor: Pomme Cassis Framboise). Per the mission's own rule ("do not create duplicate catalogue products… preserve existing functionality") and yesterday's deliberate work adding 10 individual drinks, the extra Oasis Pomme Poire canette is **not removed** — only the 9 matched products get their labels aligned to the mission's table. A customer-vs-ticket label split already exists structurally (`name` vs `line_name` in `serveur/catalogue.js`); will reuse it rather than build a new mechanism.
- **SBT-011 — ALREADY EXISTS.** `reseaux.html` + 2 links from `compte.html`. Not touched.
- **SBT-012 — PARTIALLY EXISTS.** `syncAlarm()`/`playBeep()`: two-tone beep (880Hz→1175Hz), repeats every 1.8s, hard-capped at 30s without a new order (not indefinite repeat-until-ack). On/off toggle only — no volume control, no test-sound button, no multi-order aggregation logic. **Build:** replace with a more distinctive short rhythmic signature, add volume + test button, remove the 30s cap in favor of real acknowledgment, keep aggregation (no overlapping loud sounds for multiple orders).

## Explicit non-goals (per mission's own invariants)

- No real payment transactions, no real customer orders, no production deploy.
- Preserve the small settings icon and existing super-access flow exactly as-is.
- Preserve existing beverage product IDs, prices, images, quantities, historical order snapshots.
- Preserve the auto-print-on-accept behavior already in place.
