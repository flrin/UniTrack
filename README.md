# How to run the project

### Frontend

```Shell
cd frontend
npm install --legacy-peer-deps  # Required to bypass a strict TypeScript version mismatch
npm run dev
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

The backend features an automated scraping and ingestion pipeline (`scraper.py`) that parses faculty schedules, classroom locations, and optional course PDFs, normalizes dates/times, and seeds the database with the required records for students, teachers, and class sessions.

- **CLI execution:**
  ```Shell
  cd backend
  python scraper.py
  ```
- **API endpoints:**
  - `POST /api/seed`: Trigger initial scraping & database seeding on demand.
  - `POST /api/schedule/refresh`: Refresh schedules and classrooms while preserving existing student attendance records.

#### Running Backend Tests

```Shell
cd backend
python -m unittest test_scraper.py
```

#### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy database connection string | `sqlite:///./unitrack.db` |
| `ACADEMIC_YEAR` | Calendar year for the academic term (anchors semester week 1 to Monday of week containing Oct 1) | `2026` |
| `GOOGLE_MAPS_API_KEY` | Optional API key for Google Maps Geocoding API (`GOOGLE_GEOCODING_API_KEY` / `GOOGLE_API_KEY` also accepted; falls back to campus coordinates if unset) | *None* (uses campus-building fallback logic) |

# PROJECT CONTEXT
**Read this entire document before generating code. Do not hallucinate API endpoints, data models, or tech stack choices. Stick strictly to the architecture, schemas, and contracts defined below.**

## Project Overview
A role-based web application for automated university attendance using HTML5 Geolocation. 
*   **Data Sourcing:** The backend scrapes static university HTML schedules and extracts optional courses from PDFs linked on the faculty website.
*   **Student Configuration:** Students belong to specific subgroups (e.g., 933/1) and have personalized schedules based on their chosen optional courses (electives).
*   **Tracking Architecture:** We use an **autonomous 60-second Heartbeat strategy** via browser GPS. 
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
│   └── src/            
│       ├── components/ 
│       ├── pages/      
│       ├── services/   
│       └── types/      
│
└── backend/            
    ├── requirements.txt
    ├── database.py     # SQLAlchemy engine, session management, and Base
    ├── models.py       # SQLAlchemy ORM models and Pydantic schemas
    ├── scraper.py      # HTML/PDF parsing, room geocoding, normalization, and seeding
    ├── test_scraper.py # Unit test suite for scraper, models, and endpoints
    └── main.py         # FastAPI application and route definitions
```

## Scraping Targets & Ingestion Pipeline

The `scraper.py` pipeline handles base schedules, room mappings, optional (elective) courses, time normalization, and database seeding:

* **Group Code Logic:** A student's group dictates their specialization and year. For example, in group `933`: the first digit (`9`) represents the specialization (Informatica Engleza), the second digit (`3`) is the year, and the grouping logic is normalized into a base group and semi-group model.
* **Student Schedules:** `https://www.cs.ubbcluj.ro/files/orar/2026-1/tabelar/IE3.html`
  * Contains multiple HTML tables grouped by subgroup headers (e.g., `<h1>Grupa 931</h1>`) to extract base classes and subgroup-specific labs (e.g., group `933/1` vs `933/2`, base group `933`, or year-level classes like `IE3`).
* **Teacher Schedules:** `https://www.cs.ubbcluj.ro/files/orar/2026-1/cadre/mogr1.html`
  * Data is housed in a table with columns: Ziua, Orele, Frecventa, Sala, Anul, Formatia, Tipul, Disciplina.
* **Classroom Locations & Geocoding:** `https://www.cs.ubbcluj.ro/files/orar/2026-1/sali/legenda.html`
  * HTML table mapping the shortcode `Sala` to the physical `Localizarea`.
  * Geocodes addresses primarily via the Google Maps Geocoding API if `GOOGLE_MAPS_API_KEY` is configured, with built-in fallbacks for known UBB buildings (Cantemir, FSEGA, Mathematica, NTT Data, etc.).
* **Optional Courses (Electives):** `https://www.cs.ubbcluj.ro/lista-cursurilor-optionale-alese-pentru-anul-universitar-2026-2027/`
  * The scraper navigates to this page, targets `<td class="lyf_td_filename">` elements, and extracts links to elective PDFs. The backend downloads these PDFs in memory using `pypdf`, extracts course metadata, and stores the subject mapping as part of the student's configured electives.
* **Academic Calendar & Time Normalization:**
  * Romanian days (`Luni`, `Marți`, etc.) and hours (e.g., `10-12`) are normalized into UTC datetime objects.
  * Week 1 of the semester is automatically anchored to the Monday–Sunday week containing October 1 for the configured `ACADEMIC_YEAR` (default `2026`).
* **Deterministic Session IDs & Data Preservation:**
  * Generates deterministic UUIDv5 identifiers from course metadata (`subject:start_time:formatia:room`), deduplicating identical lecture entries.
  * The `refresh_schedule` workflow upserts session details without dropping or corrupting existing student `AttendanceRecord`s or `User` records.

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

### 1. Student Configuration

* **Endpoint:** `PUT /api/student/config`
* **Headers:** `Authorization: Bearer <token>`
* **Payload:** `{"group": "933/1", "optionals": ["Cloud Computing"]}`
* **Response (200 OK):** `{"message": "Configuration saved"}`

### 2. Student Schedule

* **Endpoint:** `GET /api/student/schedule`
* **Headers:** `Authorization: Bearer <token>`
* **Backend Logic:** Return classes where `required_group` matches the user's full semi-group (`933/1`), their base group (`933`), the entire year/specialization (`IE3`), AND any `is_optional` classes selected in `optionals`.
* **Response (200 OK):**
```json
[
  {
    "class_id": "uuid",
    "subject": "Interactiunea om-calculator",
    "time": "10:00 AM - 12:00 PM",
    "building_name": "Univ Dimitrie Cantemir, etaj 5",
    "target_lat": 46.5743,
    "target_lng": 23.7841,
    "status": "Pending" 
  }
]
```

### 3. Student Geolocation Heartbeat (Fired every 60s)

* **Endpoint:** `POST /api/student/checkin`
* **Payload:** `{"class_id": "uuid", "user_lat": 46.5745, "user_lng": 23.7840}`

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
  * **Backend Logic:** Triggers the scraper and database seeding pipeline on demand. Seeds classrooms, sessions, and default test users (`John Doe`, group `933/1` student; `Grigoreta Cojocar` teacher).
  * **Response (200 OK):**
    ```json
    {
      "status": "success",
      "sessions_seeded": 84,
      "users_seeded": 2,
      "rooms_mapped": 62,
      "sessions_created": 84,
      "sessions_updated": 0,
      "total_sessions": 84,
      "attendance_records_preserved": 0
    }
    ```

* **Refresh Schedule:**
  * **Endpoint:** `POST /api/schedule/refresh`
  * **Backend Logic:** Refreshes class sessions by re-scraping schedules and classrooms, upserting class sessions via deterministic session IDs without destroying attendance records or users.
  * **Response (200 OK):**
    ```json
    {
      "status": "success",
      "sessions_seeded": 84,
      "users_seeded": 2,
      "rooms_mapped": 62,
      "sessions_created": 0,
      "sessions_updated": 84,
      "total_sessions": 84,
      "attendance_records_preserved": 12
    }
    ```

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
