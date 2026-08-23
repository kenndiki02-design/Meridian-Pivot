/**
 * Solstice Events - Kiosk Check-In & Badge Printing System
 * Frontend Application with Dual-Mode Architecture (Demo Mode vs Backend Mode)
 *
 * ============================================================================
 * EXPLANATION OF ARCHITECTURAL DESIGN:
 * ============================================================================
 * 1. DEMO MODE (GitHub Pages / Standalone Static Hosting):
 *    - Runs 100% in browser JavaScript without requiring Python, FastAPI, or a server.
 *    - In-browser state machine simulates attendee state transitions:
 *      NOT_CHECKED_IN -> PENDING (Print Request Queued) -> CHECKED_IN (Webhook Confirmation).
 *    - DUPLICATE SCAN PROTECTION: Rejects scans if an attendee is PENDING or CHECKED_IN,
 *      preventing multiple badge print requests.
 *    - ASYNCHRONOUS QUEUE & WEBHOOK SIMULATION: Uses setTimeout to simulate vendor hardware
 *      printing delay before triggering an asynchronous simulated webhook callback.
 *    - OUT-OF-ORDER WEBHOOK HANDLING: Monotonic sequence tracking ensures stale sequence
 *      numbers are rejected and webhooks processed out of scan order finalize safely.
 *
 * 2. BACKEND MODE (FastAPI Connected):
 *    - Issues relative REST API calls (./api/scan, ./api/webhooks/print-status, etc.)
 *      to the local FastAPI Python backend.
 *    - Seamlessly auto-detected on startup or manually toggled by user.
 * ============================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Element References
    const containerAttendees = document.getElementById('attendees-container');
    const containerQueue = document.getElementById('queue-container');
    const containerLogs = document.getElementById('log-container');
    const inputScan = document.getElementById('scan-input');
    const btnScanSubmit = document.getElementById('btn-scan-submit');
    const btnReset = document.getElementById('btn-reset');
    const btnToggleMode = document.getElementById('btn-toggle-mode');
    const modeBadge = document.getElementById('mode-badge');

    const btnSimDuplicateScan = document.getElementById('btn-sim-duplicate-scan');
    const btnSimOutOfOrder = document.getElementById('btn-sim-out-of-order');
    const btnSimDuplicateWebhook = document.getElementById('btn-sim-duplicate-webhook');

    const countTotal = document.getElementById('count-total');
    const countUnchecked = document.getElementById('count-unchecked');
    const countPending = document.getElementById('count-pending');
    const countChecked = document.getElementById('count-checked');
    const logCountBadge = document.getElementById('log-count');

    // System Operating Mode (True = Standalone Browser Demo Mode for GitHub Pages)
    let DEMO_MODE = true;
    let pollIntervalId = null;

    // Toast Notification System
    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ℹ️';
        if (type === 'error') icon = '🚫';
        if (type === 'warning') icon = '⚠️';
        if (type === 'success') icon = '✅';

        toast.innerHTML = `<span>${icon}</span><div>${message}</div>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    /**
     * ========================================================================
     * IN-BROWSER DEMO STORE & SIMULATOR (Used in DEMO_MODE)
     * ========================================================================
     */
    class BrowserDemoStore {
        constructor() {
            this.sequenceCounter = 1000;
            this.seedData();
        }

        seedData() {
            this.attendees = [
                {
                    id: "ATT-001",
                    name: "Alice Smith",
                    email: "alice@solsticeconf.com",
                    company: "Nexus AI",
                    ticket_type: "Standard Pass",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null
                },
                {
                    id: "ATT-002",
                    name: "Bob Jones",
                    email: "bob@solsticeconf.com",
                    company: "Quantum Labs",
                    ticket_type: "VIP Pass",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null
                },
                {
                    id: "ATT-003",
                    name: "Charlie Brown",
                    email: "charlie@solsticeconf.com",
                    company: "Peak Systems",
                    ticket_type: "Speaker Pass",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null
                },
                {
                    id: "ATT-004",
                    name: "Diana Prince",
                    email: "diana@solsticeconf.com",
                    company: "Themyscira Tech",
                    ticket_type: "Organizer",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null
                }
            ];
            this.printJobs = [];
            this.processedJobIds = new Set();
            this.logs = [];
            this.sequenceCounter = 1000;
            this.addLog("SYSTEM", "SYS", "Demo mode initialized with 4 test attendees.", "INFO");
        }

        addLog(eventType, attendeeId, details, level = "INFO") {
            const now = new Date();
            const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
            this.logs.unshift({
                timestamp: timeStr,
                event_type: eventType,
                attendee_id: attendeeId,
                details: details,
                level: level
            });
            if (this.logs.length > 100) this.logs.pop();
        }

        getAttendees() { return this.attendees; }
        getQueue() { return this.printJobs; }
        getLogs() { return this.logs; }

        /**
         * DEMO MODE - DUPLICATE SCAN PROTECTION & CHECK-IN INITIATION
         */
        scanAttendee(attendeeId) {
            const att = this.attendees.find(a => a.id === attendeeId);
            if (!att) {
                this.addLog("SCAN_REJECTED", attendeeId, `Attendee ID '${attendeeId}' not found.`, "ERROR");
                return {
                    success: false,
                    status: 404,
                    message: `Attendee '${attendeeId}' not found.`,
                    error_code: "ATTENDEE_NOT_FOUND"
                };
            }

            // 1. DUPLICATE SCAN CHECK - ALREADY CHECKED IN
            if (att.status === "CHECKED_IN") {
                this.addLog("DUPLICATE_SCAN_BLOCKED", attendeeId, `Scan rejected for ${att.name}. Attendee is ALREADY CHECKED IN (Badge printed).`, "WARNING");
                return {
                    success: false,
                    status: 409,
                    message: `Scan Rejected: ${att.name} is already checked in.`,
                    error_code: "ALREADY_CHECKED_IN",
                    attendee: att
                };
            }

            // 2. DUPLICATE SCAN CHECK - CHECKIN PENDING
            if (att.status === "PENDING") {
                this.addLog("DUPLICATE_SCAN_BLOCKED", attendeeId, `Scan rejected for ${att.name}. Badge print job '${att.current_job_id}' is CURRENTLY PENDING.`, "WARNING");
                return {
                    success: false,
                    status: 409,
                    message: `Scan Rejected: Check-in for ${att.name} is currently PENDING (printing in progress).`,
                    error_code: "CHECKIN_PENDING",
                    attendee: att
                };
            }

            // 3. VALID NEW SCAN -> TRANSITION TO PENDING
            this.sequenceCounter++;
            const seqNum = this.sequenceCounter;
            const jobId = `JOB-DEMO-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

            att.status = "PENDING";
            att.current_job_id = jobId;

            const job = {
                job_id: jobId,
                attendee_id: attendeeId,
                sequence_number: seqNum,
                status: "QUEUED",
                created_at: new Date().toISOString()
            };
            this.printJobs.push(job);

            this.addLog("SCAN_ACCEPTED", attendeeId, `Scan accepted for ${att.name}. Status updated to PENDING. Print job '${jobId}' (seq #${seqNum}) queued.`, "SUCCESS");

            // SIMULATE ASYNCHRONOUS PRINT QUEUE & AUTOMATED WEBHOOK CONFIRMATION (1.5s delay)
            setTimeout(() => {
                this.processWebhook({
                    job_id: jobId,
                    attendee_id: attendeeId,
                    status: "SUCCESS",
                    sequence_number: seqNum,
                    timestamp: new Date().toISOString()
                });
                // Update UI after webhook fires
                renderUIFromDemoStore();
            }, 1500);

            return {
                success: true,
                status: 200,
                message: `Check-in initiated for ${att.name}. Print job queued.`,
                attendee: att,
                job_id: jobId
            };
        }

        /**
         * DEMO MODE - WEBHOOK HANDLING (OUT-OF-ORDER & IDEMPOTENCY)
         */
        processWebhook(payload) {
            const { job_id, attendee_id, status: payloadStatus, sequence_number } = payload;
            const att = this.attendees.find(a => a.id === attendee_id);
            if (!att) {
                this.addLog("WEBHOOK_ERROR", attendee_id, `Received webhook for unknown attendee '${attendee_id}'.`, "ERROR");
                return { action_taken: "REJECTED", message: "Attendee not found" };
            }

            // A. IDEMPOTENCY / DUPLICATE WEBHOOK CHECK
            if (this.processedJobIds.has(job_id)) {
                this.addLog("IDEMPOTENT_WEBHOOK_IGNORED", attendee_id, `Duplicate webhook received for completed Job '${job_id}'. Ignored safely.`, "WARNING");
                return { action_taken: "IGNORED", message: `Duplicate webhook ignored: Job '${job_id}' was already finalized.` };
            }

            // B. OUT-OF-ORDER SEQUENCE GUARD CHECK
            if (sequence_number < att.last_processed_seq) {
                this.addLog("OUT_OF_ORDER_WEBHOOK_BLOCKED", attendee_id, `Stale webhook ignored! Incoming seq #${sequence_number} < Last processed seq #${att.last_processed_seq}.`, "WARNING");
                return { action_taken: "IGNORED", message: `Out-of-order webhook ignored (Incoming seq #${sequence_number} < processed seq #${att.last_processed_seq}).` };
            }

            // C. PROCESS STATUS
            const job = this.printJobs.find(j => j.job_id === job_id);

            if (payloadStatus.toUpperCase() === "SUCCESS") {
                att.status = "CHECKED_IN";
                att.checked_in_at = new Date().toLocaleString();
                att.last_processed_seq = Math.max(att.last_processed_seq, sequence_number);
                this.processedJobIds.add(job_id);

                if (job) job.status = "COMPLETED";

                this.addLog("WEBHOOK_CONFIRMED", attendee_id, `Printer callback SUCCESS for Job '${job_id}' (seq #${sequence_number}). ${att.name} is officially CHECKED IN!`, "SUCCESS");
                return { action_taken: "PROCESSED", message: `Attendee ${att.name} successfully checked in.` };
            } else if (payloadStatus.toUpperCase() === "FAILED") {
                att.status = "NOT_CHECKED_IN";
                att.current_job_id = null;
                att.last_processed_seq = Math.max(att.last_processed_seq, sequence_number);
                this.processedJobIds.add(job_id);

                if (job) job.status = "FAILED";

                this.addLog("WEBHOOK_PRINT_FAILURE", attendee_id, `Printer callback FAILED for Job '${job_id}'. Status reset to NOT_CHECKED_IN to allow staff re-scan.`, "ERROR");
                return { action_taken: "PROCESSED", message: "Print job failed. Status reset." };
            }
        }
    }

    const demoStore = new BrowserDemoStore();

    /**
     * ========================================================================
     * ENVIRONMENT DETECTION & DUAL-MODE SWITCHER
     * ========================================================================
     */
    async function initEnvironmentMode() {
        // Force DEMO_MODE if hosted on GitHub Pages or file:// protocol
        const isStaticHost = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:';
        
        if (isStaticHost) {
            setMode(true, "DEMO MODE (Static Web)");
            return;
        }

        // Test local backend API reachability
        try {
            const resp = await fetch('./api/attendees', { method: 'GET' });
            if (resp.ok) {
                setMode(false, "BACKEND MODE (FastAPI Connected)");
            } else {
                setMode(true, "DEMO MODE (Fallback)");
            }
        } catch (err) {
            setMode(true, "DEMO MODE (Browser Simulation)");
        }
    }

    function setMode(isDemo, labelText) {
        DEMO_MODE = isDemo;
        modeBadge.textContent = labelText;
        if (isDemo) {
            modeBadge.className = "mode-badge demo-mode";
        } else {
            modeBadge.className = "mode-badge backend-mode";
        }

        if (pollIntervalId) clearInterval(pollIntervalId);

        if (!DEMO_MODE) {
            // Poll local backend every 1s
            pollIntervalId = setInterval(refreshDataFromBackend, 1000);
            refreshDataFromBackend();
        } else {
            // Render directly from browser demo store
            renderUIFromDemoStore();
        }
    }

    btnToggleMode.addEventListener('click', () => {
        const nextMode = !DEMO_MODE;
        showToast(`Switched to ${nextMode ? 'DEMO MODE (In-Browser)' : 'BACKEND MODE (FastAPI API)'}`, 'info');
        setMode(nextMode, nextMode ? "DEMO MODE (Manual)" : "BACKEND MODE (Manual)");
    });

    /**
     * ========================================================================
     * DATA RENDERING FUNCTIONS
     * ========================================================================
     */
    function renderUIFromDemoStore() {
        const attendees = demoStore.getAttendees();
        const queue = demoStore.getQueue();
        const logs = demoStore.getLogs();

        renderAttendees(attendees);
        updateMetrics(attendees);
        renderQueue(queue);
        renderLogs(logs);
    }

    async function refreshDataFromBackend() {
        if (DEMO_MODE) return;
        try {
            const [respAtt, respQueue, respLogs] = await Promise.all([
                fetch('./api/attendees'),
                fetch('./api/queue'),
                fetch('./api/logs')
            ]);

            if (respAtt.ok) {
                const dataAtt = await respAtt.json();
                const attendees = dataAtt.attendees || [];
                renderAttendees(attendees);
                updateMetrics(attendees);
            }

            if (respQueue.ok) {
                const dataQueue = await respQueue.json();
                renderQueue(dataQueue.queue || []);
            }

            if (respLogs.ok) {
                const dataLogs = await respLogs.json();
                renderLogs(dataLogs.logs || []);
            }
        } catch (err) {
            console.error("Backend fetch error:", err);
        }
    }

    function updateMetrics(attendees) {
        countTotal.textContent = attendees.length;
        countUnchecked.textContent = attendees.filter(a => a.status === 'NOT_CHECKED_IN').length;
        countPending.textContent = attendees.filter(a => a.status === 'PENDING').length;
        countChecked.textContent = attendees.filter(a => a.status === 'CHECKED_IN').length;
    }

    function renderAttendees(attendees) {
        containerAttendees.innerHTML = attendees.map(att => {
            let statusText = "UNCHECKED";
            if (att.status === 'PENDING') statusText = "PENDING (Printing...)";
            if (att.status === 'CHECKED_IN') statusText = "CHECKED IN";

            return `
                <div class="attendee-card" id="card-${att.id}">
                    <div class="attendee-header">
                        <span class="attendee-id">${att.id}</span>
                        <span class="status-badge status-${att.status}">${statusText}</span>
                    </div>
                    <div class="attendee-info">
                        <h3>${att.name}</h3>
                        <p>${att.email} • ${att.company}</p>
                        <span class="ticket-tag">${att.ticket_type}</span>
                    </div>
                    <div class="attendee-actions">
                        <button class="btn btn-primary btn-block btn-sm" onclick="scanAttendee('${att.id}')">
                            ${att.status === 'CHECKED_IN' ? '🔒 Already Checked In' : (att.status === 'PENDING' ? '⏳ Printing Badge...' : '📷 Scan QR Code')}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderQueue(jobs) {
        if (!jobs || jobs.length === 0) {
            containerQueue.innerHTML = '<div class="empty-state">No print jobs in vendor queue.</div>';
            return;
        }

        containerQueue.innerHTML = jobs.map(job => `
            <div class="queue-item">
                <div>
                    <strong>Job ID: ${job.job_id}</strong>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">Attendee: ${job.attendee_id} • Seq #${job.sequence_number}</div>
                </div>
                <span class="status-badge status-${job.status === 'COMPLETED' ? 'CHECKED_IN' : 'PENDING'}">${job.status}</span>
            </div>
        `).join('');
    }

    function renderLogs(logs) {
        logCountBadge.textContent = `${logs.length} logs`;
        containerLogs.innerHTML = logs.map(log => `
            <div class="log-entry ${log.level}">
                <span class="time">[${log.timestamp}]</span>
                <span class="type">[${log.event_type}]</span>
                <span>(${log.attendee_id}) ${log.details}</span>
            </div>
        `).join('');
    }

    /**
     * ========================================================================
     * USER ACTION HANDLERS
     * ========================================================================
     */
    window.scanAttendee = async function(attendeeId) {
        if (DEMO_MODE) {
            // DEMO MODE DISPATCH
            const res = demoStore.scanAttendee(attendeeId);
            if (res.status === 409) {
                showToast(`DUPLICATE SCAN BLOCKED: ${res.message}`, 'warning');
            } else if (res.success) {
                showToast(`Check-in initiated for ${res.attendee.name}! Print Job ${res.job_id} queued.`, 'success');
            } else {
                showToast(res.message || "Scan failed.", 'error');
            }
            renderUIFromDemoStore();
        } else {
            // BACKEND MODE DISPATCH
            try {
                const resp = await fetch('./api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ attendee_id: attendeeId, kiosk_id: 'KIOSK-MAIN-01' })
                });
                const data = await resp.json();
                if (resp.status === 409) {
                    showToast(`DUPLICATE SCAN BLOCKED: ${data.message}`, 'warning');
                } else if (resp.ok && data.success) {
                    showToast(`Check-in initiated for ${data.attendee.name}! Print Job ${data.job_id} queued.`, 'success');
                } else {
                    showToast(data.message || "Scan failed.", 'error');
                }
                refreshDataFromBackend();
            } catch (err) {
                showToast("Network error executing scan.", 'error');
            }
        }
    };

    btnScanSubmit.addEventListener('click', () => {
        const val = inputScan.value.trim();
        if (val) {
            scanAttendee(val);
            inputScan.value = '';
        }
    });

    // Rapid Duplicate Scan Button (ATT-002)
    btnSimDuplicateScan.addEventListener('click', () => {
        showToast("Simulating rapid double-scan on ATT-002 (Bob Jones)...", 'info');
        scanAttendee('ATT-002');
        setTimeout(() => {
            scanAttendee('ATT-002');
        }, 100);
    });

    // Out-of-Order Webhook Simulation Button (ATT-003)
    btnSimOutOfOrder.addEventListener('click', async () => {
        showToast("Sending stale sequence webhook (Seq #999)...", 'info');
        if (DEMO_MODE) {
            const res = demoStore.processWebhook({
                job_id: 'STALE-JOB-999',
                attendee_id: 'ATT-003',
                sequence_number: 999,
                status: 'SUCCESS',
                timestamp: new Date().toISOString()
            });
            showToast(`Out-of-Order Result: ${res.action_taken} - ${res.message}`, res.action_taken === 'IGNORED' ? 'warning' : 'info');
            renderUIFromDemoStore();
        } else {
            try {
                const resp = await fetch('./api/simulate/out-of-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        attendee_id: 'ATT-003',
                        sequence_number: 999,
                        status: 'SUCCESS',
                        job_id: 'STALE-JOB-999'
                    })
                });
                const data = await resp.json();
                const action = data.simulation_result.action_taken;
                showToast(`Out-of-Order Result: ${action} - ${data.simulation_result.message}`, action === 'IGNORED' ? 'warning' : 'info');
                refreshDataFromBackend();
            } catch (err) {
                showToast("Failed to simulate out-of-order webhook.", 'error');
            }
        }
    });

    // Duplicate Webhook Replay Button
    btnSimDuplicateWebhook.addEventListener('click', async () => {
        const jobs = DEMO_MODE ? demoStore.getQueue() : [];
        const currentJob = jobs.find(j => j.status === 'COMPLETED' || j.status === 'QUEUED');

        if (!currentJob && DEMO_MODE) {
            showToast("Please perform a check-in first to generate a print job to replay.", 'warning');
            return;
        }

        const jobId = currentJob ? currentJob.job_id : 'JOB-REPLAY-TEST';
        const attId = currentJob ? currentJob.attendee_id : 'ATT-001';
        const seq = currentJob ? currentJob.sequence_number : 1001;

        showToast(`Replaying duplicate webhook for Job '${jobId}'...`, 'info');

        if (DEMO_MODE) {
            const res = demoStore.processWebhook({
                job_id: jobId,
                attendee_id: attId,
                sequence_number: seq,
                status: 'SUCCESS',
                timestamp: new Date().toISOString()
            });
            showToast(`Idempotency Check: ${res.action_taken} - ${res.message}`, res.action_taken === 'IGNORED' ? 'warning' : 'success');
            renderUIFromDemoStore();
        } else {
            try {
                const resp = await fetch('./api/simulate/out-of-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        attendee_id: attId,
                        sequence_number: seq,
                        status: 'SUCCESS',
                        job_id: jobId
                    })
                });
                const data = await resp.json();
                const action = data.simulation_result.action_taken;
                showToast(`Idempotency Check: ${action} - ${data.simulation_result.message}`, action === 'IGNORED' ? 'warning' : 'success');
                refreshDataFromBackend();
            } catch (err) {
                showToast("Failed to replay duplicate webhook.", 'error');
            }
        }
    });

    // System Reset Button
    btnReset.addEventListener('click', async () => {
        if (DEMO_MODE) {
            demoStore.seedData();
            showToast("Demo system state reset to initial seed data.", 'success');
            renderUIFromDemoStore();
        } else {
            try {
                const resp = await fetch('./api/reset', { method: 'POST' });
                if (resp.ok) {
                    showToast("Backend system state reset to initial seed data.", 'success');
                    refreshDataFromBackend();
                }
            } catch (err) {
                showToast("Failed to reset backend.", 'error');
            }
        }
    });

    // Initialize environment mode detection
    initEnvironmentMode();
});
