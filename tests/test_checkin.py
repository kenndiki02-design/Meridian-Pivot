import os
import tempfile
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app, API_KEY
from app.store import store, DataStore
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
        assert len(attendees) >= 4

        att1 = next(a for a in attendees if a["id"] == "ATT-001")
        assert att1["status"] == "NOT_CHECKED_IN"


@pytest.mark.asyncio
async def test_standard_checkin_flow():
    """2. Verify standard scan -> PENDING -> Webhook SUCCESS -> CHECKED_IN flow for ATT-001."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Step A: Initiate Scan with valid API Key
        scan_res = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-001"},
            headers={"X-API-Key": API_KEY},
        )
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
        scan1 = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-002"},
            headers={"X-API-Key": API_KEY},
        )
        assert scan1.status_code == 200

        # Rapid Second Scan -> REJECTED (HTTP 409 Conflict)
        scan2 = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-002"},
            headers={"X-API-Key": API_KEY},
        )
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
        scan1 = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-002"},
            headers={"X-API-Key": API_KEY},
        )
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
        scan_again = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-002"},
            headers={"X-API-Key": API_KEY},
        )
        assert scan_again.status_code == 409
        data_again = scan_again.json()
        assert data_again["error_code"] == "ALREADY_CHECKED_IN"
        assert "already checked in" in data_again["message"]


@pytest.mark.asyncio
async def test_idempotent_duplicate_webhook():
    """5. Verify duplicate webhook callback (replay) is handled idempotently without error."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        scan = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-001"},
            headers={"X-API-Key": API_KEY},
        )
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
        await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-003"},
            headers={"X-API-Key": API_KEY},
        )

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
async def test_failed_print_job_recovery_and_retry():
    """7. Verify printer failure webhook updates attendee status to FAILED and allows staff retry."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Scan ATT-004 -> PENDING
        scan = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-004"},
            headers={"X-API-Key": API_KEY},
        )
        job_id = scan.json()["job_id"]

        # Hardware failure webhook from printer
        failed_webhook = {
            "job_id": job_id,
            "attendee_id": "ATT-004",
            "status": "FAILED",
            "sequence_number": 1004,
            "timestamp": "2026-08-23T19:35:15",
            "error_message": "Paper jam hardware fault",
        }
        wh_res = await client.post("/api/webhooks/print-status", json=failed_webhook)
        assert wh_res.status_code == 200
        assert wh_res.json()["current_status"] == "FAILED"

        # Verify staff can execute retry endpoint
        retry_res = await client.post(
            "/api/retry",
            json={"attendee_id": "ATT-004"},
            headers={"X-API-Key": API_KEY},
        )
        assert retry_res.status_code == 200
        retry_data = retry_res.json()
        assert retry_data["success"] is True
        assert retry_data["attendee"]["status"] == "PENDING"


@pytest.mark.asyncio
async def test_attendee_search_and_filter():
    """8. Verify participant search query and status tab filtering."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Search by name "Alice"
        res_search = await client.get("/api/attendees?search=Alice")
        assert res_search.status_code == 200
        data_search = res_search.json()
        assert data_search["count"] == 1
        assert data_search["attendees"][0]["name"] == "Alice Smith"

        # Filter by status "NOT_CHECKED_IN"
        res_filter = await client.get("/api/attendees?status=NOT_CHECKED_IN")
        assert res_filter.status_code == 200
        data_filter = res_filter.json()
        assert data_filter["count"] >= 4


@pytest.mark.asyncio
async def test_api_key_authentication_security():
    """9. Verify security protection rejects unauthorized requests with wrong API Key."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Scan with invalid key -> 401 Unauthorized
        res_unauth = await client.post(
            "/api/scan",
            json={"attendee_id": "ATT-001"},
            headers={"X-API-Key": "WRONG-INVALID-KEY"},
        )
        assert res_unauth.status_code == 401

        # Reset with invalid key -> 401 Unauthorized
        res_reset_unauth = await client.post(
            "/api/reset",
            headers={"X-API-Key": "WRONG-INVALID-KEY"},
        )
        assert res_reset_unauth.status_code == 401


@pytest.mark.asyncio
async def test_persistent_storage_reload():
    """10. Verify state is saved to disk and reloaded cleanly across store restarts."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_db_path = tmp.name

    try:
        # Create DataStore instance A using temp file
        temp_store_a = DataStore(db_file=tmp_db_path)
        temp_store_a.seed_initial_data()
        
        # Modify state in instance A
        await temp_store_a.initiate_scan("ATT-001", "KIOSK-01")
        att_a = await temp_store_a.get_attendee("ATT-001")
        assert att_a.status.value == "PENDING"

        # Initialize DataStore instance B from same file path
        temp_store_b = DataStore(db_file=tmp_db_path)
        att_b = await temp_store_b.get_attendee("ATT-001")
        assert att_b is not None
        assert att_b.status.value == "PENDING"
    finally:
        if os.path.exists(tmp_db_path):
            os.remove(tmp_db_path)


@pytest.mark.asyncio
async def test_attendance_summary_reporting():
    """11. Verify attendance summary reporting and CSV report export endpoints."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Summary JSON endpoint
        summary_res = await client.get("/api/reports/summary")
        assert summary_res.status_code == 200
        summary_data = summary_res.json()
        assert "total_registered" in summary_data
        assert "check_in_rate" in summary_data
        assert len(summary_data["by_ticket_type"]) > 0

        # CSV export endpoint
        csv_res = await client.get("/api/reports/export")
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers["content-type"]
        csv_text = csv_res.text
        assert "Attendee ID,Name,Email,Company" in csv_text
        assert "ATT-001" in csv_text
