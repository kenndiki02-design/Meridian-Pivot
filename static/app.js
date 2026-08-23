/**
 * Solstice Events - Kiosk Check-In & Badge Printing System
 * Frontend Application with Dual-Mode Architecture (Demo Mode vs Backend Mode)
 *
 * Features:
 * - Attendee search & lookup
 * - Check-in status dashboard & filter tabs (All, Outstanding, Pending, Checked In, Failed)
 * - Error retry handling & printer hardware failure simulation
 * - Event attendance summary report & CSV export
 * - API Key security header support
 * - Persistent storage (localStorage in Demo Mode, disk JSON in Backend Mode)
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

    const inputSearch = document.getElementById('search-input');
    const btnSearchClear = document.getElementById('btn-search-clear');
    const filterTabsContainer = document.getElementById('filter-tabs');

    const btnSimDuplicateScan = document.getElementById('btn-sim-duplicate-scan');
    const btnSimPrinterFailure = document.getElementById('btn-sim-printer-failure');
    const btnSimOutOfOrder = document.getElementById('btn-sim-out-of-order');
    const btnSimDuplicateWebhook = document.getElementById('btn-sim-duplicate-webhook');

    const btnOpenReport = document.getElementById('btn-open-report');
    const btnCloseReport = document.getElementById('btn-close-report');
    const btnCloseReportFooter = document.getElementById('btn-close-report-footer');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const reportModal = document.getElementById('report-modal');
    const reportModalBody = document.getElementById('report-modal-body');

    const btnApiKey = document.getElementById('btn-api-key');
    const authModal = document.getElementById('auth-modal');
    const btnCloseAuth = document.getElementById('btn-close-auth');
    const btnCloseAuthFooter = document.getElementById('btn-close-auth-footer');
    const btnSaveApiKey = document.getElementById('btn-save-api-key');
    const apiKeyInput = document.getElementById('api-key-input');

    const countTotal = document.getElementById('count-total');
    const countUnchecked = document.getElementById('count-unchecked');
    const countPending = document.getElementById('count-pending');
    const countChecked = document.getElementById('count-checked');
    const countFailed = document.getElementById('count-failed');
    const logCountBadge = document.getElementById('log-count');

    const tabCountAll = document.getElementById('tab-count-all');
    const tabCountUnchecked = document.getElementById('tab-count-unchecked');
    const tabCountPending = document.getElementById('tab-count-pending');
    const tabCountChecked = document.getElementById('tab-count-checked');
    const tabCountFailed = document.getElementById('tab-count-failed');

    // Active State
    let DEMO_MODE = true;
    let pollIntervalId = null;
    let activeFilter = 'ALL';
    let searchQuery = '';
    let staffApiKey = localStorage.getItem('solstice_api_key') || 'solstice-secret-key-2026';

    apiKeyInput.value = staffApiKey;

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
     * IN-BROWSER DEMO STORE & PERSISTENCE (Used in DEMO_MODE)
     * ========================================================================
     */
    class BrowserDemoStore {
        constructor() {
            this.storageKey = 'solstice_demo_store_v2';
            if (!this.loadFromStorage()) {
                this.seedData();
            }
        }

        saveToStorage() {
            try {
                const data = {
                    sequenceCounter: this.sequenceCounter,
                    processedJobIds: Array.from(this.processedJobIds),
                    attendees: this.attendees,
                    printJobs: this.printJobs,
                    logs: this.logs
                };
                localStorage.setItem(this.storageKey, JSON.stringify(data));
            } catch (e) {
                console.error("Failed to save to localStorage:", e);
            }
        }

        loadFromStorage() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (!raw) return false;
                const data = JSON.parse(raw);
                this.sequenceCounter = data.sequenceCounter || 1000;
                this.processedJobIds = new Set(data.processedJobIds || []);
                this.attendees = data.attendees || [];
                this.printJobs = data.printJobs || [];
                this.logs = data.logs || [];
                return true;
            } catch (e) {
                return false;
            }
        }

        seedData() {
            this.attendees = [
                {
                    id: "ATT-001",
                    name: "Alice Smith",
                    email: "alice@solsticeconf.com",
                    company: "Nexus AI",
                    ticket_type: "Standard Pass",
                    ticket_status: "ACTIVE",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null,
                    failed_reason: null
                },
                {
                    id: "ATT-002",
                    name: "Bob Jones",
                    email: "bob@solsticeconf.com",
                    company: "Quantum Labs",
                    ticket_type: "VIP Pass",
                    ticket_status: "ACTIVE",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null,
                    failed_reason: null
                },
                {
                    id: "ATT-003",
                    name: "Charlie Brown",
                    email: "charlie@solsticeconf.com",
                    company: "Peak Systems",
                    ticket_type: "Speaker Pass",
                    ticket_status: "ACTIVE",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null,
                    failed_reason: null
                },
                {
                    id: "ATT-004",
                    name: "Diana Prince",
                    email: "diana@solsticeconf.com",
                    company: "Themyscira Tech",
                    ticket_type: "Organizer",
                    ticket_status: "ACTIVE",
                    status: "NOT_CHECKED_IN",
                    current_job_id: null,
                    last_processed_seq: 0,
                    checked_in_at: null,
                    failed_reason: null
                }
            ];
            this.printJobs = [];
            this.processedJobIds = new Set();
            this.logs = [];
            this.sequenceCounter = 1000;
            this.addLog("SYSTEM", "SYS", "Demo mode initialized with persistent browser store.", "INFO");
            this.saveToStorage();
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
            this.saveToStorage();
        }

        getAttendees(query = '', statusFilter = 'ALL') {
            let res = [...this.attendees];

            if (query) {
                const q = query.trim().toLowerCase();
                res = res.filter(a =>
                    a.id.toLowerCase().includes(q) ||
                    a.name.toLowerCase().includes(q) ||
                    a.email.toLowerCase().includes(q) ||
                    a.company.toLowerCase().includes(q) ||
                    a.ticket_type.toLowerCase().includes(q)
                );
            }

            if (statusFilter && statusFilter !== 'ALL') {
                res = res.filter(a => a.status === statusFilter);
            }

            return res;
        }

        getQueue() { return this.printJobs; }
        getLogs() { return this.logs; }

        scanAttendee(attendeeId, simulateFailure = false) {
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

            if (att.ticket_status === 'CANCELLED') {
                this.addLog("SCAN_REJECTED", attendeeId, `Scan rejected for ${att.name}. Ticket is CANCELLED.`, "ERROR");
                return {
                    success: false,
                    status: 403,
                    message: `Ticket for '${att.name}' has been CANCELLED.`,
                    error_code: "TICKET_CANCELLED"
                };
            }

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

            // Valid scan -> transition to PENDING
            this.sequenceCounter++;
            const seqNum = this.sequenceCounter;
            const jobId = `JOB-DEMO-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

            att.status = "PENDING";
            att.current_job_id = jobId;
            att.failed_reason = null;

            const job = {
                job_id: jobId,
                attendee_id: attendeeId,
                sequence_number: seqNum,
                status: "QUEUED",
                created_at: new Date().toISOString()
            };
            this.printJobs.push(job);

            this.addLog("SCAN_ACCEPTED", attendeeId, `Scan accepted for ${att.name}. Status updated to PENDING. Print job '${jobId}' (seq #${seqNum}) queued.`, "SUCCESS");
            this.saveToStorage();

            // Simulate Hardware Print Delay (1.5s)
            setTimeout(() => {
                const finalStatus = simulateFailure ? "FAILED" : "SUCCESS";
                this.processWebhook({
                    job_id: jobId,
                    attendee_id: attendeeId,
                    status: finalStatus,
                    sequence_number: seqNum,
                    timestamp: new Date().toISOString(),
                    error_message: simulateFailure ? "Printer paper jam" : null
                });
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

        retryCheckIn(attendeeId) {
            const att = this.attendees.find(a => a.id === attendeeId);
            if (!att) return { success: false, message: "Attendee not found" };

            att.status = "NOT_CHECKED_IN";
            att.current_job_id = null;
            att.failed_reason = null;
            this.addLog("RETRY_INITIATED", attendeeId, `Staff initiated retry scan for ${att.name}.`, "INFO");
            this.saveToStorage();
            return this.scanAttendee(attendeeId);
        }

        processWebhook(payload) {
            const { job_id, attendee_id, status: payloadStatus, sequence_number, error_message } = payload;
            const att = this.attendees.find(a => a.id === attendee_id);
            if (!att) {
                this.addLog("WEBHOOK_ERROR", attendee_id, `Received webhook for unknown attendee '${attendee_id}'.`, "ERROR");
                return { action_taken: "REJECTED", message: "Attendee not found" };
            }

            if (this.processedJobIds.has(job_id)) {
                this.addLog("IDEMPOTENT_WEBHOOK_IGNORED", attendee_id, `Duplicate webhook received for completed Job '${job_id}'. Ignored safely.`, "WARNING");
                return { action_taken: "IGNORED", message: `Duplicate webhook ignored: Job '${job_id}' was already finalized.` };
            }

            if (sequence_number < att.last_processed_seq) {
                this.addLog("OUT_OF_ORDER_WEBHOOK_BLOCKED", attendee_id, `Stale webhook ignored! Incoming seq #${sequence_number} < Last processed seq #${att.last_processed_seq}.`, "WARNING");
                return { action_taken: "IGNORED", message: `Out-of-order webhook ignored (Incoming seq #${sequence_number} < processed seq #${att.last_processed_seq}).` };
            }

            const job = this.printJobs.find(j => j.job_id === job_id);

            if (payloadStatus.toUpperCase() === "SUCCESS") {
                att.status = "CHECKED_IN";
                att.checked_in_at = new Date().toLocaleString();
                att.last_processed_seq = Math.max(att.last_processed_seq, sequence_number);
                att.failed_reason = null;
                this.processedJobIds.add(job_id);

                if (job) job.status = "COMPLETED";

                this.addLog("WEBHOOK_CONFIRMED", attendee_id, `Printer callback SUCCESS for Job '${job_id}' (seq #${sequence_number}). ${att.name} is officially CHECKED IN!`, "SUCCESS");
                this.saveToStorage();
                return { action_taken: "PROCESSED", message: `Attendee ${att.name} successfully checked in.` };
            } else if (payloadStatus.toUpperCase() === "FAILED") {
                const errMsg = error_message || "Hardware paper jam or ribbon failure";
                att.status = "FAILED";
                att.failed_reason = errMsg;
                att.current_job_id = null;
                att.last_processed_seq = Math.max(att.last_processed_seq, sequence_number);
                this.processedJobIds.add(job_id);

                if (job) job.status = "FAILED";

                this.addLog("WEBHOOK_PRINT_FAILURE", attendee_id, `Printer callback FAILED for Job '${job_id}' (${errMsg}). Status updated to FAILED to allow staff retry.`, "ERROR");
                this.saveToStorage();
                return { action_taken: "PROCESSED", message: `Print job failed: ${errMsg}. Status updated to FAILED.` };
            }
        }

        getAttendanceSummary() {
            const atts = this.attendees;
            const totalReg = atts.length;
            const totalChecked = atts.filter(a => a.status === 'CHECKED_IN').length;
            const totalPending = atts.filter(a => a.status === 'PENDING').length;
            const totalFailed = atts.filter(a => a.status === 'FAILED').length;
            const totalOutstanding = atts.filter(a => a.status === 'NOT_CHECKED_IN' || a.status === 'FAILED').length;
            const rate = totalReg > 0 ? ((totalChecked / totalReg) * 100).toFixed(1) : 0;

            const byTicketMap = {};
            atts.forEach(a => {
                if (!byTicketMap[a.ticket_type]) {
                    byTicketMap[a.ticket_type] = { total: 0, checked: 0, pending: 0, failed: 0, outstanding: 0 };
                }
                byTicketMap[a.ticket_type].total++;
                if (a.status === 'CHECKED_IN') byTicketMap[a.ticket_type].checked++;
                else if (a.status === 'PENDING') byTicketMap[a.ticket_type].pending++;
                else if (a.status === 'FAILED') {
                    byTicketMap[a.ticket_type].failed++;
                    byTicketMap[a.ticket_type].outstanding++;
                } else {
                    byTicketMap[a.ticket_type].outstanding++;
                }
            });

            const byTicket = Object.keys(byTicketMap).map(ttype => {
                const t = byTicketMap[ttype];
                return {
                    ticket_type: ttype,
                    total_registered: t.total,
                    checked_in: t.checked,
                    pending: t.pending,
                    failed: t.failed,
                    outstanding: t.outstanding,
                    check_in_rate: t.total > 0 ? ((t.checked / t.total) * 100).toFixed(1) : 0
                };
            });

            return {
                generated_at: new Date().toLocaleString(),
                total_registered: totalReg,
                total_checked_in: totalChecked,
                total_pending: totalPending,
                total_failed: totalFailed,
                total_outstanding: totalOutstanding,
                check_in_rate: parseFloat(rate),
                by_ticket_type: byTicket
            };
        }
    }

    const demoStore = new BrowserDemoStore();

    /**
     * ========================================================================
     * ENVIRONMENT DETECTION & DUAL-MODE SWITCHER
     * ========================================================================
     */
    async function initEnvironmentMode() {
        const isStaticHost = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:';

        if (isStaticHost) {
            setMode(true, "DEMO MODE (Static Web)");
            return;
        }

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
            pollIntervalId = setInterval(refreshDataFromBackend, 1000);
            refreshDataFromBackend();
        } else {
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
        const attendees = demoStore.getAttendees(searchQuery, activeFilter);
        const allAttendees = demoStore.getAttendees('', 'ALL');
        const queue = demoStore.getQueue();
        const logs = demoStore.getLogs();

        renderAttendees(attendees);
        updateMetrics(allAttendees);
        renderQueue(queue);
        renderLogs(logs);
    }

    async function refreshDataFromBackend() {
        if (DEMO_MODE) return;
        try {
            let url = './api/attendees?';
            if (searchQuery) url += `search=${encodeURIComponent(searchQuery)}&`;
            if (activeFilter && activeFilter !== 'ALL') url += `status=${encodeURIComponent(activeFilter)}&`;

            const [respAtt, respQueue, respLogs, respAllAtt] = await Promise.all([
                fetch(url),
                fetch('./api/queue'),
                fetch('./api/logs'),
                fetch('./api/attendees')
            ]);

            if (respAtt.ok) {
                const dataAtt = await respAtt.json();
                renderAttendees(dataAtt.attendees || []);
            }

            if (respAllAtt.ok) {
                const dataAll = await respAllAtt.json();
                updateMetrics(dataAll.attendees || []);
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

    function updateMetrics(allAttendees) {
        const total = allAttendees.length;
        const unchecked = allAttendees.filter(a => a.status === 'NOT_CHECKED_IN').length;
        const pending = allAttendees.filter(a => a.status === 'PENDING').length;
        const checked = allAttendees.filter(a => a.status === 'CHECKED_IN').length;
        const failed = allAttendees.filter(a => a.status === 'FAILED').length;

        countTotal.textContent = total;
        countUnchecked.textContent = unchecked;
        countPending.textContent = pending;
        countChecked.textContent = checked;
        countFailed.textContent = failed;

        tabCountAll.textContent = total;
        tabCountUnchecked.textContent = unchecked;
        tabCountPending.textContent = pending;
        tabCountChecked.textContent = checked;
        tabCountFailed.textContent = failed;
    }

    function renderAttendees(attendees) {
        if (attendees.length === 0) {
            containerAttendees.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No attendees found matching search/filter criteria.</div>';
            return;
        }

        containerAttendees.innerHTML = attendees.map(att => {
            let statusText = "UNCHECKED";
            if (att.status === 'PENDING') statusText = "PENDING (Printing...)";
            if (att.status === 'CHECKED_IN') statusText = "CHECKED IN";
            if (att.status === 'FAILED') statusText = "FAILED (Printer Error)";

            const isFailed = att.status === 'FAILED';
            const isChecked = att.status === 'CHECKED_IN';
            const isPending = att.status === 'PENDING';

            let actionButton = '';
            if (isFailed) {
                actionButton = `<button class="btn btn-warning btn-block btn-sm" onclick="retryAttendee('${att.id}')">🔄 Retry Check-In</button>`;
            } else if (isChecked) {
                actionButton = `<button class="btn btn-secondary btn-block btn-sm" disabled>🔒 Checked In</button>`;
            } else if (isPending) {
                actionButton = `<button class="btn btn-secondary btn-block btn-sm" disabled>⏳ Printing Badge...</button>`;
            } else {
                actionButton = `<button class="btn btn-primary btn-block btn-sm" onclick="scanAttendee('${att.id}')">📷 Scan QR Code</button>`;
            }

            return `
                <div class="attendee-card ${isFailed ? 'failed-card' : ''}" id="card-${att.id}">
                    <div class="attendee-header">
                        <span class="attendee-id">${att.id}</span>
                        <span class="status-badge status-${att.status}">${statusText}</span>
                    </div>
                    <div class="attendee-info">
                        <h3>${att.name}</h3>
                        <p>${att.email} • ${att.company}</p>
                        <span class="ticket-tag">${att.ticket_type}</span>
                        ${att.failed_reason ? `<div class="error-reason">⚠️ ${att.failed_reason}</div>` : ''}
                    </div>
                    <div class="attendee-actions">
                        ${actionButton}
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
                <span class="status-badge status-${job.status === 'COMPLETED' ? 'CHECKED_IN' : (job.status === 'FAILED' ? 'FAILED' : 'PENDING')}">${job.status}</span>
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
    window.scanAttendee = async function(attendeeId, simulateFailure = false) {
        if (DEMO_MODE) {
            const res = demoStore.scanAttendee(attendeeId, simulateFailure);
            if (res.status === 409) {
                showToast(`DUPLICATE SCAN BLOCKED: ${res.message}`, 'warning');
            } else if (res.status === 403) {
                showToast(`SCAN BLOCKED: ${res.message}`, 'error');
            } else if (res.success) {
                showToast(`Check-in initiated for ${res.attendee.name}! Print Job ${res.job_id} queued.`, 'success');
            } else {
                showToast(res.message || "Scan failed.", 'error');
            }
            renderUIFromDemoStore();
        } else {
            try {
                const resp = await fetch('./api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': staffApiKey
                    },
                    body: JSON.stringify({ attendee_id: attendeeId, kiosk_id: 'KIOSK-MAIN-01' })
                });
                const data = await resp.json();
                if (resp.status === 409) {
                    showToast(`DUPLICATE SCAN BLOCKED: ${data.message}`, 'warning');
                } else if (resp.status === 401) {
                    showToast(`SECURITY AUTH ERROR: Invalid API Security Key. Click '🔑 API Security' to update key.`, 'error');
                } else if (resp.ok && data.success) {
                    showToast(`Check-in initiated for ${data.attendee.name}! Print Job ${data.job_id} queued.`, 'success');
                    if (simulateFailure && data.job_id) {
                        setTimeout(async () => {
                            await fetch('./api/simulate/out-of-order', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-API-Key': staffApiKey },
                                body: JSON.stringify({ attendee_id: attendeeId, sequence_number: 1004, status: 'FAILED', job_id: data.job_id })
                            });
                            refreshDataFromBackend();
                        }, 1200);
                    }
                } else {
                    showToast(data.message || "Scan failed.", 'error');
                }
                refreshDataFromBackend();
            } catch (err) {
                showToast("Network error executing scan.", 'error');
            }
        }
    };

    window.retryAttendee = async function(attendeeId) {
        showToast(`Retrying check-in for attendee ${attendeeId}...`, 'info');
        if (DEMO_MODE) {
            const res = demoStore.retryCheckIn(attendeeId);
            if (res.success) {
                showToast(`Retry initiated for ${res.attendee.name}!`, 'success');
            } else {
                showToast(res.message || "Retry failed", 'error');
            }
            renderUIFromDemoStore();
        } else {
            try {
                const resp = await fetch('./api/retry', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': staffApiKey
                    },
                    body: JSON.stringify({ attendee_id: attendeeId, kiosk_id: 'KIOSK-MAIN-01' })
                });
                const data = await resp.json();
                if (resp.ok && data.success) {
                    showToast(`Retry check-in initiated for ${data.attendee.name}!`, 'success');
                } else {
                    showToast(data.message || "Retry failed.", 'error');
                }
                refreshDataFromBackend();
            } catch (err) {
                showToast("Network error executing retry.", 'error');
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

    // Search Input Handling
    inputSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        btnSearchClear.classList.toggle('hidden', !searchQuery);
        if (DEMO_MODE) renderUIFromDemoStore();
        else refreshDataFromBackend();
    });

    btnSearchClear.addEventListener('click', () => {
        inputSearch.value = '';
        searchQuery = '';
        btnSearchClear.classList.add('hidden');
        if (DEMO_MODE) renderUIFromDemoStore();
        else refreshDataFromBackend();
    });

    // Filter Tabs Handling
    filterTabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (!tab) return;
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        if (DEMO_MODE) renderUIFromDemoStore();
        else refreshDataFromBackend();
    });

    // Rapid Duplicate Scan Button (ATT-002)
    btnSimDuplicateScan.addEventListener('click', () => {
        showToast("Simulating rapid double-scan on ATT-002 (Bob Jones)...", 'info');
        scanAttendee('ATT-002');
        setTimeout(() => {
            scanAttendee('ATT-002');
        }, 100);
    });

    // Hardware Printer Failure Simulation Button (ATT-004)
    btnSimPrinterFailure.addEventListener('click', () => {
        showToast("Simulating printer hardware error for ATT-004 (Diana Prince)...", 'warning');
        scanAttendee('ATT-004', true);
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
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': staffApiKey },
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
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': staffApiKey },
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

    // Attendance Summary Report Modal
    async function openReportModal() {
        let summary;
        if (DEMO_MODE) {
            summary = demoStore.getAttendanceSummary();
        } else {
            try {
                const resp = await fetch('./api/reports/summary');
                if (resp.ok) {
                    summary = await resp.json();
                } else {
                    summary = demoStore.getAttendanceSummary();
                }
            } catch (e) {
                summary = demoStore.getAttendanceSummary();
            }
        }

        reportModalBody.innerHTML = `
            <div class="report-summary-cards">
                <div class="report-stat-card">
                    <div class="val">${summary.total_registered}</div>
                    <div class="lbl">Total Registered</div>
                </div>
                <div class="report-stat-card">
                    <div class="val text-success" style="color: #34d399;">${summary.total_checked_in}</div>
                    <div class="lbl">Checked In</div>
                </div>
                <div class="report-stat-card">
                    <div class="val text-warning" style="color: #fbbf24;">${summary.total_pending}</div>
                    <div class="lbl">Pending Print</div>
                </div>
                <div class="report-stat-card">
                    <div class="val text-danger">${summary.total_failed}</div>
                    <div class="lbl">Failed Check-Ins</div>
                </div>
            </div>

            <div class="report-progress-section">
                <div class="progress-header">
                    <span>Overall Check-In Progress</span>
                    <strong>${summary.check_in_rate}% Complete</strong>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${summary.check_in_rate}%;"></div>
                </div>
            </div>

            <div class="report-table-container">
                <h4>Breakdown by Ticket Pass Type</h4>
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Ticket Pass</th>
                            <th>Total</th>
                            <th>Checked In</th>
                            <th>Pending</th>
                            <th>Failed</th>
                            <th>Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${summary.by_ticket_type.map(t => `
                            <tr>
                                <td><strong>${t.ticket_type}</strong></td>
                                <td>${t.total_registered}</td>
                                <td>${t.checked_in}</td>
                                <td>${t.pending}</td>
                                <td>${t.failed}</td>
                                <td><span class="status-badge status-CHECKED_IN">${t.check_in_rate}%</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        reportModal.classList.remove('hidden');
    }

    btnOpenReport.addEventListener('click', openReportModal);
    btnCloseReport.addEventListener('click', () => reportModal.classList.add('hidden'));
    btnCloseReportFooter.addEventListener('click', () => reportModal.classList.add('hidden'));

    // CSV Download Handling
    btnExportCsv.addEventListener('click', () => {
        if (!DEMO_MODE) {
            window.open('./api/reports/export', '_blank');
        } else {
            // Generate client-side CSV download in DEMO MODE
            const attendees = demoStore.getAttendees('', 'ALL');
            let csvContent = "data:text/csv;charset=utf-8," +
                "Attendee ID,Name,Email,Company,Ticket Type,Check-In Status,Checked In At,Job ID,Failed Reason\n";

            attendees.forEach(a => {
                csvContent += `"${a.id}","${a.name}","${a.email}","${a.company}","${a.ticket_type}","${a.status}","${a.checked_in_at || ''}","${a.current_job_id || ''}","${a.failed_reason || ''}"\n`;
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "solstice_attendance_report.csv");
            document.body.appendChild(link);
            link.click();
            link.remove();
        }
    });

    // API Key Modal Handling
    btnApiKey.addEventListener('click', () => authModal.classList.remove('hidden'));
    btnCloseAuth.addEventListener('click', () => authModal.classList.add('hidden'));
    btnCloseAuthFooter.addEventListener('click', () => authModal.classList.add('hidden'));
    btnSaveApiKey.addEventListener('click', () => {
        staffApiKey = apiKeyInput.value.trim();
        localStorage.setItem('solstice_api_key', staffApiKey);
        showToast("API Security Key updated successfully.", "success");
        authModal.classList.add('hidden');
    });

    // System Reset Button
    btnReset.addEventListener('click', async () => {
        if (DEMO_MODE) {
            demoStore.seedData();
            showToast("Demo system state reset to initial seed data.", 'success');
            renderUIFromDemoStore();
        } else {
            try {
                const resp = await fetch('./api/reset', {
                    method: 'POST',
                    headers: { 'X-API-Key': staffApiKey }
                });
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
