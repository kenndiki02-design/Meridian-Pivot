# Learning & Blocker Evidence Journal - Solstice Events Check-In System

**Project:** Meridian Pivot Simulation — Event Check-In Kiosk  
**Client:** Solstice Events Co.  
**Technology Stack:** Python 3.9+, FastAPI, Uvicorn, Pydantic, Pytest, HTML5/CSS3 Glassmorphism  
**Date:** August 23, 2026  

---

## 1. Executive Summary

Solstice Events Co. operates multi-day technology conferences using event check-in kiosks. The original architecture relied on synchronous calls to the venue badge printer's REST API, holding HTTP connections open until printing completed. Due to vendor deprecation of the synchronous API, the system had to be rebuilt around an **asynchronous message queue and webhook callback architecture**.

This journal documents the technical challenges, architectural choices, blockers encountered during the pivot, and empirical verification evidence confirming system reliability.

---

## 2. Technical Requirements & Architectural Solutions

| Requirement | Challenge / Edge Case | Architectural Solution |
| ----------- | --------------------- | ---------------------- |
| **1. Python Check-In Logic** | Fast API response required without blocking UI. | Created FastAPI service with non-blocking background queue simulation. |
| **2. Duplicate Scan Protection** | Staff scanning QR code twice during pending print. | Reject scans for attendees in `PENDING` or `CHECKED_IN` with HTTP `409 Conflict`. |
| **3. Async Queue Simulation** | Simulating vendor hardware delay. | Created `PrintQueueSimulator` with async tasks and simulated callback dispatchers. |
| **4. Webhook Endpoint** | Receiving print confirmation callbacks. | Implemented `POST /api/webhooks/print-status` callback endpoint. |
| **5. Pending & Check-In State** | UI cannot instantly mark "Checked In". | State machine: `NOT_CHECKED_IN` ➔ `PENDING` (print queued) ➔ `CHECKED_IN` (webhook confirmed). |
| **6. Out-of-Order Webhooks** | Late or out-of-order network packets. | Monotonic sequence number check (`incoming_seq < last_processed_seq` -> Ignore). |
| **7. Idempotent Retries** | Duplicate webhook callbacks from vendor retries. | Implemented `processed_job_ids` registry set to safely ignore duplicate job callbacks. |

---

## 3. Blockers Encountered & Mitigations

### 🚧 Blocker 1: Race Condition on Concurrent Duplicate Scans
- **Problem:** If kiosk staff rapidly scan an attendee QR code twice in quick succession (e.g. 50ms apart), both requests might read `NOT_CHECKED_IN` simultaneously before either updates the state, resulting in two duplicate print jobs being queued.
- **Root Cause:** Non-atomic read-then-write operations across concurrent async requests.
- **Mitigation:** Implemented an `asyncio.Lock()` in `DataStore` around `initiate_scan`. The duplicate check and status transition to `PENDING` occur atomically within the lock boundary.
- **Verification:** Unit test `test_duplicate_scan_protection_pending` executes back-to-back scan requests, confirming the 2nd request receives HTTP 409 Conflict.

---

### 🚧 Blocker 2: Out-of-Order Webhook Delivery Packet Inversion
- **Problem:** In an asynchronous message broker environment, webhooks may arrive out of order (e.g. a retransmitted older sequence packet arriving after a newer sequence packet has already completed). Accepting the older packet could revert an attendee's status or sequence state.
- **Root Cause:** Lack of state sequence tracking.
- **Mitigation:** Added a `last_processed_seq` attribute to the `Attendee` model. Every print job assigns a strictly increasing sequence number. When a webhook arrives, the system verifies `incoming_seq >= attendee.last_processed_seq`. If an incoming sequence is smaller, the payload is rejected with `action_taken: "IGNORED"`.
- **Verification:** Unit test `test_out_of_order_webhook_handling` triggers sequence #2000 followed by sequence #999, verifying that #999 is ignored.

---

### 🚧 Blocker 3: Hardware Print Failures Trapping Attendees in Pending State
- **Problem:** If the badge printer runs out of paper or experiences a hardware error, the print job fails. If the attendee remains in `PENDING` state indefinitely, staff cannot re-scan them.
- **Root Cause:** Absence of a failure state recovery mechanism in the webhook state machine.
- **Mitigation:** Updated `process_webhook` to handle `status: "FAILED"`. On print failure, the attendee status is reset from `PENDING` back to `NOT_CHECKED_IN`, releasing the lock and allowing kiosk staff to re-scan.
- **Verification:** Unit test `test_failed_print_job_recovery` triggers a `FAILED` webhook and verifies the attendee state reverts to `NOT_CHECKED_IN`.

---

## 4. Key Learnings & Takeaways

1. **Decouple UI Feedback from Event Finalization:** In async architectures, UI state must explicitly acknowledge the transition phase (`PENDING`) rather than assuming immediate completion.
2. **Idempotency is Essential:** Webhook delivery mechanisms (such as AWS SQS or Webhook retries) guarantee at-least-once delivery, not exactly-once. System endpoints must be designed idempotently.
3. **Atomic State Guards:** High-frequency event scanning requires atomic lock guards on state mutation endpoints to enforce duplicate protection reliably.

---

## 5. Automated Test Suite Verification Evidence

```text
============================= test session starts =============================
platform win32 -- Python 3.12, pytest-8.3.4, pluggy-1.5.0
rootdir: c:\Users\Admin\OneDrive\Desktop\Meridian Pivot
plugins: asyncio-0.25.3
asyncio: mode=Mode.STRICT

tests/test_checkin.py::test_attendee_initial_state PASSED              [ 14%]
tests/test_checkin.py::test_standard_checkin_flow PASSED               [ 28%]
tests/test_checkin.py::test_duplicate_scan_protection_pending PASSED   [ 42%]
tests/test_checkin.py::test_duplicate_scan_protection_checked_in PASSED [ 57%]
tests/test_checkin.py::test_idempotent_duplicate_webhook PASSED        [ 71%]
tests/test_checkin.py::test_out_of_order_webhook_handling PASSED       [ 85%]
tests/test_checkin.py::test_failed_print_job_recovery PASSED          [100%]

============================== 7 passed in 0.45s ==============================
```
