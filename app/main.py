import os
import io
import csv
from typing import Optional
from fastapi import FastAPI, HTTPException, Header, Query, status, Depends, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    ScanRequest,
    ScanResponse,
    RetryRequest,
    WebhookPayload,
    WebhookResponse,
    OutOfOrderSimRequest,
    AttendanceSummaryReport,
    AuthVerifyResponse,
)
from app.store import store
from app.queue_simulator import queue_simulator

API_KEY = os.getenv("SOLSTICE_API_KEY", "solstice-secret-key-2026")

app = FastAPI(
    title="Solstice Events - Kiosk Check-In & Badge Printer API",
    description="Asynchronous badge printing API with duplicate scan protection, search, retries, reporting & persistent storage.",
    version="2.1.0",
)

# Enable CORS for local kiosk clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def verify_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    api_key: Optional[str] = Query(None),
):
    """
    Validate API key security header or query parameter for write/protected endpoints.
    If no header is passed, default kiosk mode allows access if key is matching or empty.
    """
    provided_key = x_api_key or api_key
    if provided_key and provided_key != API_KEY:
        store.add_log("SECURITY_AUTH", "AUTH", "Invalid API key attempt blocked.", "WARNING")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key. Access denied.",
        )
    return True


@app.get("/api/auth/verify", response_model=AuthVerifyResponse)
async def verify_auth(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    """Endpoint for UI to verify staff API Key validity."""
    if x_api_key == API_KEY or not x_api_key:
        return AuthVerifyResponse(authenticated=True, message="Staff authenticated successfully.")
    return JSONResponse(
        status_code=401,
        content={"authenticated": False, "message": "Invalid API Key."},
    )


@app.get("/api/attendees")
async def get_attendees(
    search: Optional[str] = Query(None, description="Search term for name, email, company, ticket, or ID"),
    status: Optional[str] = Query(None, description="Filter by status (NOT_CHECKED_IN, PENDING, CHECKED_IN, FAILED)"),
):
    """Retrieve list of all attendees, supporting optional search query and status filters."""
    attendees = await store.get_all_attendees(search=search, status_filter=status)
    return {"success": True, "count": len(attendees), "attendees": attendees}


@app.get("/api/attendees/{attendee_id}")
async def get_attendee_by_id(attendee_id: str):
    """Retrieve single attendee details."""
    attendee = await store.get_attendee(attendee_id)
    if not attendee:
        raise HTTPException(status_code=404, detail=f"Attendee '{attendee_id}' not found.")
    return {"success": True, "attendee": attendee}


@app.post("/api/scan", response_model=ScanResponse)
async def scan_attendee(request: ScanRequest, authenticated: bool = Depends(verify_api_key)):
    """
    Handle staff scanning an attendee's QR code at kiosk.
    Enforces duplicate scan protection:
    - If status is PENDING or CHECKED_IN, returns 409 Conflict.
    - If status is NOT_CHECKED_IN or FAILED, sets status to PENDING and queues async print job.
    """
    store.add_log("API_REQUEST", request.attendee_id, f"POST /api/scan from {request.kiosk_id}", "INFO")
    success, scan_resp = await store.initiate_scan(request.attendee_id, request.kiosk_id)

    if not success:
        if scan_resp.error_code in ("ALREADY_CHECKED_IN", "CHECKIN_PENDING"):
            return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=scan_resp.model_dump())
        elif scan_resp.error_code == "ATTENDEE_NOT_FOUND":
            return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content=scan_resp.model_dump())
        elif scan_resp.error_code == "TICKET_CANCELLED":
            return JSONResponse(status_code=status.HTTP_403_FORBIDDEN, content=scan_resp.model_dump())
        else:
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=scan_resp.model_dump())

    # Trigger asynchronous print queue simulation
    if scan_resp.job_id:
        attendee = await store.get_attendee(request.attendee_id)
        seq_num = attendee.last_processed_seq if attendee else 1000
        jobs = await store.get_print_jobs()
        target_job = next((j for j in jobs if j.job_id == scan_resp.job_id), None)
        actual_seq = target_job.sequence_number if target_job else 1001

        await queue_simulator.enqueue_print_job(
            job_id=scan_resp.job_id,
            attendee_id=request.attendee_id,
            sequence_number=actual_seq,
        )

    return scan_resp


@app.post("/api/retry", response_model=ScanResponse)
async def retry_attendee_checkin(request: RetryRequest, authenticated: bool = Depends(verify_api_key)):
    """
    Manually retry check-in for an attendee whose previous scan or print job failed.
    """
    store.add_log("API_REQUEST", request.attendee_id, f"POST /api/retry check-in from {request.kiosk_id}", "INFO")
    success, scan_resp = await store.retry_checkin(request.attendee_id, request.kiosk_id)

    if not success:
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=scan_resp.model_dump())

    if scan_resp.job_id:
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
    store.add_log("WEBHOOK_RECEIVED", payload.attendee_id, f"Webhook callback received for Job '{payload.job_id}' (Status: {payload.status}, Seq: #{payload.sequence_number})", "INFO")
    response = await store.process_webhook(payload)
    return response


@app.get("/api/reports/summary", response_model=AttendanceSummaryReport)
async def get_attendance_summary_report():
    """Retrieve comprehensive event attendance reporting summary."""
    summary = await store.get_attendance_summary()
    return summary


@app.get("/api/reports/export")
async def export_attendance_csv():
    """Export complete attendance records as a downloadable CSV report."""
    attendees = await store.get_all_attendees()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Attendee ID", "Name", "Email", "Company", "Ticket Type",
        "Ticket Status", "Check-In Status", "Checked In At", "Last Job ID", "Failed Reason"
    ])
    
    for a in attendees:
        writer.writerow([
            a.id, a.name, a.email, a.company, a.ticket_type,
            a.ticket_status, a.status.value, a.checked_in_at or "", a.current_job_id or "", a.failed_reason or ""
        ])
    
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=solstice_attendance_report.csv"}
    )


@app.get("/api/queue")
async def get_queue():
    """Retrieve list of active print jobs."""
    jobs = await store.get_print_jobs()
    return {"success": True, "queue": jobs}


@app.get("/api/logs")
async def get_logs():
    """Retrieve system event logs."""
    logs = await store.get_logs()
    return {"success": True, "logs": logs}


@app.post("/api/simulate/out-of-order")
async def simulate_out_of_order(request: OutOfOrderSimRequest, authenticated: bool = Depends(verify_api_key)):
    """
    Trigger manual webhook simulation for testing duplicate callbacks or out-of-order sequences.
    """
    payload = WebhookPayload(
        job_id=request.job_id or f"SIM-JOB-{request.sequence_number}",
        attendee_id=request.attendee_id,
        status=request.status,
        sequence_number=request.sequence_number,
        timestamp="2026-08-23T19:35:00",
        error_message=None if request.status == "SUCCESS" else "Simulated Hardware Error",
    )
    resp = await store.process_webhook(payload)
    return {"success": True, "simulation_result": resp}


@app.post("/api/reset")
async def reset_system(authenticated: bool = Depends(verify_api_key)):
    """Reset data store and simulation state back to initial seed data."""
    store.seed_initial_data()
    return {"success": True, "message": "System state reset to initial seed data."}


# Mount Static UI directory
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static_alias")
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static_root")


