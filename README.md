# Solstice Events - Asynchronous Kiosk Check-In & Badge Printer System

An event check-in kiosk application built for **Solstice Events Co.** to handle high-throughput event check-ins during multi-day technology conferences.

This application implements the architecture pivot required by the badge-printer vendor's deprecation of synchronous REST printing in favor of an **asynchronous message queue with webhook callback confirmations**.

---

## ⚡ The Pivot Context

Previously, kiosk staff scanned an attendee's QR code and waited synchronously for the badge printer REST API to finish printing before showing "Checked In" on screen.

Under the new **Asynchronous Architecture**:
1. Staff scan an attendee's QR code at the kiosk.
2. The kiosk updates the attendee status to `PENDING` and publishes a print request onto the vendor's message queue.
3. The kiosk UI immediately reflects the `PENDING` state while waiting for printer confirmation.
4. The badge printer processes the job asynchronously and invokes Solstice's webhook endpoint (`/api/webhooks/print-status`).
5. On receipt of a valid `SUCCESS` webhook payload, the attendee state transitions to `CHECKED_IN`.
6. **Duplicate Scan Protection**: Rejects duplicate scans during `PENDING` or `CHECKED_IN` states with an HTTP `409 Conflict` error.
7. **Out-of-Order & Idempotency Resilience**: Monotonic sequence tracking ensures out-of-order webhooks do not corrupt attendee states, and duplicate webhook delivery is handled safely.

---

## 🚀 Architecture & State Machine

```
   +-------------------+
   | Staff Scans QR    |
   +---------+---------+
             |
             v
   +-------------------+       Is Attendee PENDING or      YES ➔ REJECT (HTTP 409 Conflict)
   | Duplicate Scan    | ----------------------------------+   "Duplicate scan blocked"
   | Check             |
   +---------+---------+
             | NO (NOT_CHECKED_IN)
             v
   +-------------------+
   | State ➔ PENDING   |
   | Publish Print Job |
   +---------+---------+
             |
             v
   +-------------------+
   | Vendor Queue      | ── Async Print Delay (1.5s) ──>  Vendor Hardware Printing
   +-------------------+                                          |
                                                                  v
   +-------------------+                               Webhook Callback
   | State ➔ CHECKED_IN| <── Monotonic Sequence & ────── POST /api/webhooks/print-status
   +-------------------+     Idempotency Guard
```

---

## 🛠️ Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI app, REST endpoints & static mounting
│   ├── models.py           # Pydantic schemas, Enums, Webhook & Log models
│   ├── store.py            # Thread-safe in-memory state store & sequence guard
│   └── queue_simulator.py  # Asynchronous vendor print queue & webhook dispatcher
├── static/
│   ├── index.html          # Interactive Kiosk UI with live audit logs & test controls
│   ├── styles.css          # Glassmorphism dark UI design system
│   └── app.js              # Frontend state polling, event handlers & toast alerts
├── tests/
│   ├── __init__.py
│   └── test_checkin.py     # Pytest test suite (7+ test scenarios)
├── README.md               # System documentation & setup guide
├── JOURNAL.md              # Learning & Blocker evidence journal
└── requirements.txt        # Python dependencies
```

---

## 💻 Installation & Running Locally

### 1. Prerequisites
- Python 3.9+ installed.

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Start Application Server
```bash
python -m uvicorn app.main:app --reload --port 8000
```
Open your browser to: **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

### 4. Run Automated Tests
```bash
python -m pytest tests/ -v
```

---

## 🧪 Test Attendees & Edge-Case Triggers

The system comes pre-loaded with required test attendees:

| Attendee ID | Name | Role | Test Coverage Scenario |
| ----------- | ---- | ---- | ---------------------- |
| `ATT-001` | Alice Smith | Standard Pass | Standard Async Check-In (`NOT_CHECKED_IN` ➔ `PENDING` ➔ `CHECKED_IN`) |
| `ATT-002` | Bob Jones | VIP Pass | Duplicate Scan Protection (Rapid scan triggers HTTP 409 Conflict) |
| `ATT-003` | Charlie Brown | Speaker Pass | Out-of-Order Webhook Delivery & Idempotency Replay Guard |
| `ATT-004` | Diana Prince | Organizer | Hardware Print Failure Recovery (Resets to `NOT_CHECKED_IN` for retry) |

---

## 📡 API Specs & Endpoint Summary

- `GET /api/attendees`: Retrieve all attendees and current check-in states.
- `POST /api/scan`: Issue scan check-in. Body: `{"attendee_id": "ATT-001"}`. Returns HTTP 200 or 409 Conflict.
- `POST /api/webhooks/print-status`: Webhook endpoint for printer vendor callbacks. Body: `{"job_id": "JOB-xxx", "attendee_id": "ATT-001", "status": "SUCCESS", "sequence_number": 1001, "timestamp": "..."}`.
- `POST /api/simulate/out-of-order`: Simulates edge-case webhooks for interactive visual testing.
- `POST /api/reset`: Reset state back to clean test data.
