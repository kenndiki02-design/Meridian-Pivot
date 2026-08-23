import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.store import store
from app.queue_simulator import queue_simulator


@pytest_asyncio.fixture(autouse=True)
async def setup_test_store():
    """Reset data store before each test."""
    store.seed_initial_data()
    queue_simulator.auto_dispatch = False  # Disable background timer dispatch during unit tests for deterministic testing
    yield
    queue_simulator.auto_dispatch = True


@pytest.mark.asyncio
async def test_attendee_initial_state():
    """1. Verify initial pre-loaded test attendees are in NOT_CHECKED_IN state."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/attendees")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        attendees = data["attendees"]
        assert len(attendees) >= 3

        att1 = next(a for a in attendees if a["id"] == "ATT-001")
        assert att1["status"] == "NOT_CHECKED_IN"


@pytest.mark.asyncio
async def test_standard_checkin_flow():
    """2. Verify standard scan -> PENDING -> Webhook SUCCESS -> CHECKED_IN flow for ATT-001."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Step A: Initiate Scan
        scan_res = await client.post("/api/scan", json={"attendee_id": "ATT-001"})
        assert scan_res.status_code == 200
        scan_data = scan_res.json()
        assert scan_data["success"] is True
        assert scan_data["attendee"]["status"] == "PENDING"
        job_id = scan_data["job_id"]
        assert job_id.startswith("JOB-")

        # Verify attendee state in store is now PENDING
        att_res = await client.get("/api/attendees/ATT-001")
        assert att_res.json()["attendee"]["status"] == "PENDING"

        # Step B: Vendor Badge Printer sends SUCCESS webhook callback
        webhook_payload = {
            "job_id": job_id,
            "attendee_id": "ATT-001",
            "status": "SUCCESS",
            "sequence_number": 1001,
            "timestamp": "2026-08-23T19:35:00",
        }
        wh_res = await client.post("/api/webhooks/print-status", json=webhook_payload)
        assert wh_res.status_code == 200
        wh_data = wh_res.json()
        assert wh_data["action_taken"] == "PROCESSED"
        assert wh_data["current_status"] == "CHECKED_IN"

        # Verify final state is CHECKED_IN
        final_att = await client.get("/api/attendees/ATT-001")
        assert final_att.json()["attendee"]["status"] == "CHECKED_IN"


@pytest.mark.asyncio
async def test_duplicate_scan_protection_pending():
    """3. Verify duplicate scan protection while attendee is PENDING."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # First Scan -> PENDING
        scan1 = await client.post("/api/scan", json={"attendee_id": "ATT-002"})
        assert scan1.status_code == 200

        # Rapid Second Scan -> REJECTED (HTTP 409 Conflict)
        scan2 = await client.post("/api/scan", json={"attendee_id": "ATT-002"})
        assert scan2.status_code == 409
        data2 = scan2.json()
        assert data2["success"] is False
        assert data2["error_code"] == "CHECKIN_PENDING"
        assert "PENDING" in data2["message"]


@pytest.mark.asyncio
async def test_duplicate_scan_protection_checked_in():
    """4. Verify duplicate scan protection when attendee is ALREADY CHECKED IN."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Scan and finalize check-in
        scan1 = await client.post("/api/scan", json={"attendee_id": "ATT-002"})
        job_id = scan1.json()["job_id"]

        webhook = {
            "job_id": job_id,
            "attendee_id": "ATT-002",
            "status": "SUCCESS",
            "sequence_number": 1002,
            "timestamp": "2026-08-23T19:35:05",
        }
        await client.post("/api/webhooks/print-status", json=webhook)

        # Subsequent scan attempt on checked-in attendee -> REJECTED (HTTP 409)
        scan_again = await client.post("/api/scan", json={"attendee_id": "ATT-002"})
        assert scan_again.status_code == 409
        data_again = scan_again.json()
        assert data_again["error_code"] == "ALREADY_CHECKED_IN"
        assert "already checked in" in data_again["message"]


@pytest.mark.asyncio
async def test_idempotent_duplicate_webhook():
    """5. Verify duplicate webhook callback (replay) is handled idempotently without error."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        scan = await client.post("/api/scan", json={"attendee_id": "ATT-001"})
        job_id = scan.json()["job_id"]

        webhook = {
            "job_id": job_id,
            "attendee_id": "ATT-001",
            "status": "SUCCESS",
            "sequence_number": 1001,
            "timestamp": "2026-08-23T19:35:00",
        }

        # First webhook delivery -> PROCESSED
        wh1 = await client.post("/api/webhooks/print-status", json=webhook)
        assert wh1.json()["action_taken"] == "PROCESSED"

        # Duplicate webhook delivery (retransmitted by vendor) -> IGNORED
        wh2 = await client.post("/api/webhooks/print-status", json=webhook)
        assert wh2.status_code == 200
        data2 = wh2.json()
        assert data2["action_taken"] == "IGNORED"
        assert "already finalized" in data2["message"]


@pytest.mark.asyncio
async def test_out_of_order_webhook_handling():
    """6. Verify out-of-order webhook sequence guard ignores stale sequence numbers."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Step A: Scan ATT-003
        await client.post("/api/scan", json={"attendee_id": "ATT-003"})

        # Step B: Receive sequence 2000 webhook (newer sequence)
        webhook_new = {
            "job_id": "JOB-NEW-2000",
            "attendee_id": "ATT-003",
            "status": "SUCCESS",
            "sequence_number": 2000,
            "timestamp": "2026-08-23T19:35:10",
        }
        wh_new = await client.post("/api/webhooks/print-status", json=webhook_new)
        assert wh_new.json()["action_taken"] == "PROCESSED"

        # Step C: Receive sequence 999 webhook (stale out-of-order sequence)
        webhook_stale = {
            "job_id": "JOB-OLD-0999",
            "attendee_id": "ATT-003",
            "status": "SUCCESS",
            "sequence_number": 999,
            "timestamp": "2026-08-23T19:34:00",
        }
        wh_stale = await client.post("/api/webhooks/print-status", json=webhook_stale)
        assert wh_stale.status_code == 200
        data_stale = wh_stale.json()
        assert data_stale["action_taken"] == "IGNORED"
        assert "older than processed seq" in data_stale["message"]


@pytest.mark.asyncio
async def test_failed_print_job_recovery():
    """7. Verify printer failure webhook resets attendee status to NOT_CHECKED_IN to allow re-scan."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Scan ATT-004 -> PENDING
        scan = await client.post("/api/scan", json={"attendee_id": "ATT-004"})
        job_id = scan.json()["job_id"]

        # Hardware failure webhook from printer
        failed_webhook = {
            "job_id": job_id,
            "attendee_id": "ATT-004",
            "status": "FAILED",
            "sequence_number": 1004,
            "timestamp": "2026-08-23T19:35:15",
            "error_message": "Paper out",
        }
        wh_res = await client.post("/api/webhooks/print-status", json=failed_webhook)
        assert wh_res.status_code == 200
        assert wh_res.json()["current_status"] == "NOT_CHECKED_IN"

        # Verify staff can scan again after failure
        rescan = await client.post("/api/scan", json={"attendee_id": "ATT-004"})
        assert rescan.status_code == 200
        assert rescan.json()["success"] is True
