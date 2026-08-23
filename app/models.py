from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime


class CheckInStatus(str, Enum):
    NOT_CHECKED_IN = "NOT_CHECKED_IN"
    PENDING = "PENDING"
    CHECKED_IN = "CHECKED_IN"
    FAILED = "FAILED"


class PrintJobStatus(str, Enum):
    QUEUED = "QUEUED"
    PRINTING = "PRINTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Attendee(BaseModel):
    id: str
    name: str
    email: str
    company: str
    ticket_type: str
    status: CheckInStatus = CheckInStatus.NOT_CHECKED_IN
    current_job_id: Optional[str] = None
    last_processed_seq: int = 0
    checked_in_at: Optional[str] = None


class ScanRequest(BaseModel):
    attendee_id: str
    kiosk_id: str = "KIOSK-MAIN-01"


class ScanResponse(BaseModel):
    success: bool
    message: str
    attendee: Attendee
    job_id: Optional[str] = None
    error_code: Optional[str] = None


class PrintJob(BaseModel):
    job_id: str
    attendee_id: str
    sequence_number: int
    status: PrintJobStatus = PrintJobStatus.QUEUED
    created_at: str
    completed_at: Optional[str] = None
    attempts: int = 1


class WebhookPayload(BaseModel):
    job_id: str
    attendee_id: str
    status: str  # "SUCCESS" or "FAILED"
    sequence_number: int
    timestamp: str
    error_message: Optional[str] = None


class WebhookResponse(BaseModel):
    success: bool
    message: str
    action_taken: str  # "PROCESSED", "IGNORED", "REJECTED"
    attendee_id: str
    current_status: CheckInStatus


class OutOfOrderSimRequest(BaseModel):
    attendee_id: str
    sequence_number: int
    status: str = "SUCCESS"
    job_id: Optional[str] = None
    force_duplicate: bool = False


class SystemLogEntry(BaseModel):
    timestamp: str
    event_type: str
    attendee_id: str
    details: str
    level: str = "INFO"  # INFO, WARNING, ERROR, SUCCESS
