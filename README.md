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
venv\Scripts\activate
pip install "fastapi[standard]"
fastapi dev main.py
```

# 🤖 AI SYSTEM PROMPT & PROJECT CONTEXT
**ION AI AGENTS (Cursor, Copilot, Claude):** Read this entire document before generating code. Do not hallucinate API endpoints, data models, or tech stack choices. Stick strictly to the architecture, schemas, and contracts defined below.

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
*   **Backend:** FastAPI (Python), `uvicorn`.
*   **Scraping & Parsing:** `BeautifulSoup4` and `httpx` for HTML parsing, `pdfplumber` or `PyPDF2` for parsing optional course PDFs.
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
    ├── main.py         # Entry point and routes
    └── scraper.py      # HTML and PDF parsing logic

```

## Scraping Targets & Data Resolution

The `scraper.py` script must handle base schedules, room mappings, and optional (elective) courses using these official university endpoints as structural examples:

* **Group Code Logic:** A student's group dictates their specialization and year. For example, in group `933`: the first digit (`9`) represents the specialization (Informatica Engleza), the second digit (`3`) represents the year, and the third digit (`3`) represents the specific group.
* **Student Schedules:** `https://www.cs.ubbcluj.ro/files/orar/2026-1/tabelar/IE3.html`
* Contains multiple HTML tables grouped by subgroup headers (e.g., `<h1>Grupa 931</h1>`) to extract base classes and subgroup-specific labs (e.g., group `933/1` vs `933/2`).


* **Teacher Schedules:** `https://www.cs.ubbcluj.ro/files/orar/2026-1/cadre/mogr1.html`
* Data is housed in a table with columns: Ziua, Orele, Frecventa, Sala, Anul, Formatia, Tipul, Disciplina.


* **Classrooms Locations:** `https://www.cs.ubbcluj.ro/files/orar/2026-1/sali/legenda.html`
* HTML table mapping the shortcode `Sala` to the physical `Localizarea`.


* **Optional Courses (Electives):** `https://www.cs.ubbcluj.ro/lista-cursurilor-optionale-alese-pentru-anul-universitar-2026-2027/`
* The scraper must navigate to this page, target the `<td class="lyf_td_filename">` elements, and extract the `<a>` tag `href` links pointing to the PDF files for each department. The backend downloads these PDFs, parses the text to extract the elective subjects, and maps them to the respective specializations determined by the group code digit.



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
  "required_group": "933",     // Can be base group ("933"), semi-group ("933/1"), or "optional"
  "is_optional": false
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
* **Backend Logic:** Return classes where `required_group` matches the user's full semi-group (`933/1`), their base group (`933`), the entire year/specialization (`IE3`), AND any `is_optional` classes that match the strings in their `optionals` array.
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

## AI Development Directives

1. **Parallel Execution:** Frontend components MUST be built using mock JSON objects based on the API Contracts above before wiring up the real HTTP fetches.
2. **No Extraneous Features:** Do not write code for background location tracking plugins, GPS spoofing prevention, or advanced caching. Follow the MVP scope exactly.
3. **Automated Heartbeat Logic (Critical):** There are NO "Check In" or "Start Class" buttons on the student UI. The frontend must automatically check the current device time against the scheduled `start_time` and `end_time` of the student's classes. When an active class window is reached, automatically initiate the 60-second `setInterval` GPS heartbeat.
4. **UX Constraints:** The student UI MUST include a permanent, highly visible warning advising them NOT to lock their screen or close the tab while the class is active.

