import asyncio
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from app.models import (
    Attendee,
    CheckInStatus,
    PrintJob,
    PrintJobStatus,
    ScanResponse,
    WebhookPayload,
    WebhookResponse,
    SystemLogEntry,
)


class DataStore:
    def __init__(self):
        self._lock = asyncio.Lock()
        self.attendees: Dict[str, Attendee] = {}
        self.print_jobs: Dict[str, PrintJob] = {}
        self.processed_job_ids: set = set()
        self.logs: List[SystemLogEntry] = []
        self._sequence_counter: int = 1000
        self.seed_initial_data()

    def seed_initial_data(self):
        """Seed initial required test attendees."""
        initial_attendees = [
            Attendee(
                id="ATT-001",
                name="Alice Smith",
                email="alice@solsticeconf.com",
                company="Nexus AI",
                ticket_type="Standard Pass",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
            Attendee(
                id="ATT-002",
                name="Bob Jones",
                email="bob@solsticeconf.com",
                company="Quantum Labs",
                ticket_type="VIP Pass",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
            Attendee(
                id="ATT-003",
                name="Charlie Brown",
                email="charlie@solsticeconf.com",
                company="Peak Systems",
                ticket_type="Speaker Pass",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
            Attendee(
                id="ATT-004",
                name="Diana Prince",
                email="diana@solsticeconf.com",
                company="Themyscira Tech",
                ticket_type="Organizer",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
        ]
        self.attendees = {att.id: att for att in initial_attendees}
        self.print_jobs = {}
        self.processed_job_ids = set()
        self.logs = []
        self._sequence_counter = 1000
        self.add_log("SYSTEM", "SYS", "Data store initialized with 4 test attendees.", "INFO")

    def add_log(self, event_type: str, attendee_id: str, details: str, level: str = "INFO"):
        entry = SystemLogEntry(
            timestamp=datetime.now().strftime("%H:%M:%S.%f")[:-3],
            event_type=event_type,
            attendee_id=attendee_id,
            details=details,
            level=level,
        )
        self.logs.insert(0, entry)  # Newest first
        if len(self.logs) > 100:
            self.logs.pop()

    async def get_all_attendees(self) -> List[Attendee]:
        async with self._lock:
            return list(self.attendees.values())

    async def get_attendee(self, attendee_id: str) -> Optional[Attendee]:
        async with self._lock:
            return self.attendees.get(attendee_id)

    async def get_print_jobs(self) -> List[PrintJob]:
        async with self._lock:
            return list(self.print_jobs.values())

    async def get_logs(self) -> List[SystemLogEntry]:
        async with self._lock:
            return self.logs

    async def initiate_scan(self, attendee_id: str, kiosk_id: str = "KIOSK-01") -> Tuple[bool, ScanResponse]:
        async with self._lock:
            attendee = self.attendees.get(attendee_id)
            if not attendee:
                self.add_log("SCAN_REJECTED", attendee_id, f"Attendee ID '{attendee_id}' not found.", "ERROR")
                dummy = Attendee(
                    id=attendee_id,
                    name="Unknown",
                    email="",
                    company="",
                    ticket_type="",
                    status=CheckInStatus.NOT_CHECKED_IN,
                )
                return False, ScanResponse(
                    success=False,
                    message=f"Attendee '{attendee_id}' not found.",
                    attendee=dummy,
                    error_code="ATTENDEE_NOT_FOUND",
                )

            # DUPLICATE SCAN PROTECTION LOGIC
            if attendee.status == CheckInStatus.CHECKED_IN:
                self.add_log(
                    "DUPLICATE_SCAN_BLOCKED",
                    attendee_id,
                    f"Scan rejected for {attendee.name}. Attendee is ALREADY CHECKED IN (Badge previously printed).",
                    "WARNING",
                )
                return False, ScanResponse(
                    success=False,
                    message=f"Scan Rejected: {attendee.name} is already checked in.",
                    attendee=attendee,
                    error_code="ALREADY_CHECKED_IN",
                )

            if attendee.status == CheckInStatus.PENDING:
                self.add_log(
                    "DUPLICATE_SCAN_BLOCKED",
                    attendee_id,
                    f"Scan rejected for {attendee.name}. Badge print job '{attendee.current_job_id}' is CURRENTLY PENDING.",
                    "WARNING",
                )
                return False, ScanResponse(
                    success=False,
                    message=f"Scan Rejected: Check-in for {attendee.name} is currently PENDING (printing in progress).",
                    attendee=attendee,
                    error_code="CHECKIN_PENDING",
                )

            # Valid new scan request -> transition to PENDING
            self._sequence_counter += 1
            seq_num = self._sequence_counter
            job_id = f"JOB-{uuid.uuid4().hex[:8].upper()}"

            attendee.status = CheckInStatus.PENDING
            attendee.current_job_id = job_id
            
            now_str = datetime.now().isoformat()
            job = PrintJob(
                job_id=job_id,
                attendee_id=attendee_id,
                sequence_number=seq_num,
                status=PrintJobStatus.QUEUED,
                created_at=now_str,
            )
            self.print_jobs[job_id] = job

            self.add_log(
                "SCAN_ACCEPTED",
                attendee_id,
                f"Scan accepted for {attendee.name}. Status updated to PENDING. Print job '{job_id}' (seq #{seq_num}) published to vendor queue.",
                "SUCCESS",
            )

            return True, ScanResponse(
                success=True,
                message=f"Check-in initiated for {attendee.name}. Print job queued.",
                attendee=attendee,
                job_id=job_id,
            )

    async def process_webhook(self, payload: WebhookPayload) -> WebhookResponse:
        async with self._lock:
            job_id = payload.job_id
            attendee_id = payload.attendee_id
            incoming_seq = payload.sequence_number
            status_upper = payload.status.upper()

            attendee = self.attendees.get(attendee_id)
            if not attendee:
                self.add_log("WEBHOOK_ERROR", attendee_id, f"Received webhook for unknown attendee ID '{attendee_id}'.", "ERROR")
                return WebhookResponse(
                    success=False,
                    message="Attendee not found.",
                    action_taken="REJECTED",
                    attendee_id=attendee_id,
                    current_status=CheckInStatus.NOT_CHECKED_IN,
                )

            # 1. IDEMPOTENCY / DUPLICATE WEBHOOK CHECK
            if job_id in self.processed_job_ids:
                self.add_log(
                    "IDEMPOTENT_WEBHOOK_IGNORED",
                    attendee_id,
                    f"Duplicate webhook received for completed Job '{job_id}'. Ignored safely.",
                    "WARNING",
                )
                return WebhookResponse(
                    success=True,
                    message=f"Webhook ignored: Job '{job_id}' was already finalized.",
                    action_taken="IGNORED",
                    attendee_id=attendee_id,
                    current_status=attendee.status,
                )

            # 2. OUT-OF-ORDER SEQUENCE GUARD CHECK
            if incoming_seq < attendee.last_processed_seq:
                self.add_log(
                    "OUT_OF_ORDER_WEBHOOK_BLOCKED",
                    attendee_id,
                    f"Stale webhook ignored! Incoming sequence #{incoming_seq} < Last processed sequence #{attendee.last_processed_seq}.",
                    "WARNING",
                )
                return WebhookResponse(
                    success=True,
                    message=f"Out-of-order webhook ignored (Incoming seq #{incoming_seq} is older than processed seq #{attendee.last_processed_seq}).",
                    action_taken="IGNORED",
                    attendee_id=attendee_id,
                    current_status=attendee.status,
                )

            # 3. PROCESS STATUS UPDATE
            job = self.print_jobs.get(job_id)

            if status_upper == "SUCCESS":
                attendee.status = CheckInStatus.CHECKED_IN
                attendee.checked_in_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                attendee.last_processed_seq = max(attendee.last_processed_seq, incoming_seq)
                self.processed_job_ids.add(job_id)

                if job:
                    job.status = PrintJobStatus.COMPLETED
                    job.completed_at = datetime.now().isoformat()

                self.add_log(
                    "WEBHOOK_CONFIRMED",
                    attendee_id,
                    f"Printer callback SUCCESS for Job '{job_id}' (seq #{incoming_seq}). {attendee.name} is officially CHECKED IN!",
                    "SUCCESS",
                )
                return WebhookResponse(
                    success=True,
                    message=f"Attendee {attendee.name} successfully checked in.",
                    action_taken="PROCESSED",
                    attendee_id=attendee_id,
                    current_status=CheckInStatus.CHECKED_IN,
                )

            elif status_upper == "FAILED":
                # Print job failed -> Reset state back to NOT_CHECKED_IN so kiosk can re-scan
                attendee.status = CheckInStatus.NOT_CHECKED_IN
                attendee.current_job_id = None
                attendee.last_processed_seq = max(attendee.last_processed_seq, incoming_seq)
                self.processed_job_ids.add(job_id)

                if job:
                    job.status = PrintJobStatus.FAILED
                    job.completed_at = datetime.now().isoformat()

                self.add_log(
                    "WEBHOOK_PRINT_FAILURE",
                    attendee_id,
                    f"Printer callback FAILED for Job '{job_id}'. Status reset to NOT_CHECKED_IN to allow staff re-scan.",
                    "ERROR",
                )
                return WebhookResponse(
                    success=True,
                    message="Print job failed. Attendee status reset to NOT_CHECKED_IN.",
                    action_taken="PROCESSED",
                    attendee_id=attendee_id,
                    current_status=CheckInStatus.NOT_CHECKED_IN,
                )
            else:
                self.add_log("WEBHOOK_UNRECOGNIZED", attendee_id, f"Unrecognized webhook status '{status_upper}'.", "ERROR")
                return WebhookResponse(
                    success=False,
                    message=f"Unknown status '{status_upper}'.",
                    action_taken="REJECTED",
                    attendee_id=attendee_id,
                    current_status=attendee.status,
                )

    async def update_job_status(self, job_id: str, status: PrintJobStatus):
        async with self._lock:
            if job_id in self.print_jobs:
                self.print_jobs[job_id].status = status


# Global singleton instance
store = DataStore()
