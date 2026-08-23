import asyncio
from datetime import datetime
import httpx
from app.models import WebhookPayload
from app.store import store


class PrintQueueSimulator:
    def __init__(self):
        self.processing_delay: float = 1.5  # seconds
        self.webhook_url: str = "http://127.0.0.1:8000/api/webhooks/print-status"
        self.auto_dispatch: bool = True

    async def enqueue_print_job(self, job_id: str, attendee_id: str, sequence_number: int, simulate_failure: bool = False):
        """Simulate publishing job to badge printer vendor queue."""
        store.add_log(
            "VENDOR_QUEUE_INGEST",
            attendee_id,
            f"Badge printer vendor received Job '{job_id}' (seq #{sequence_number}). In queue for printing.",
            "INFO",
        )

        if self.auto_dispatch:
            asyncio.create_task(
                self._process_and_send_webhook(
                    job_id=job_id,
                    attendee_id=attendee_id,
                    sequence_number=sequence_number,
                    delay=self.processing_delay,
                    simulate_failure=simulate_failure,
                )
            )

    async def _process_and_send_webhook(
        self,
        job_id: str,
        attendee_id: str,
        sequence_number: int,
        delay: float,
        simulate_failure: bool = False,
    ):
        """Simulate hardware print delay, then trigger webhook callback."""
        await asyncio.sleep(delay)

        status_str = "FAILED" if simulate_failure else "SUCCESS"
        payload = WebhookPayload(
            job_id=job_id,
            attendee_id=attendee_id,
            status=status_str,
            sequence_number=sequence_number,
            timestamp=datetime.now().isoformat(),
            error_message="Printer paper jam" if simulate_failure else None,
        )

        store.add_log(
            "VENDOR_WEBHOOK_DISPATCH",
            attendee_id,
            f"Vendor hardware finished printing Job '{job_id}'. Dispatching webhook callback (Status: {status_str}).",
            "INFO",
        )

        # Directly call data store process_webhook (or send HTTP request)
        # Using store directly inside the application process guarantees test stability without requiring external socket listeners
        await store.process_webhook(payload)


queue_simulator = PrintQueueSimulator()
