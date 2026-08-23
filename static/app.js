document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const containerAttendees = document.getElementById('attendees-container');
    const containerQueue = document.getElementById('queue-container');
    const containerLogs = document.getElementById('log-container');
    const inputScan = document.getElementById('scan-input');
    const btnScanSubmit = document.getElementById('btn-scan-submit');
    const btnReset = document.getElementById('btn-reset');
    
    const btnSimDuplicateScan = document.getElementById('btn-sim-duplicate-scan');
    const btnSimOutOfOrder = document.getElementById('btn-sim-out-of-order');
    const btnSimDuplicateWebhook = document.getElementById('btn-sim-duplicate-webhook');
    
    const countTotal = document.getElementById('count-total');
    const countUnchecked = document.getElementById('count-unchecked');
    const countPending = document.getElementById('count-pending');
    const countChecked = document.getElementById('count-checked');
    const logCountBadge = document.getElementById('log-count');

    // Global state
    let cachedAttendees = [];
    let currentJobForReplay = null;

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

    // Fetch and render data
    async function refreshData() {
        try {
            const [respAtt, respQueue, respLogs] = await Promise.all([
                fetch('/api/attendees'),
                fetch('/api/queue'),
                fetch('/api/logs')
            ]);

            if (respAtt.ok) {
                const dataAtt = await respAtt.json();
                cachedAttendees = dataAtt.attendees || [];
                renderAttendees(cachedAttendees);
                updateMetrics(cachedAttendees);
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
            console.error("Polling error:", err);
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

            const canScan = att.status === 'NOT_CHECKED_IN';
            
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

        containerQueue.innerHTML = jobs.map(job => {
            if (job.status === 'COMPLETED' || job.status === 'QUEUED') {
                currentJobForReplay = job;
            }
            return `
                <div class="queue-item">
                    <div>
                        <strong>Job ID: ${job.job_id}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">Attendee: ${job.attendee_id} • Seq #${job.sequence_number}</div>
                    </div>
                    <span class="status-badge status-${job.status === 'COMPLETED' ? 'CHECKED_IN' : 'PENDING'}">${job.status}</span>
                </div>
            `;
        }).join('');
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

    // Single Scan Handler
    window.scanAttendee = async function(attendeeId) {
        try {
            const resp = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attendee_id: attendeeId, kiosk_id: 'KIOSK-MAIN-01' })
            });

            const data = await resp.json();

            if (resp.status === 409) {
                // DUPLICATE SCAN BLOCKED!
                showToast(`DUPLICATE SCAN BLOCKED: ${data.message}`, 'warning');
            } else if (resp.ok && data.success) {
                showToast(`Check-in initiated for ${data.attendee.name}! Print Job ${data.job_id} published to vendor queue.`, 'success');
            } else {
                showToast(data.message || "Scan failed.", 'error');
            }

            refreshData();
        } catch (err) {
            showToast("Network error executing scan.", 'error');
        }
    };

    // Custom Input Submit
    btnScanSubmit.addEventListener('click', () => {
        const val = inputScan.value.trim();
        if (val) {
            scanAttendee(val);
            inputScan.value = '';
        }
    });

    // Rapid Duplicate Scan Simulation Button (ATT-002)
    btnSimDuplicateScan.addEventListener('click', async () => {
        showToast("Simulating rapid double-scan on ATT-002 (Bob Jones)...", 'info');
        // 1st scan
        scanAttendee('ATT-002');
        // Immediate 2nd scan without waiting
        setTimeout(() => {
            scanAttendee('ATT-002');
        }, 100);
    });

    // Out-of-Order Webhook Simulation Button (ATT-003)
    btnSimOutOfOrder.addEventListener('click', async () => {
        showToast("Sending stale sequence webhook (Seq #999)...", 'info');
        try {
            const resp = await fetch('/api/simulate/out-of-order', {
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
            showToast(`Out-of-Order Webhook Action: ${action} - ${data.simulation_result.message}`, action === 'IGNORED' ? 'warning' : 'info');
            refreshData();
        } catch (err) {
            showToast("Failed to simulate out-of-order webhook.", 'error');
        }
    });

    // Duplicate Webhook Replay Button
    btnSimDuplicateWebhook.addEventListener('click', async () => {
        if (!currentJobForReplay) {
            showToast("Please perform a check-in first to generate a print job to replay.", 'warning');
            return;
        }
        showToast(`Replaying duplicate webhook for Job '${currentJobForReplay.job_id}'...`, 'info');
        try {
            const resp = await fetch('/api/simulate/out-of-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    attendee_id: currentJobForReplay.attendee_id,
                    sequence_number: currentJobForReplay.sequence_number,
                    status: 'SUCCESS',
                    job_id: currentJobForReplay.job_id
                })
            });
            const data = await resp.json();
            const action = data.simulation_result.action_taken;
            showToast(`Idempotency Check: ${action} - ${data.simulation_result.message}`, action === 'IGNORED' ? 'warning' : 'success');
            refreshData();
        } catch (err) {
            showToast("Failed to replay duplicate webhook.", 'error');
        }
    });

    // Reset System
    btnReset.addEventListener('click', async () => {
        try {
            const resp = await fetch('/api/reset', { method: 'POST' });
            if (resp.ok) {
                showToast("System state reset to initial seed data.", 'success');
                refreshData();
            }
        } catch (err) {
            showToast("Failed to reset system.", 'error');
        }
    });

    // Initial load and fast polling interval (1s)
    refreshData();
    setInterval(refreshData, 1000);
});
