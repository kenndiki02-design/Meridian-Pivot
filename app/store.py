import asyncio
import json
import os
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
    AttendanceSummaryReport,
    TicketTypeBreakdown,
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DB_FILE = os.path.join(DATA_DIR, "checkin_db.json")


class DataStore:
    def __init__(self, db_file: str = DB_FILE):
        self._lock = asyncio.Lock()
        self.db_file = db_file
        self.attendees: Dict[str, Attendee] = {}
        self.print_jobs: Dict[str, PrintJob] = {}
        self.processed_job_ids: set = set()
        self.logs: List[SystemLogEntry] = []
        self._sequence_counter: int = 1000
        
        if not self.load_from_disk():
            self.seed_initial_data()

    def save_to_disk(self):
        """Persist current state to JSON file on disk."""
        try:
            os.makedirs(os.path.dirname(self.db_file), exist_ok=True)
            data = {
                "sequence_counter": self._sequence_counter,
                "processed_job_ids": list(self.processed_job_ids),
                "attendees": {aid: att.model_dump() for aid, att in self.attendees.items()},
                "print_jobs": {jid: job.model_dump() for jid, job in self.print_jobs.items()},
                "logs": [log.model_dump() for log in self.logs],
            }
            with open(self.db_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"[ERROR] Failed to persist data to disk: {e}")

    def load_from_disk(self) -> bool:
        """Load state from JSON file on disk if available."""
        if not os.path.exists(self.db_file):
            return False
        try:
            with open(self.db_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            self._sequence_counter = data.get("sequence_counter", 1000)
            self.processed_job_ids = set(data.get("processed_job_ids", []))
            self.attendees = {
                aid: Attendee(**att_data)
                for aid, att_data in data.get("attendees", {}).items()
            }
            self.print_jobs = {
                jid: PrintJob(**job_data)
                for jid, job_data in data.get("print_jobs", {}).items()
            }
            self.logs = [
                SystemLogEntry(**log_data)
                for log_data in data.get("logs", [])
            ]
            print(f"[INFO] Loaded persistent data from {self.db_file}: {len(self.attendees)} attendees.")
            return True
        except Exception as e:
            print(f"[WARNING] Failed to load data from {self.db_file}: {e}")
            return False

    def seed_initial_data(self):
        """Seed initial required test attendees."""
        initial_attendees = [
            Attendee(
                id="ATT-001",
                name="Alice Smith",
                email="alice@solsticeconf.com",
                company="Nexus AI",
                ticket_type="Standard Pass",
                ticket_status="ACTIVE",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
            Attendee(
                id="ATT-002",
                name="Bob Jones",
                email="bob@solsticeconf.com",
                company="Quantum Labs",
                ticket_type="VIP Pass",
                ticket_status="ACTIVE",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
            Attendee(
                id="ATT-003",
                name="Charlie Brown",
                email="charlie@solsticeconf.com",
                company="Peak Systems",
                ticket_type="Speaker Pass",
                ticket_status="ACTIVE",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
            Attendee(
                id="ATT-004",
                name="Diana Prince",
                email="diana@solsticeconf.com",
                company="Themyscira Tech",
                ticket_type="Organizer",
                ticket_status="ACTIVE",
                status=CheckInStatus.NOT_CHECKED_IN,
            ),
        ]
        self.attendees = {att.id: att for att in initial_attendees}
        self.print_jobs = {}
        self.processed_job_ids = set()
        self.logs = []
        self._sequence_counter = 1000
        self.add_log("SYSTEM", "SYS", "Data store initialized with 4 test attendees.", "INFO")
        self.save_to_disk()

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

    async def get_all_attendees(
        self, search: Optional[str] = None, status_filter: Optional[str] = None
    ) -> List[Attendee]:
        async with self._lock:
            result = list(self.attendees.values())
            
            if search:
                query = search.strip().lower()
                result = [
                    a for a in result
                    if query in a.id.lower()
                    or query in a.name.lower()
                    or query in a.email.lower()
                    or query in a.company.lower()
                    or query in a.ticket_type.lower()
                ]

            if status_filter:
                status_upper = status_filter.strip().upper()
                result = [a for a in result if a.status.value.upper() == status_upper]

            return result

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
                self.save_to_disk()
                return False, ScanResponse(
                    success=False,
                    message=f"Attendee '{attendee_id}' not found.",
                    attendee=dummy,
                    error_code="ATTENDEE_NOT_FOUND",
                )

            # TICKET VALIDATION
            if attendee.ticket_status == "CANCELLED":
                self.add_log(
                    "SCAN_REJECTED",
                    attendee_id,
                    f"Scan rejected for {attendee.name}. Ticket is CANCELLED.",
                    "ERROR",
                )
                self.save_to_disk()
                return False, ScanResponse(
                    success=False,
                    message=f"Ticket for '{attendee.name}' has been CANCELLED.",
                    attendee=attendee,
                    error_code="TICKET_CANCELLED",
                )

            # DUPLICATE SCAN PROTECTION LOGIC
            if attendee.status == CheckInStatus.CHECKED_IN:
                self.add_log(
                    "DUPLICATE_SCAN_BLOCKED",
                    attendee_id,
                    f"Scan rejected for {attendee.name}. Attendee is ALREADY CHECKED IN (Badge previously printed).",
                    "WARNING",
                )
                self.save_to_disk()
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
                self.save_to_disk()
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
            attendee.failed_reason = None
            
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

            self.save_to_disk()
            return True, ScanResponse(
                success=True,
                message=f"Check-in initiated for {attendee.name}. Print job queued.",
                attendee=attendee,
                job_id=job_id,
            )

    async def retry_checkin(self, attendee_id: str, kiosk_id: str = "KIOSK-01") -> Tuple[bool, ScanResponse]:
        async with self._lock:
            attendee = self.attendees.get(attendee_id)
            if not attendee:
                return False, ScanResponse(
                    success=False,
                    message=f"Attendee '{attendee_id}' not found.",
                    attendee=Attendee(id=attendee_id, name="Unknown", email="", company="", ticket_type=""),
                    error_code="ATTENDEE_NOT_FOUND",
                )

            # Force state back to NOT_CHECKED_IN so initiate_scan can be re-run
            attendee.status = CheckInStatus.NOT_CHECKED_IN
            attendee.current_job_id = None
            attendee.failed_reason = None
            self.add_log("RETRY_INITIATED", attendee_id, f"Staff initiated check-in retry for {attendee.name}.", "INFO")
            self.save_to_disk()

        # Re-run initiate scan
        return await self.initiate_scan(attendee_id, kiosk_id)

    async def process_webhook(self, payload: WebhookPayload) -> WebhookResponse:
        async with self._lock:
            job_id = payload.job_id
            attendee_id = payload.attendee_id
            incoming_seq = payload.sequence_number
            status_upper = payload.status.upper()

            attendee = self.attendees.get(attendee_id)
            if not attendee:
                self.add_log("WEBHOOK_ERROR", attendee_id, f"Received webhook for unknown attendee ID '{attendee_id}'.", "ERROR")
                self.save_to_disk()
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
                self.save_to_disk()
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
                self.save_to_disk()
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
                attendee.failed_reason = None
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
                self.save_to_disk()
                return WebhookResponse(
                    success=True,
                    message=f"Attendee {attendee.name} successfully checked in.",
                    action_taken="PROCESSED",
                    attendee_id=attendee_id,
                    current_status=CheckInStatus.CHECKED_IN,
                )

            elif status_upper == "FAILED":
                err_msg = payload.error_message or "Printer processing hardware error"
                attendee.status = CheckInStatus.FAILED
                attendee.failed_reason = err_msg
                attendee.current_job_id = None
                attendee.last_processed_seq = max(attendee.last_processed_seq, incoming_seq)
                self.processed_job_ids.add(job_id)

                if job:
                    job.status = PrintJobStatus.FAILED
                    job.completed_at = datetime.now().isoformat()

                self.add_log(
                    "WEBHOOK_PRINT_FAILURE",
                    attendee_id,
                    f"Printer callback FAILED for Job '{job_id}' ({err_msg}). Status updated to FAILED to allow staff retry.",
                    "ERROR",
                )
                self.save_to_disk()
                return WebhookResponse(
                    success=True,
                    message=f"Print job failed: {err_msg}. Status updated to FAILED.",
                    action_taken="PROCESSED",
                    attendee_id=attendee_id,
                    current_status=CheckInStatus.FAILED,
                )
            else:
                self.add_log("WEBHOOK_UNRECOGNIZED", attendee_id, f"Unrecognized webhook status '{status_upper}'.", "ERROR")
                self.save_to_disk()
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
                self.save_to_disk()

    async def get_attendance_summary(self) -> AttendanceSummaryReport:
        async with self._lock:
            attendees = list(self.attendees.values())
            total_reg = len(attendees)
            total_checked = sum(1 for a in attendees if a.status == CheckInStatus.CHECKED_IN)
            total_pending = sum(1 for a in attendees if a.status == CheckInStatus.PENDING)
            total_failed = sum(1 for a in attendees if a.status == CheckInStatus.FAILED)
            total_outstanding = sum(1 for a in attendees if a.status in (CheckInStatus.NOT_CHECKED_IN, CheckInStatus.FAILED))
            check_in_rate = round((total_checked / total_reg * 100), 1) if total_reg > 0 else 0.0

            # Ticket type breakdown
            by_ticket: Dict[str, Dict] = {}
            for a in attendees:
                ttype = a.ticket_type
                if ttype not in by_ticket:
                    by_ticket[ttype] = {
                        "total_registered": 0,
                        "checked_in": 0,
                        "pending": 0,
                        "failed": 0,
                        "outstanding": 0,
                    }
                by_ticket[ttype]["total_registered"] += 1
                if a.status == CheckInStatus.CHECKED_IN:
                    by_ticket[ttype]["checked_in"] += 1
                elif a.status == CheckInStatus.PENDING:
                    by_ticket[ttype]["pending"] += 1
                elif a.status == CheckInStatus.FAILED:
                    by_ticket[ttype]["failed"] += 1
                    by_ticket[ttype]["outstanding"] += 1
                else:
                    by_ticket[ttype]["outstanding"] += 1

            ticket_breakdowns = []
            for ttype, stats in by_ticket.items():
                reg = stats["total_registered"]
                chk = stats["checked_in"]
                rate = round((chk / reg * 100), 1) if reg > 0 else 0.0
                ticket_breakdowns.append(
                    TicketTypeBreakdown(
                        ticket_type=ttype,
                        total_registered=reg,
                        checked_in=chk,
                        pending=stats["pending"],
                        failed=stats["failed"],
                        outstanding=stats["outstanding"],
                        check_in_rate=rate,
                    )
                )

            return AttendanceSummaryReport(
                generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                total_registered=total_reg,
                total_checked_in=total_checked,
                total_pending=total_pending,
                total_failed=total_failed,
                total_outstanding=total_outstanding,
                check_in_rate=check_in_rate,
                by_ticket_type=ticket_breakdowns,
            )


# Global singleton instance
store = DataStore()

