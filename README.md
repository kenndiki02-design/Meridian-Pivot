# Solstice Events - Asynchronous Kiosk Check-In & Badge Printer System

An event check-in kiosk application built for **Solstice Events Co.** to handle high-throughput event check-ins during multi-day technology conferences.

This repository contains **ONE unified solution** supporting two execution environments:
1. **Local / Backend Mode**: Complete Python & FastAPI backend with REST endpoints, background task workers, and Pytest test suite.
2. **GitHub Pages / Demo Mode**: Standalone static web frontend that runs 100% in-browser using JavaScript simulation (no Python server required).

---

## ⚡ The Pivot Context

Previously, kiosk staff scanned an attendee's QR code and waited synchronously for the badge printer REST API to finish printing before showing "Checked In" on screen.

Under the new **Asynchronous Architecture**:
1. Staff scan an attendee's QR code at the kiosk.
2. The kiosk updates the attendee status to `PENDING` and publishes a print request onto the vendor's message queue.
3. The kiosk UI immediately reflects the `PENDING` state while waiting for printer confirmation.
4. The badge printer processes the job asynchronously and invokes Solstice's webhook endpoint (`/api/webhooks/print-status`).
5. On receipt of a valid `SUCCESS` webhook payload, the attendee state transitions to `CHECKED_IN`.
6. **Duplicate Scan Protection**: Rejects duplicate scans during `PENDING` or `CHECKED_IN` states with an HTTP `409 Conflict` error (or browser demo warning).
7. **Out-of-Order & Idempotency Resilience**: Monotonic sequence tracking ensures out-of-order webhooks do not corrupt attendee states, and duplicate webhook delivery is handled safely.

---

## 🌐 GitHub Pages Deployment

### Static Frontend in Demo Mode
GitHub Pages is a static file host and **cannot execute Python or FastAPI backends**. To make the frontend independently deployable on GitHub Pages, the application features an automatic **DEMO MODE**:

- When opened from a GitHub Pages URL or `file://` link, the frontend automatically activates **DEMO MODE**.
- All check-in logic, duplicate scan blocking, async print queue delays (`setTimeout`), out-of-order sequence verification, and audit logging run in pure browser JavaScript.
- No local server, Python, or database installation is required.

---

### Step-by-Step GitHub Pages Setup Instructions

1. **Push Repository to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Add Solstice Events check-in kiosk with GitHub Pages dual-mode support"
   git branch -M main
   git remote add origin https://github.com/USERNAME/REPOSITORY.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub (`https://github.com/USERNAME/REPOSITORY`).
   - Click **Settings** ➔ **Pages** (in the left sidebar under Code and automation).
   - Under **Build and deployment**:
     - **Source**: Select `Deploy from a branch`.
     - **Branch**: Select `main` / `master` branch and `/ (root)` folder.
   - Click **Save**.

3. **Expected Live GitHub Pages URL**:
   ```text
   https://USERNAME.github.io/REPOSITORY/
   ```
   *(Or if publishing the `static/` directory as root to a `gh-pages` branch, `https://USERNAME.github.io/REPOSITORY/static/`)*.

---

### 🧪 Evaluator Demo Walkthrough (GitHub Pages or Standalone)

An evaluator visiting the GitHub Pages URL can test the full asynchronous check-in lifecycle:

1. **Scan an Attendee**: Click **📷 Scan QR Code** on **ATT-001 (Alice Smith)**.
2. **Observe PENDING State**: Status instantly updates to `PENDING (Printing...)`.
3. **Vendor Queue Visualizer**: Observe the print request appear in the **Vendor Print Queue (Async)** panel.
4. **Asynchronous Webhook Callback**: After a 1.5-second simulated delay, the simulated webhook confirms printing, transitioning status to **CHECKED IN**.
5. **Duplicate Scan Protection**: Click **📷 Scan QR Code** on **ATT-001** again (or click **🚫 Test Rapid Duplicate Scan (ATT-002)**). Observe the **DUPLICATE SCAN BLOCKED** warning toast (HTTP 409 Conflict simulation) — no second print request is queued.
6. **Out-of-Order Webhook Test**: Click **⚡ Send Stale / Out-of-Order Webhook (Seq #999)** for **ATT-003**. Observe the sequence guard blocking stale packets (`action_taken: IGNORED`).
7. **System Reset**: Click **🔄 Reset System** to restore all attendees to initial seed state.

---

## 🚀 Local Backend Deployment (FastAPI)

When running locally with Python, the frontend automatically detects the FastAPI server and connects in **BACKEND MODE**:

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start Application Server
```bash
python -m uvicorn app.main:app --reload --port 8000
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser.

### 3. Run Automated Pytest Test Suite
```bash
python -m pytest tests/ -v
```

---

## 🛠️ Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI app, REST endpoints & static root mounting
│   ├── models.py           # Pydantic schemas, Enums, Webhook & Log models
│   ├── store.py            # Thread-safe in-memory state store & sequence guard
│   └── queue_simulator.py  # Asynchronous vendor print queue & webhook dispatcher
├── static/
│   ├── index.html          # Entry point for GitHub Pages & Local FastAPI
│   ├── styles.css          # Glassmorphism dark UI design system (relative path)
│   └── app.js              # Dual-mode frontend (Browser Demo Mode & Backend API Mode)
├── tests/
│   ├── __init__.py
│   └── test_checkin.py     # Pytest test suite (7 test scenarios)
├── README.md               # Architecture documentation & GitHub Pages deployment guide
├── JOURNAL.md              # Learning & Blocker evidence journal
└── requirements.txt        # Python dependencies
```
