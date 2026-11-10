# How to run the project

### Frontend

```Shell
cd frontend
npm install --legacy-peer-deps  # Required to bypass a strict TypeScript version mismatch
npm run dev
```

* Vite dev server proxies `/api/*` requests to `http://localhost:8000` (configured in `frontend/vite.config.ts`).
* Run frontend tests and production build:
  ```Shell
  cd frontend
  npm test
  npm run build
  ```

### Backend

```Shell
cd backend
python -m venv venv
venv\Scripts\activate  # On Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
fastapi dev main.py
```

#### Seeding & Ingestion Pipeline

The backend features an automated scraping and ingestion pipeline (`scraper.py`) that parses faculty schedules, classroom locations, and optional course PDFs, expands weekly occurrences across the semester in campus local time, and seeds the database with student, teacher, and class session records.

- **CLI execution:**
  ```Shell
  cd backend
  python scraper.py
  ```
- **API endpoints:**
  - `POST /api/seed`: Trigger initial scraping & database seeding on demand (creates default `John Doe` student and `Grigoreta Cojocar` teacher accounts if absent).
  - `POST /api/schedule/refresh`: Refresh schedules and classrooms for all active specialization/year codes while preserving existing student attendance records.

#### Running Backend Tests

```Shell
cd backend
python -m unittest test_utils.py test_student_api.py
python -m unittest test_scraper.py  # Hits live UBB schedule/room pages; use a test DATABASE_URL to avoid resetting unitrack.db
```

#### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy database connection string | `sqlite:///./unitrack.db` |
| `ACADEMIC_YEAR` | Optional override for the academic start year (`Oct–Dec`: current year; `Jan–Jun`: `current year - 1`) | Derived from current campus date |
| `ACADEMIC_SEMESTER` | Optional semester override (`1` or `2`; `Oct–Jan` → `1`, `Feb–Jun` → `2`, `Jul–Sep` → non-academic) | Derived from current campus month |
| `SEMESTER_WEEKS` | Number of teaching weeks generated during scraping/seeding | `14` |
| `CAMPUS_TIMEZONE` | IANA timezone used to convert timetable hours to UTC and format local times | `Europe/Bucharest` |
| `UBB_ORAR_BASE_URL` | Optional full override for `https://www.cs.ubbcluj.ro/files/orar/{year}-{semester}` | Derived from `ACADEMIC_YEAR` & `ACADEMIC_SEMESTER` |
| `STUDENT_SCHEDULE_BASE_URL` | Optional override for the tabular schedules directory | `{UBB_ORAR_BASE_URL}/tabelar` |
| `GOOGLE_MAPS_API_KEY` | Optional API key for Google Maps Geocoding API (`GOOGLE_GEOCODING_API_KEY` / `GOOGLE_API_KEY` also accepted; falls back to campus coordinates if unset) | *None* (uses campus-building fallback logic) |
| `VITE_API_BASE_URL` | Optional frontend API origin override (leave unset to use same-origin `/api` + Vite proxy) | `""` (same origin) |

# PROJECT CONTEXT
**Read this entire document before generating code. Do not hallucinate API endpoints, data models, or tech stack choices. Stick strictly to the architecture, schemas, and contracts defined below.**

## Project Overview
A role-based web application for automated university attendance using HTML5 Geolocation. 
*   **Data Sourcing:** The backend scrapes static university HTML schedules dynamically by academic year, semester, and specialization/year code, and extracts optional courses from PDFs linked on the faculty website.
*   **Student Configuration:** Students authenticate with their user UUID (`Authorization: Bearer <token>`), enter a 3- or 4-digit base group (e.g., `933` or `1021`) + semi-group (`1` or `2`), and pick from optional courses loaded dynamically from the backend once a valid group is entered.
*   **Tracking Architecture:** We use an **autonomous 60-second Heartbeat strategy** via browser GPS, sharing each GPS fix with the dashboard map while a class window is active. 
*   **Known Constraint:** iOS/Android kill background JS execution. Students must keep the tab open and the screen awake.
*   **Timeline:** 14-day sprint. Speed, simplicity, and strict separation of concerns are mandatory.

## Tech Stack
*   **Frontend:** React, TypeScript, Vite, ESLint.
*   **Mapping:** Leaflet.js (`react-leaflet`), OpenStreetMap tiles.
*   **Backend:** FastAPI (Python), `uvicorn`, SQLAlchemy (SQLite default), Pydantic.
*   **Scraping & Parsing:** `BeautifulSoup4` and `httpx` for HTML parsing, `pypdf` for parsing optional course PDFs, Google Maps Geocoding API (with campus building fallbacks).
*   **Database Math:** Haversine formula on the backend to validate distances.

## Project Structure
```text
/
├── frontend/
│   ├── package.json
│   ├── vite.config.ts       # Vite config + /api proxy to http://localhost:8000
│   ├── tests/               # Node test suite (npm test) using Vite SSR loader
│   └── src/
│       ├── components/      # AppHeader, MapView, ScheduleList, StudentConfigForm, StudentRoster, WarningBanner
│       ├── hooks/           # useAttendanceHeartbeat, useNow, useRosterPolling
│       ├── pages/           # DashboardPage
│       ├── services/        # apiClient, studentService, checkInService, heartbeatService, geolocationService, teacherService
│       ├── types/
│       └── utils/           # classTime
│
└── backend/
    ├── requirements.txt
    ├── database.py          # SQLAlchemy engine, session management, and Base
    ├── models.py            # SQLAlchemy ORM models (User, ClassSession, AttendanceRecord)
    ├── schemas.py           # Pydantic request/response schemas
    ├── utils.py             # Haversine distance, group parsing, academic calendar & dynamic URL builders
    ├── scraper.py           # On-demand & full-semester HTML/PDF parsing, geocoding, and seeding
    ├── test_utils.py        # Unit tests for distance, group decoding, academic calendar, and URLs
    ├── test_student_api.py  # Unit tests for student config, optionals, schedule, and check-in APIs
    ├── test_scraper.py      # Scraper and seeding test suite
    └── main.py              # FastAPI application and route definitions
```

## Scraping Targets & Ingestion Pipeline

The `scraper.py` pipeline handles base schedules, room mappings, optional (elective) courses, timezone-aware multi-week expansion, and database seeding:

* **Group Code Logic:** Supports both 1-digit (`1`–`9`) and 2-digit (`10`, `13`–`16`) UBB specialization codes by parsing from the right (`base_group[:-2]` for specialization, `base_group[-2]` for year digit):
  * 1-digit: `1`→`M`, `2`→`I`, `3`→`MI`, `4`→`MM`, `5`→`IM`, `6`→`MIM`, `7`→`IG`, `8`→`MIE`, `9`→`IE` (e.g., `933/1` → `IE3`).
  * 2-digit: `10`→`IA`, `13`→`II`, `14`→`IIM`, `15`→`MIDS`, `16`→`MIMDS` (e.g., `1631/1` → `MIMDS3`).
* **Student Schedules (Dynamic per Specialization/Year):** `https://www.cs.ubbcluj.ro/files/orar/{year}-{semester}/tabelar/{year_code}.html` (e.g., `.../2026-1/tabelar/IE3.html`, `.../2026-1/tabelar/MIMDS3.html`).
  * Contains HTML tables grouped by `<h1>Grupa ...</h1>` headers extracting subgroup (`933/1`, `1631/1`), base group (`933`, `1631`), and year-wide (`IE3`, `MIMDS3`) classes.
  * When a student queries `/api/student/optionals?group=...`, saves `/api/student/config`, or fetches `/api/student/schedule`, `ensure_year_code_loaded` scrapes and caches that `year_code` on demand if not yet present in the database.
* **Teacher Schedules:** `https://www.cs.ubbcluj.ro/files/orar/{year}-{semester}/cadre/{teacher_code}.html` (default `mogr1.html`).
  * Data is housed in a table with columns: Ziua, Orele, Frecventa, Sala, Anul, Formatia, Tipul, Disciplina.
* **Classroom Locations & Geocoding:** `https://www.cs.ubbcluj.ro/files/orar/{year}-{semester}/sali/legenda.html`
  * HTML table mapping the shortcode `Sala` to the physical `Localizarea`.
  * Geocodes addresses primarily via the Google Maps Geocoding API if `GOOGLE_MAPS_API_KEY` is configured, with built-in fallbacks for known UBB buildings (Cantemir, FSEGA, Mathematica, NTT Data, etc.).
* **Optional Courses (Electives):** `https://www.cs.ubbcluj.ro/lista-cursurilor-optionale-alese-pentru-anul-universitar-{year}-{year + 1}/`
  * Navigates `<td class="lyf_td_filename">` links, downloads undergraduate elective PDFs in memory with `pypdf`, and marks matching `ClassSession` rows with `is_optional = True`.
* **Academic Calendar, Multi-Week Expansion & Time Normalization:**
  * `Oct–Jan` maps to Semester `1`, `Feb–Jun` maps to Semester `2`, and `Jul–Sep` is treated as a non-academic break (`resolve_semester` returns `None`, skipping automatic scraping unless `ACADEMIC_SEMESTER` is set).
  * Romanian days (`Luni`, `Marți`, etc.) and hours (e.g., `10-12`) are interpreted in `CAMPUS_TIMEZONE` (`Europe/Bucharest`, handling EET/EEST DST) and converted to UTC datetimes for storage, while `time` display strings are formatted in campus local time.
  * `assemble_class_sessions` expands timetable entries across `SEMESTER_WEEKS` (default `14`) teaching weeks anchored to Week 1 (Monday containing October 1), honoring `frequency` (`"sapt. 1"` odd weeks, `"sapt. 2"` even weeks, `""` weekly).
* **Deterministic Session IDs & Data Preservation:**
  * Generates deterministic UUIDv5 identifiers per weekly occurrence (`subject:start_time:formatia:room`), deduplicating identical lecture entries.
  * `refresh_schedule` refreshes all active `year_code`s, upserts sessions without touching `User` or `AttendanceRecord` data, and prunes obsolete `ClassSession` rows that have no linked `AttendanceRecord`.

## Data Models (Source of Truth)

Do not invent fields. Use these exact structures for database rows and frontend TypeScript interfaces.

**User**

```json
{
  "id": "uuid",
  "name": "John Doe",
  "role": "student", 
  "group": "933/1",       // Includes semi-group (e.g., 933/1 or 933/2)
  "optionals": ["Cloud Computing", "Machine Learning"] // Array of chosen electives
}
```

**ClassSession**

```json
{
  "id": "uuid",
  "subject": "Interactiunea om-calculator",
  "start_time": "2026-10-30T10:00:00Z",
  "end_time": "2026-10-30T12:00:00Z",
  "building_name": "Univ Dimitrie Cantemir, etaj 5",
  "target_lat": 46.5743,
  "target_lng": 23.7841,
  "radius_meters": 100,
  "required_group": "933/1",   // Can be base group ("933"), semi-group ("933/1"), or year ("IE3")
  "is_optional": false,
  "room": "DC508",             // Optional classroom shortcode
  "teacher_name": "Conf. COJOCAR Grigoreta",
  "frequency": "",             // "sapt. 1", "sapt. 2", or empty for weekly
  "class_type": "Laborator"    // "Curs", "Laborator", "Seminar"
}
```

**AttendanceRecord (Heartbeat Enabled)**

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "class_session_id": "uuid",
  "status": "Pending", // "Pending" | "Present" | "Left Early"
  "check_in_time": "2026-10-30T10:05:00Z", 
  "last_seen_at": "2026-10-30T10:45:00Z", 
  "override": false 
}
```

## API Contracts

Frontend and Backend teams must adhere to these exact endpoints and payloads.

### 1. Student Configuration & Optional Courses Catalog

* **Endpoint:** `PUT /api/student/config`
* **Headers:** `Authorization: Bearer <token>`
* **Payload:** `{"group": "933/1", "optionals": ["Criptografie cu cheie publica"]}` (`group` must match `^\d{3,4}/\d+$`; triggers on-demand scraping for the group's `year_code` if not yet loaded)
* **Response (200 OK):** `{"message": "Configuration saved"}`

* **Optional Courses Catalog:**
  * **Endpoint:** `GET /api/student/optionals` (optional query param `?group=<base_or_full_group>`, e.g. `?group=933` or `?group=1631`)
  * **Backend Logic:** Triggers on-demand scraping for valid groups if missing, and returns distinct sorted `is_optional == True` course names.
  * **Response (200 OK):** `["Criptografie cu cheie publica", "DevOps: Automatizari in cloud"]`

### 2. Student Schedule

* **Endpoint:** `GET /api/student/schedule` (optional query params `date=YYYY-MM-DD` and `days=1..365`; frontend requests a 7-day rolling window starting today)
* **Headers:** `Authorization: Bearer <token>`
* **Backend Logic:** Triggers on-demand scraping for the student's `year_code` if missing, then strictly returns mandatory classes (`is_optional == False`) matching `semi_group`, `base_group`, or `year_code`, plus `is_optional == True` classes only when selected in `optionals` **and** matching the student's group/year (or `"optional"`).
* **Response (200 OK):**
```json
[
  {
    "class_id": "uuid",
    "subject": "Interactiunea om-calculator",
    "time": "10:00 AM - 12:00 PM",
    "building_name": "Univ Dimitrie Cantemir, etaj 5",
    "room": "DC508",
    "class_type": "Laborator",
    "target_lat": 46.5743,
    "target_lng": 23.7841,
    "start_time": "2026-10-30T08:00:00Z",
    "end_time": "2026-10-30T10:00:00Z",
    "status": "Pending"
  }
]
```

### 3. Student Geolocation Heartbeat (Fired every 60s)

* **Endpoint:** `POST /api/student/checkin`
* **Headers:** `Authorization: Bearer <token>`
* **Payload:** `{"class_id": "uuid", "user_lat": 46.5745, "user_lng": 23.7840}`
* **Response (200 OK):** `{"status": "Present", "distance_meters": 18.4}` (`status` is `"Present"` within `radius_meters`, or `"Left Early"` when out of range; non-2xx responses are treated as request errors)

### 4. Teacher Schedule & Live Roster (Polled every 10s)

* **Endpoint:** `GET /api/teacher/classes`
* **Endpoint:** `GET /api/teacher/roster/{class_id}`

### 5. Teacher Attendance Override

* **Endpoint:** `POST /api/teacher/override`
* **Payload:** `{"class_id": "uuid", "user_id": "uuid"}`
* **Backend Logic:** Allows a teacher to manually mark a student as present for a specific class. The backend must set the student's `AttendanceRecord.status` to `"Present"` and set the record's `override` flag to `true` for that class. This is a teacher-confirmed override and should not be silently replaced by later GPS heartbeat updates while the override is active.
* **Response (200 OK):** `{"message": "Attendance overridden"}`

### 6. Ingestion & Schedule Management

* **Seed Database:**
  * **Endpoint:** `POST /api/seed`
  * **Backend Logic:** Triggers the scraper and database seeding pipeline on demand. Seeds classrooms, 14-week sessions, and default test users (`John Doe`, group `933/1` student; `Grigoreta Cojocar` teacher). During `Jul–Sep` without `ACADEMIC_SEMESTER` set, returns `{"status": "skipped", "reason": "non-academic period (Jul-Sep)", ...}`.
  * **Response (200 OK):**
    ```json
    {
      "status": "success",
      "sessions_seeded": 1393,
      "users_seeded": 2,
      "rooms_mapped": 73,
      "sessions_created": 1393,
      "sessions_updated": 0,
      "sessions_deleted": 0,
      "total_sessions": 1393,
      "attendance_records_preserved": 0
    }
    ```

* **Refresh Schedule:**
  * **Endpoint:** `POST /api/schedule/refresh`
  * **Backend Logic:** Refreshes class sessions for all active specialization/year codes by re-scraping schedules and classrooms, upserting deterministic session IDs without destroying attendance records or users, and pruning obsolete unreferenced sessions.
  * **Response (200 OK):**
    ```json
    {
      "status": "success",
      "sessions_seeded": 1393,
      "users_seeded": 2,
      "rooms_mapped": 73,
      "sessions_created": 0,
      "sessions_updated": 1393,
      "sessions_deleted": 0,
      "total_sessions": 1393,
      "attendance_records_preserved": 12
    }
    ```

## Student Dashboard Flow

* **Configuration & Auth (`StudentConfigForm`):** Requires the student's UUID token (stored in `localStorage` under `unitrack.auth.token` on save), a valid 3- or 4-digit UBB base group (`isValidBaseGroup`), and a semi-group (`1` or `2`). Optional courses are fetched from `GET /api/student/optionals?group=...` once a valid base group is entered.
* **Schedule Display (`ScheduleList`):** Fetches a 7-day rolling window via `GET /api/student/schedule?date=<YYYY-MM-DD>&days=7`, renders today's classes with inline classroom codes (`Room DC508 · ...`) and mapped `class_type` tags (`Curs`→`Lecture`, `Laborator`→`Lab`, `Seminar`→`Seminar`), and reflects backend `Present` (green) and `Left Early` (red) statuses.
* **Map & Heartbeat (`DashboardPage`, `useAttendanceHeartbeat`, `MapView`):** Polls GPS only while a class window is active (immediate check-in + 60-second cadence), sends `POST /api/student/checkin`, and shares each successful GPS fix along with the active/next class's target coordinates with `MapView`. Missing credentials and HTTP/request errors remain visible as alerts.

## UI/UX & Thematic Guidelines
All frontend components must strictly adhere to a unified "Clean Light Blue" design system. Do not invent custom color palettes, CSS frameworks, or dark mode overrides. Use standard Tailwind CSS classes and keep the interface consistent across student and teacher flows.

*   **Global Theme:** Strictly Light Mode. Do not write or generate `dark:` class variants.
*   **Color Palette:**
    *   **App Background:** Off-white with a subtle cool tint (e.g., Tailwind `bg-slate-50` or `#F8FAFC`).
    *   **Primary Accent:** Vibrant sky blue for primary actions, active states, and headers (e.g., `bg-sky-500` or `#0EA5E9`). Hover states should be slightly darker (`hover:bg-sky-600`).
    *   **Text:** Dark slate for primary readability (`text-slate-800`); medium gray for secondary labels (`text-slate-500`).
*   **Cards & Layout:** 
    *   Wrap schedules, the Leaflet map, and the roster table in crisp white containers with subtle shadows and rounded corners (`bg-white rounded-xl shadow-sm border border-slate-100`).
    *   Maintain consistent padding (e.g., `p-6`) inside all cards.
*   **Buttons & Inputs:**
    *   **Primary Buttons:** Solid sky blue, white text, medium font weight (`bg-sky-500 text-white rounded-lg px-4 py-2 font-medium`).
    *   **Form Inputs (Config Modal):** White background, light gray borders, with a sky blue focus ring (`border-slate-200 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none`).
*   **Typography:** Use a standard, modern sans-serif stack (e.g., Inter, Roboto, or system-ui). 
*   **Status Badges:** Use specific colors for attendance states to contrast against the blue theme:
    *   Present / Tracking Active: `text-emerald-600 bg-emerald-50`
    *   Pending / Waiting: `text-slate-600 bg-slate-100`
    *   Left Early / Warning Banner: `text-rose-700 bg-rose-50`

## AI Development Directives

1. **Parallel Execution:** Frontend components MUST be built using mock JSON objects based on the API Contracts above before wiring up the real HTTP fetches.
2. **No Extraneous Features:** Do not write code for background location tracking plugins, GPS spoofing prevention, or advanced caching. Follow the MVP scope exactly.
3. **Automated Heartbeat Logic (Critical):** There are NO "Check In" or "Start Class" buttons on the student UI. The frontend must automatically check the current device time against the schedule and send the geolocation heartbeat at a fixed 60-second cadence when a student is currently in an active class window.
4. **UX Constraints:** The student UI MUST include a permanent, highly visible warning advising them NOT to lock their screen or close the tab while the class is active.
