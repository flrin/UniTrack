import io
import re
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import AttendanceRecord, ClassSession, User

DEFAULT_CLASSROOMS_URL = "https://www.cs.ubbcluj.ro/files/orar/2026-1/sali/legenda.html"
DEFAULT_STUDENT_SCHEDULE_URL = "https://www.cs.ubbcluj.ro/files/orar/2026-1/tabelar/IE3.html"
DEFAULT_TEACHER_SCHEDULE_URL = "https://www.cs.ubbcluj.ro/files/orar/2026-1/cadre/mogr1.html"
DEFAULT_OPTIONALS_PAGE_URL = "https://www.cs.ubbcluj.ro/lista-cursurilor-optionale-alese-pentru-anul-universitar-2026-2027/"

# Day mapping for Romanian schedule days (0 = Monday, ..., 4 = Friday)
RO_DAY_MAP = {
    "luni": 0,
    "marti": 1,
    "marți": 1,
    "miercuri": 2,
    "joi": 3,
    "vineri": 4,
    "sambata": 5,
    "sâmbătă": 5,
    "duminica": 6,
    "duminică": 6,
}

# Specialization digit mapping according to faculty group code conventions
SPECIALIZATION_CODE_MAP = {
    "1": "Matematica Romana",
    "2": "Informatica Romana",
    "3": "Matematica",
    "4": "Informatica Germana",
    "5": "Matematica Informatica Romana",
    "6": "Matematica Maghiara",
    "7": "Informatica Maghiara",
    "8": "Matematica Informatica Engleza",
    "9": "Informatica Engleza",
}


def get_building_coords(location_str: str) -> Tuple[float, float, str]:
    """Map a classroom location string to GPS coordinates (target_lat, target_lng) and building name."""
    loc = location_str.lower().strip()
    if not loc or "neprecizata" in loc or "virtual" in loc:
        # Default university coordinates
        return 46.7679, 23.5898, location_str or "Cladirea Centrala UBB"

    if "cantemir" in loc:
        # Exact building & coords from project README
        return 46.5743, 23.7841, "Univ Dimitrie Cantemir, etaj 5"
    if "fsega" in loc or "iot" in loc:
        return 46.7732, 23.6236, "Cladirea FSEGA"
    if "mathematica" in loc or "ploiesti" in loc:
        return 46.7766, 23.5938, "Cladirea Mathematica"
    if any(k in loc for k in ["ntt", "constanta", "socrate", "saturn", "platon"]):
        return 46.7745, 23.5930, "NTT Data"
    if "litere" in loc or "horea" in loc or any(k in loc for k in ["balzac", "cosbuc", "shakespeare"]):
        return 46.7801, 23.5857, "Facultatea de Litere"
    if "ciresilor" in loc or "observator" in loc:
        return 46.7584, 23.5907, "Observatorul Astronomic"
    if "avram iancu" in loc:
        return 46.7672, 23.5912, "Cladirea Avram Iancu"
    if "chimie" in loc or "arany" in loc:
        return 46.7663, 23.5828, "Facultatea de Chimie"
    if "sociologie" in loc or "saligny" in loc or "kulcsar" in loc:
        return 46.7725, 23.5985, "Facultatea de Sociologie"
    if "ioan bob" in loc:
        return 46.7690, 23.5880, "Scoala Gimnaziala Ioan Bob"
    if "codespring" in loc:
        return 46.7712, 23.6015, "Sediul Codespring"
    if "mhp" in loc:
        return 46.7710, 23.6020, "Sediul MHP"

    # Default to Central UBB building on Kogalniceanu
    return 46.7679, 23.5898, location_str or "Cladirea Centrala UBB"


def fetch_page_content(url: str, default_encoding: str = "utf-8") -> str:
    """Fetch URL with httpx, handling character encoding."""
    headers = {"User-Agent": "UniTrack-Scraper/1.0"}
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()

        # Some UBB pages are encoded in ISO-8859-2
        content_type = resp.headers.get("content-type", "").lower()
        if "iso-8859-2" in content_type:
            return resp.content.decode("iso-8859-2", errors="replace")
        try:
            return resp.content.decode("utf-8")
        except UnicodeDecodeError:
            return resp.content.decode("iso-8859-2", errors="replace")


# ---------------------------------------------------------------------------
# Issue #21: Parse Classrooms & Geocode
# ---------------------------------------------------------------------------
def scrape_classrooms(url: str = DEFAULT_CLASSROOMS_URL) -> Dict[str, Dict[str, Any]]:
    """Parse Legenda salilor table into a dictionary of room code -> coordinates & building name."""
    html = fetch_page_content(url)
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return {}

    rooms: Dict[str, Dict[str, Any]] = {}
    for tr in table.find_all("tr")[1:]:
        tds = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(tds) >= 2:
            room_code = tds[0]
            location_str = tds[1]
            lat, lng, bld = get_building_coords(location_str)
            rooms[room_code] = {
                "room": room_code,
                "building_name": location_str if location_str else bld,
                "target_lat": lat,
                "target_lng": lng,
            }
    return rooms


# ---------------------------------------------------------------------------
# Issue #22: Parse Teacher and Student HTML Schedules
# ---------------------------------------------------------------------------
def scrape_student_schedule(url: str = DEFAULT_STUDENT_SCHEDULE_URL) -> List[Dict[str, Any]]:
    """
    Parse student schedule HTML pages.
    Associates <h1>Grupa XXX</h1> headers with subsequent tables and extracts Formatia,
    identifying subgroup classes (e.g. 933/1 vs 933/2, base group 933, or IE3).
    """
    html = fetch_page_content(url)
    soup = BeautifulSoup(html, "html.parser")

    classes: List[Dict[str, Any]] = []
    current_group: Optional[str] = None

    # Walk all elements to properly link <h1> group headers to following tables
    for elem in soup.find_all(["h1", "table"]):
        if elem.name == "h1":
            text = elem.get_text(strip=True)
            match = re.search(r"Grupa\s+(\d+)", text, re.IGNORECASE)
            if match:
                current_group = match.group(1)
        elif elem.name == "table" and current_group:
            rows = elem.find_all("tr")
            if not rows:
                continue

            headers = [th.get_text(strip=True) for th in rows[0].find_all("th")]
            for tr in rows[1:]:
                tds = [td.get_text(strip=True) for td in tr.find_all("td")]
                if len(tds) < 7:
                    continue

                # Columns: Ziua, Orele, Frecventa, Sala, Formatia, Tipul, Disciplina, [Cadrul didactic]
                day = tds[0]
                hours = tds[1]
                frequency = tds[2] if len(tds) > 2 else ""
                room = tds[3] if len(tds) > 3 else ""
                formatia = tds[4] if len(tds) > 4 else current_group
                class_type = tds[5] if len(tds) > 5 else ""
                subject = tds[6] if len(tds) > 6 else ""
                teacher = tds[7] if len(tds) > 7 else ""

                classes.append(
                    {
                        "base_group": current_group,
                        "day": day,
                        "hours": hours,
                        "frequency": frequency,
                        "room": room,
                        "formatia": formatia,
                        "class_type": class_type,
                        "subject": subject,
                        "teacher": teacher,
                    }
                )

    return classes


def scrape_teacher_schedule(url: str = DEFAULT_TEACHER_SCHEDULE_URL) -> List[Dict[str, Any]]:
    """Parse teacher schedule HTML page. Extracts Ziua, Orele, Frecventa, Sala, Anul, Formatia, Tipul, Disciplina."""
    html = fetch_page_content(url)
    soup = BeautifulSoup(html, "html.parser")

    h1 = soup.find("h1")
    teacher_name = h1.get_text(strip=True).replace("Orar", "").strip() if h1 else ""

    table = soup.find("table")
    if not table:
        return []

    classes: List[Dict[str, Any]] = []
    rows = table.find_all("tr")
    for tr in rows[1:]:
        tds = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(tds) < 8:
            continue

        classes.append(
            {
                "teacher": teacher_name,
                "day": tds[0],
                "hours": tds[1],
                "frequency": tds[2],
                "room": tds[3],
                "year_info": tds[4],
                "formatia": tds[5],
                "class_type": tds[6],
                "subject": tds[7],
            }
        )
    return classes


# ---------------------------------------------------------------------------
# Issue #23: Scrape and Parse Optional Course PDFs
# ---------------------------------------------------------------------------
def scrape_optional_courses(
    page_url: str = DEFAULT_OPTIONALS_PAGE_URL,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Scrapes the optional courses page, downloads linked PDFs into memory,
    extracts elective subjects, and maps them to specialization digits (e.g. '9' for Informatica Engleza).
    """
    html = fetch_page_content(page_url)
    soup = BeautifulSoup(html, "html.parser")

    pdf_links: List[Tuple[str, str]] = []
    for td in soup.find_all("td", class_="lyf_td_filename"):
        a = td.find("a")
        if a and a.get("href"):
            pdf_links.append((a.get_text(strip=True), a["href"]))

    specialization_electives: Dict[str, List[Dict[str, Any]]] = {
        code: [] for code in SPECIALIZATION_CODE_MAP.keys()
    }

    headers = {"User-Agent": "UniTrack-Scraper/1.0"}
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for filename, pdf_url in pdf_links:
            # We focus primarily on undergraduate (licenta) course lists
            if "licenta" not in filename.lower():
                continue
            try:
                resp = client.get(pdf_url, headers=headers)
                resp.raise_for_status()
                reader = PdfReader(io.BytesIO(resp.content))
                full_text = "\n".join(page.extract_text() or "" for page in reader.pages)
            except Exception:
                continue

            current_spec_code = "9" if "informatica" in filename.lower() else "1"
            lines = full_text.splitlines()

            for line in lines:
                line_str = line.strip()
                if not line_str:
                    continue

                # Detect language section in PDF
                if "limba engleză" in line_str.lower() or "limba engleza" in line_str.lower():
                    current_spec_code = "9"  # Informatica Engleza
                elif "limba română" in line_str.lower() or "limba romana" in line_str.lower():
                    current_spec_code = "2"  # Informatica Romana
                elif "limba germană" in line_str.lower() or "limba germana" in line_str.lower():
                    current_spec_code = "4"  # Informatica Germana
                elif "limba maghiară" in line_str.lower() or "limba maghiara" in line_str.lower():
                    current_spec_code = "7"  # Informatica Maghiara

                # Match course code pattern e.g. MLE0049, MLR5067, MLX7101 followed by title
                match = re.match(r"^(ML[A-Z0-9]{5,7})\s+([^0-9]+?)(?:\s+\d+|$)", line_str)
                if match:
                    code, subject_raw = match.group(1), match.group(2).strip()
                    # Splitting bilingual titles "Nume Ro / Name En"
                    parts = [p.strip() for p in subject_raw.split("/") if p.strip()]
                    name_ro = parts[0] if len(parts) > 0 else subject_raw
                    name_en = parts[1] if len(parts) > 1 else name_ro

                    entry = {
                        "code": code,
                        "subject": name_ro,
                        "name_ro": name_ro,
                        "name_en": name_en,
                        "specialization_code": current_spec_code,
                    }
                    specialization_electives[current_spec_code].append(entry)

    return specialization_electives


# ---------------------------------------------------------------------------
# Issue #24: Data Normalization & Database Seeding
# ---------------------------------------------------------------------------
def normalize_time(
    day_ro: str, hours_str: str, reference_monday: Optional[date] = None
) -> Tuple[datetime, datetime, str]:
    """
    Normalizes 'Ziua' (e.g. 'Luni') and 'Orele' (e.g. '10-12') into standardized
    UTC datetime timestamps and display string (e.g. '10:00 AM - 12:00 PM').
    Reference Monday defaults to 2026-10-26 (matching the semester in README).
    """
    if reference_monday is None:
        # 2026-10-26 is Monday; Friday 2026-10-30 matches README example date
        reference_monday = date(2026, 10, 26)

    day_clean = day_ro.strip().lower()
    day_offset = RO_DAY_MAP.get(day_clean, 0)
    target_date = reference_monday + timedelta(days=day_offset)

    # Parse hours like "8-10", "10-12", "14-16"
    hours_match = re.search(r"(\d{1,2})\s*-\s*(\d{1,2})", hours_str)
    if hours_match:
        start_hour = int(hours_match.group(1))
        end_hour = int(hours_match.group(2))
    else:
        start_hour, end_hour = 8, 10

    start_dt = datetime(target_date.year, target_date.month, target_date.day, start_hour, 0, tzinfo=timezone.utc)
    end_dt = datetime(target_date.year, target_date.month, target_date.day, end_hour, 0, tzinfo=timezone.utc)

    # 12-hour formatted time display string (e.g. "10:00 AM - 12:00 PM")
    start_fmt = start_dt.strftime("%I:%M %p").lstrip("0")
    end_fmt = end_dt.strftime("%I:%M %p").lstrip("0")
    display_time = f"{start_fmt} - {end_fmt}"

    return start_dt, end_dt, display_time


def assemble_class_sessions(
    raw_classes: List[Dict[str, Any]],
    room_dict: Dict[str, Dict[str, Any]],
    optional_subjects_set: Set[str],
) -> List[Dict[str, Any]]:
    """Merge schedule entries with room coordinates and optional subject flags."""
    sessions = []
    seen = set()

    for item in raw_classes:
        subj = item["subject"].strip()
        day = item["day"]
        hours = item["hours"]
        room_code = item.get("room", "").strip()
        formatia = item.get("formatia", "").strip() or item.get("base_group", "").strip()

        start_dt, end_dt, _ = normalize_time(day, hours)

        # Geocode room
        room_info = room_dict.get(room_code)
        if room_info:
            bld_name = room_info["building_name"]
            lat = room_info["target_lat"]
            lng = room_info["target_lng"]
        else:
            lat, lng, bld_name = get_building_coords(room_code)

        # Check if this course is optional/elective
        is_opt = False
        subj_lower = subj.lower()
        for opt in optional_subjects_set:
            if opt in subj_lower or subj_lower in opt:
                is_opt = True
                break

        # Deduplicate identical sessions (e.g. lectures occurring for multiple subgroups in same room)
        dedup_key = (subj, start_dt.isoformat(), room_code, formatia)
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        session_dict = {
            "id": str(uuid.uuid4()),
            "subject": subj,
            "start_time": start_dt,
            "end_time": end_dt,
            "building_name": bld_name,
            "target_lat": lat,
            "target_lng": lng,
            "radius_meters": 100.0,
            "required_group": formatia,
            "is_optional": is_opt,
            "room": room_code,
            "teacher_name": item.get("teacher"),
            "frequency": item.get("frequency"),
            "class_type": item.get("class_type"),
        }
        sessions.append(session_dict)

    return sessions


def seed_database(
    db: Optional[Session] = None,
    student_schedule_url: str = DEFAULT_STUDENT_SCHEDULE_URL,
    classrooms_url: str = DEFAULT_CLASSROOMS_URL,
    optionals_url: str = DEFAULT_OPTIONALS_PAGE_URL,
) -> Dict[str, Any]:
    """Bulk-load scraped and normalized schedules and users into the database."""
    Base.metadata.create_all(bind=engine)
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True

    try:
        # 1. Scrape rooms
        rooms = scrape_classrooms(classrooms_url)

        # 2. Scrape optional courses
        try:
            electives = scrape_optional_courses(optionals_url)
            optional_names = {
                item["name_ro"].lower()
                for items in electives.values()
                for item in items
            } | {
                item["name_en"].lower()
                for items in electives.values()
                for item in items
            }
        except Exception:
            # Fallback if university PDF server is slow/unreachable
            optional_names = {
                "cloud computing",
                "machine learning",
                "arhitectura aplicatiilor cloud",
                "devops: automatizari in cloud",
                "calcul afectiv",
                "realitate virtuala",
                "roboti inteligenti",
            }

        # 3. Scrape student schedule
        raw_classes = scrape_student_schedule(student_schedule_url)

        # 4. Assemble sessions
        sessions_data = assemble_class_sessions(raw_classes, rooms, optional_names)

        # Clean existing records and bulk insert
        db.query(AttendanceRecord).delete()
        db.query(ClassSession).delete()
        db.add_all([ClassSession(**s) for s in sessions_data])

        # 5. Seed default test users if not present
        existing_user = db.query(User).filter_by(role="student").first()
        if not existing_user:
            # Matches README John Doe student fixture
            student_user = User(
                id=str(uuid.uuid4()),
                name="John Doe",
                role="student",
                group="933/1",
                optionals=["Cloud Computing", "Machine Learning", "Arhitectura aplicatiilor cloud"],
            )
            teacher_user = User(
                id=str(uuid.uuid4()),
                name="Grigoreta Cojocar",
                role="teacher",
                group="",
                optionals=[],
            )
            db.add(student_user)
            db.add(teacher_user)

        db.commit()

        total_sessions = db.query(ClassSession).count()
        total_users = db.query(User).count()
        return {
            "status": "success",
            "sessions_seeded": total_sessions,
            "users_seeded": total_users,
            "rooms_mapped": len(rooms),
        }
    except Exception:
        db.rollback()
        raise
    finally:
        if should_close:
            db.close()


if __name__ == "__main__":
    print("Starting UniTrack scraper pipeline...")
    result = seed_database()
    print("Scraping and seeding completed:", result)
