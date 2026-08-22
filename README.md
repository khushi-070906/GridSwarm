# GridSwarm — Flexibility Coordination Layer (MVP)

Constraint-based, explainable backend implementing the six-step loop from
the pitch deck: **Detect → Identify → Estimate → Protect → Optimize → Dispatch**.

## Run it

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Interactive API docs: http://localhost:8000/docs

Try the deck's exact scenario:
```bash
curl "http://localhost:8000/demo-scenario?target_reduction_kw=30"
```

Run the safety tests:
```bash
pip install pytest
pytest test_gridswarm.py -v
```

## How the objective function works (the question judges will ask)

An EV is **PROTECTED** — zero flexibility, no action ever taken — if any of:
- departure is under 30 minutes away,
- current SOC is already at/below the required departure SOC,
- the owner hasn't opted in for this session (consent layer).

Everything else gets a **flexibility score** = usable energy headroom (kWh)
above the required minimum, discounted by a dwell-time confidence factor
(shorter time until departure = steeper discount, so the optimizer trusts
long-dwell EVs more).

The optimizer ranks candidates `V2G > HIGH > MEDIUM > LOW` flexibility and
greedily assigns the least-intrusive sufficient action (pause → reduce rate →
discharge → solar-align) until the target kW reduction is met. In
**extreme-event mode** (`is_extreme_event: true`) the target is padded 15%
for a more aggressive brownout-prevention response — but PROTECTED EVs are
still structurally excluded, so `mobility_violations` is always 0. This is
enforced by `test_dispatch_plan_never_produces_mobility_violations`, which
fuzzes 10 random 40-EV fleets under a worst-case extreme event.

## Files

- `app/models.py` — EV, GridConstraintSignal, DispatchPlan schemas
- `app/flexibility.py` — per-EV scoring + protection rules
- `app/optimizer.py` — ranking + greedy dispatch assignment
- `app/simulator.py` — synthetic fleet generator (stands in for OCPP/telemetry)
- `app/main.py` — FastAPI endpoints
- `n8n_workflow.json` — importable n8n workflow matching the deck's event chain
- `test_gridswarm.py` — safety-guarantee tests

## Endpoints

| Method | Path                 | Purpose                                        |
|--------|----------------------|-------------------------------------------------|
| GET    | `/fleet/demo`        | The 8-EV, 7 PM / 96% capacity deck scenario     |
| GET    | `/fleet/random`      | Randomly generated fleet (`?n=30&seed=1`)       |
| GET    | `/fleet/depot`       | Depot fleet (`?depot_type=delivery\|school_bus`) |
| POST   | `/fleet/flexibility` | Flexibility scores for a fleet you POST         |
| POST   | `/grid-event`        | Full pipeline: signal + fleet → dispatch plan   |
| GET    | `/demo-scenario`     | Convenience: runs the deck scenario end-to-end  |
| GET    | `/depot-scenario`    | Convenience: fleet-depot pilot end-to-end       |
| POST   | `/emergency-event`   | Brownout-prevention mode, your signal + fleet   |
| GET    | `/emergency-scenario`| Convenience: deck fleet under forced emergency  |
| GET    | `/ledger/entries`    | Full payout history (SQLite-persisted)          |
| GET    | `/ledger/totals`     | Running INR total per EV                        |
| GET    | `/fleet/live`        | Live fleet from connected OCPP chargers          |
| POST   | `/ocpp/session-policy/{id}` | Set departure/SOC/consent for a charge point |
| POST   | `/grid-event/live`   | Full pipeline against the live OCPP fleet        |

## Roadmap (from the deck) mapped to this repo

1. **Simulation MVP** — this repo, done.
2. **Pilot** — fleet depot pilot (Amazon/Zomato/Swiggy dark stores, school
   buses) is the recommended first pilot: homogeneous vehicles, known
   departure schedules, single owner, no per-driver consent friction.
3. **Real Chargers** — done: `app/ocpp_listener.py` is a real OCPP 1.6-J
   central system feeding live `EV` objects into `/grid-event/live`
   (`app/simulator.py` remains available for the demo/pitch scenarios).
4. **Utility** — `/emergency-event` now has API-key auth, per-key rate
   limiting, and zone registration (see below); still needs mTLS/signed
   requests and self-serve key provisioning before a real DISCOM/DSO
   integration.
5. **Network** — multiple zones, each with its own optimizer instance.

## Consent/incentive layer

`opted_in_v2g` gates participation (an opted-out EV is PROTECTED, same as an
imminent departure). Every non-zero action also earns a payout via
`app/incentives.py`, tiered by intrusiveness:

| Action          | INR/kWh |
|-----------------|---------|
| Discharge (V2G) | 9.0     |
| Pause charging  | 4.0     |
| Reduce rate     | 2.5     |
| Solar align     | 1.5     |

`POST /grid-event`, `/depot-scenario`, `/emergency-event`, and
`/emergency-scenario` all post payouts to a **SQLite-persisted** ledger
(`app/ledger.py`, file `gridswarm_ledger.db` by default — override with the
`GRIDSWARM_DB_PATH` env var). `GET /ledger/totals` returns a running INR
total per EV, and survives a server restart.

## Fleet-depot pilot variant

`GET /fleet/depot?depot_type=delivery` (Amazon/Zomato/Swiggy dark-store
vans, shared overnight charge → shared early-morning dispatch) or
`?depot_type=school_bus` (all-day depot charge → shared afternoon route).
Both are single-owner fleets, so every vehicle is `opted_in_v2g=True` by
construction — no per-driver consent friction, which the deck review
flagged as an easier, more fundable first pilot than consumer apartments.
`GET /depot-scenario` runs the full pipeline end to end and posts to the
ledger, same as `/grid-event`.

## Extreme-event / brownout-prevention mode

Pulled out as its own endpoint (`POST /emergency-event`, or
`GET /emergency-scenario` for the deck's demo fleet under a forced
emergency) rather than a buried flag — this is the "If Extreme Event
Occurs → Escalate to Grid Operator" branch from the deck's infographic.
Same dispatch pipeline, `is_extreme_event=True` forced on, target padded
15% so the optimizer dips into LOW-flexibility EVs sooner. PROTECTED EVs
are still structurally untouched, so `mobility_violations` stays 0 even
here — enforced by the fuzz test in `test_gridswarm.py`.

## Dashboard

`dashboard.html` is a single self-contained file — no npm install, no build
step. Open it directly in a browser (double-click it, or drag it into a
browser tab) while the backend is running on port 8000. It talks to the API
straight from your browser via `fetch()`, so both need to be running at the
same time:

1. `uvicorn app.main:app --port 8000` (leave this terminal running)
2. Open `dashboard.html`

It shows a live "swarm" view — a central transformer node with each EV/van/
bus orbiting it, lines pulsing toward the center for every dispatched
action, colored by action type (violet = discharge/V2G, teal = pause or
reduce, amber = solar-align, green = protected). Buttons along the bottom
run each of the four scenarios (`/demo-scenario`, `/depot-scenario` ×2,
`/emergency-scenario`); a live feed and the SQLite-backed payout ledger
update after each run. If the API field at top-right ever needs to point
somewhere else (a different port, a deployed URL), edit it directly — no
rebuild needed.

This was built and tested end-to-end (jsdom + a real fetch against a live
server, all 4 scenarios, checked for zero JS errors and zero mobility
violations) before being handed off — see the git history / ask if you want
that harness back.

## Real chargers (OCPP 1.6)

Roadmap step 3 is no longer hypothetical: `app/ocpp_listener.py` is a real
OCPP 1.6-J central system (WebSocket server) that turns live charger
telemetry into the same `EV` objects the simulator fabricates.

**Why it's not a drop-in swap.** OCPP tells you charger/session state
(status, meter values, transaction start/stop) but has no concept of "when
does the driver need this vehicle back" or "what SOC do they need at
departure" — that's trip-scheduling info, not charger telemetry. So live
EVs are built from two sources merged together:

1. **OCPP telemetry** — SoC (from `MeterValues` if the charger reports the
   `SoC` measurand), charging status, live power draw.
2. **Session policy** — `required_soc_percent` / `departure_minutes` /
   `battery_kwh` / `opted_in_v2g`, set per charge point via
   `POST /ocpp/session-policy/{charge_point_id}`. A real deployment would
   populate this from the depot's dispatch schedule or a driver-facing app
   instead of a manual call; it defaults to a conservative "leaving soon,
   not V2G-eligible" policy so an unconfigured charger is never treated as
   more flexible than it actually is. Charge points with no SoC reading yet
   are omitted from the fleet rather than guessed at.

**Turning it on:**
```bash
GRIDSWARM_OCPP_ENABLED=1 uvicorn app.main:app --port 8000
```
This starts the OCPP WebSocket listener on port 9000 alongside the HTTP
API (override with `GRIDSWARM_OCPP_PORT`). It's off by default so the
normal simulator-based demo flow needs zero extra config.

**Connecting a charger** (real, or the bundled fake one for testing):
a real charger points its OCPP 1.6 connection at
`ws://<host>:9000/<charge_point_id>` with the `ocpp1.6` subprotocol. To
try it without hardware:
```bash
python scripts/simulate_charge_point.py CP_001 --soc-start 55 --soc-end 82
```

**Using the live fleet:**
```bash
curl "http://localhost:8000/fleet/live"
curl -X POST "http://localhost:8000/ocpp/session-policy/CP_001" \
  -H "Content-Type: application/json" \
  -d '{"required_soc_percent": 60, "departure_minutes": 400, "opted_in_v2g": true}'
curl -X POST "http://localhost:8000/grid-event/live" \
  -H "Content-Type: application/json" \
  -d '{"signal": {"zone_id": "zone-1", "utilization_percent": 95, "target_reduction_kw": 10}}'
```
`/fleet/live` defaults to `only_connected=true` — a charger that has
disconnected won't show up or get dispatched to, on the same
protect-first principle as the rest of the safety model. Pass
`?only_connected=false` to see last-known state from chargers that have
since dropped off.

## DISCOM/DSO auth (utility-facing endpoints)

`/emergency-event` and `/emergency-scenario` are the two endpoints an
actual grid operator would call (the "Escalate to Grid Operator" branch),
so — unlike the rest of the API, which stays open for n8n/demo use — they
require an API key, are rate-limited per key, and check the key is
registered for the zone it's signalling:

```bash
GRIDSWARM_API_KEYS="discom-bescom-2f9a:transformer-zone-7|transformer-zone-8,discom-demo-key:*" \
GRIDSWARM_RATE_LIMIT_PER_MINUTE=30 \
uvicorn app.main:app --port 8000
```
Format: `key:zone1|zone2,key2:zone3` — a zone list of `*` allows any zone.
If `GRIDSWARM_API_KEYS` is unset, a permissive demo key
(`gridswarm-demo-key` → `*`) is registered automatically so the endpoints
still work out of the box locally.

```bash
curl -X POST "http://localhost:8000/emergency-event" \
  -H "X-API-Key: gridswarm-demo-key" -H "Content-Type: application/json" \
  -d '{"zone_id": "zone-1", "utilization_percent": 99, "target_reduction_kw": 40, "evs": [...]}'
```
Missing/invalid key → `401`. Valid key, wrong zone → `403`. Over the rate
limit → `429` with a `Retry-After` header.

## Not yet built

- **DISCOM/DSO-facing API**: auth, rate limiting, and zone registration
  are now in place (see above); still missing: mutual TLS / signed
  requests for production-grade utility integration, and a self-serve key
  provisioning flow (keys are currently set via env var).
- **OCPP 2.0.1 support**: only 1.6-J is implemented; 2.0.1 has a richer
  device model but the mapping problem (telemetry vs. trip planning) is
  the same.
- **Multi-zone / Network** (roadmap step 5): each zone would need its own
  optimizer instance; not started.
