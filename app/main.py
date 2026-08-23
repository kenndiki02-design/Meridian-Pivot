from fastapi import FastAPI, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os

from app.models import (
    ScanRequest,
    ScanResponse,
    WebhookPayload,
    WebhookResponse,
    OutOfOrderSimRequest,
)
from app.store import store
from app.queue_simulator import queue_simulator

app = FastAPI(
    title="Solstice Events - Kiosk Check-In & Badge Printer API",
    description="Asynchronous badge printing API with duplicate scan protection & out-of-order webhook handling.",
    version="2.0.0",
)

# Enable CORS for local kiosk clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/attendees")
async def get_attendees():
    """Retrieve list of all attendees and their current check-in states."""
    attendees = await store.get_all_attendees()
    return {"success": True, "attendees": attendees}


@app.get("/api/attendees/{attendee_id}")
async def get_attendee_by_id(attendee_id: str):
    """Retrieve single attendee details."""
    attendee = await store.get_attendee(attendee_id)
    if not attendee:
        raise HTTPException(status_code=404, detail=f"Attendee '{attendee_id}' not found.")
    return {"success": True, "attendee": attendee}


@app.post("/api/scan", response_model=ScanResponse)
async def scan_attendee(request: ScanRequest):
    """
    Handle staff scanning an attendee's QR code at kiosk.
    Enforces duplicate scan protection:
    - If status is PENDING or CHECKED_IN, returns 409 Conflict.
    - If status is NOT_CHECKED_IN, sets status to PENDING and queues async print job.
    """
    success, scan_resp = await store.initiate_scan(request.attendee_id, request.kiosk_id)

    if not success:
        if scan_resp.error_code in ("ALREADY_CHECKED_IN", "CHECKIN_PENDING"):
            return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=scan_resp.model_dump())
        elif scan_resp.error_code == "ATTENDEE_NOT_FOUND":
            return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content=scan_resp.model_dump())
        else:
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=scan_resp.model_dump())

    # Trigger asynchronous print queue simulation
    if scan_resp.job_id:
        attendee = await store.get_attendee(request.attendee_id)
        seq_num = attendee.last_processed_seq if attendee else 1000
        # Fetch the created job to get exact sequence number
        jobs = await store.get_print_jobs()
        target_job = next((j for j in jobs if j.job_id == scan_resp.job_id), None)
        actual_seq = target_job.sequence_number if target_job else 1001

        await queue_simulator.enqueue_print_job(
            job_id=scan_resp.job_id,
            attendee_id=request.attendee_id,
            sequence_number=actual_seq,
        )

    return scan_resp


@app.post("/api/webhooks/print-status", response_model=WebhookResponse)
async def handle_print_status_webhook(payload: WebhookPayload):
    """
    Vendor webhook callback endpoint triggered when badge printing completes/fails.
    Handles out-of-order delivery sequence numbers and idempotency.
    """
    response = await store.process_webhook(payload)
    return response


@app.get("/api/queue")
async def get_queue():
    """Retrieve list of active print jobs."""
    jobs = await store.get_print_jobs()
    return {"success": True, "queue": jobs}


@app.get("/api/logs")
async def get_logs():
    """Retrieve system event logs."""
    logs = store.logs
    return {"success": True, "logs": logs}


@app.post("/api/simulate/out-of-order")
async def simulate_out_of_order(request: OutOfOrderSimRequest):
    """
    Trigger manual webhook simulation for testing duplicate callbacks or out-of-order sequences.
    """
    payload = WebhookPayload(
        job_id=request.job_id or f"SIM-JOB-{request.sequence_number}",
        attendee_id=request.attendee_id,
        status=request.status,
        sequence_number=request.sequence_number,
        timestamp="2026-08-23T19:35:00",
        error_message=None if request.status == "SUCCESS" else "Simulated Error",
    )
    resp = await store.process_webhook(payload)
    return {"success": True, "simulation_result": resp}


@app.post("/api/reset")
async def reset_system():
    """Reset data store and simulation state back to initial seed data."""
    store.seed_initial_data()
    return {"success": True, "message": "System state reset to initial seed data."}


# Mount Static UI directory
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def serve_index():
    """Serve visual Kiosk Web App UI."""
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Solstice Events Check-In API v2.0. Visit /docs for Swagger UI."}
