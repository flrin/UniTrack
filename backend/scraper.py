import io
import os
import re
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import AttendanceRecord, ClassSession, User
from utils import (
    SPEC_MAP,
    build_classrooms_url,
    build_optionals_page_url,
    build_student_schedule_url,
    build_teacher_schedule_url,
    get_campus_timezone,
    parse_group_components,
    resolve_academic_year,
    resolve_semester,
)

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
    "10": "Inteligenta Artificiala",
    "13": "Ingineria Informatiei",
    "14": "Ingineria Informatiei Maghiara",
    "15": "Matematica Informatica Data Science",
    "16": "Matematica Informatica Data Science Maghiara",
}


_GEOCODE_CACHE: Dict[str, Tuple[float, float, str]] = {}
_ROOMS_CACHE: Dict[str, Dict[str, Dict[str, Any]]] = {}
_OPTIONALS_CACHE: Dict[str, Set[str]] = {}
_FALLBACK_OPTIONAL_NAMES: Set[str] = {
    "cloud computing",
    "machine learning",
    "arhitectura aplicatiilor cloud",
    "devops: automatizari in cloud",
    "calcul afectiv",
    "realitate virtuala",
    "roboti inteligenti",
}


def get_building_coords(
    location_str: str, api_key: Optional[str] = None
) -> Tuple[float, float, str]:
    """
    Map a classroom location string to GPS coordinates (target_lat, target_lng) and building name.
    Retrieves coordinates primarily via Google Maps Geocoding API if an API key is available,
    falling back to known campus building coordinates.
    """
    loc = location_str.lower().strip()
    if not loc or "neprecizata" in loc or "virtual" in loc:
        # Default university coordinates
        return 46.7679, 23.5898, location_str or "Cladirea Centrala UBB"

    if location_str in _GEOCODE_CACHE:
        return _GEOCODE_CACHE[location_str]

    # Primary method: Google Maps Geocoding API
    gmaps_key = (
        api_key
        or os.getenv("GOOGLE_MAPS_API_KEY")
        or os.getenv("GOOGLE_GEOCODING_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
    )
    if gmaps_key:
        try:
            address_query = location_str
            if "cluj" not in address_query.lower():
                address_query = f"{address_query}, Cluj-Napoca, Romania"
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    params={"address": address_query, "key": gmaps_key},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("status") == "OK" and data.get("results"):
                        res = data["results"][0]
                        lat = float(res["geometry"]["location"]["lat"])
                        lng = float(res["geometry"]["location"]["lng"])
                        bld = res.get("formatted_address") or location_str
                        result = (lat, lng, bld)
                        _GEOCODE_CACHE[location_str] = result
                        return result
        except Exception:
            pass  # Fall back to hardcoded campus building coordinates

    # Fallback coordinates for known faculty locations
    if "cantemir" in loc:
        # Exact building & coords from project README
        coords = (46.5743, 23.7841, "Univ Dimitrie Cantemir, etaj 5")
    elif "fsega" in loc or "iot" in loc:
        coords = (46.7732, 23.6236, "Cladirea FSEGA")
    elif "mathematica" in loc or "ploiesti" in loc:
        coords = (46.7766, 23.5938, "Cladirea Mathematica")
    elif any(k in loc for k in ["ntt", "constanta", "socrate", "saturn", "platon"]):
        coords = (46.7745, 23.5930, "NTT Data")
    elif "litere" in loc or "horea" in loc or any(k in loc for k in ["balzac", "cosbuc", "shakespeare"]):
        coords = (46.7801, 23.5857, "Facultatea de Litere")
    elif "ciresilor" in loc or "observator" in loc:
        coords = (46.7584, 23.5907, "Observatorul Astronomic")
    elif "avram iancu" in loc:
        coords = (46.7672, 23.5912, "Cladirea Avram Iancu")
    elif "chimie" in loc or "arany" in loc:
        coords = (46.7663, 23.5828, "Facultatea de Chimie")
    elif "sociologie" in loc or "saligny" in loc or "kulcsar" in loc:
        coords = (46.7725, 23.5985, "Facultatea de Sociologie")
    elif "ioan bob" in loc:
        coords = (46.7690, 23.5880, "Scoala Gimnaziala Ioan Bob")
    elif "codespring" in loc:
        coords = (46.7712, 23.6015, "Sediul Codespring")
    elif "mhp" in loc:
        coords = (46.7710, 23.6020, "Sediul MHP")
    else:
        # Default to Central UBB building on Kogalniceanu
        coords = (46.7679, 23.5898, location_str or "Cladirea Centrala UBB")

    _GEOCODE_CACHE[location_str] = coords
    return coords


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
def scrape_classrooms(
    url: Optional[str] = None,
    api_key: Optional[str] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
) -> Dict[str, Dict[str, Any]]:
    """Parse Legenda salilor table into a dictionary of room code -> coordinates & building name."""
    target_url = url or build_classrooms_url(academic_year=academic_year, semester=semester)
    html = fetch_page_content(target_url)
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
            lat, lng, bld = get_building_coords(location_str, api_key=api_key)
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
def scrape_student_schedule(
    url: Optional[str] = None,
    year_code: str = "IE3",
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Parse student schedule HTML pages.
    Associates <h1>Grupa XXX</h1> headers with subsequent tables and extracts Formatia,
    identifying subgroup classes (e.g. 933/1 vs 933/2, base group 933, or IE3).
    """
    target_url = url or build_student_schedule_url(
        year_code, academic_year=academic_year, semester=semester
    )
    html = fetch_page_content(target_url)
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


def scrape_teacher_schedule(
    url: Optional[str] = None,
    teacher_code: str = "mogr1",
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Parse teacher schedule HTML page. Extracts Ziua, Orele, Frecventa, Sala, Anul, Formatia, Tipul, Disciplina."""
    target_url = url or build_teacher_schedule_url(
        teacher_code=teacher_code, academic_year=academic_year, semester=semester
    )
    html = fetch_page_content(target_url)
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
    page_url: Optional[str] = None,
    academic_year: Optional[int] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Scrapes the optional courses page, downloads linked PDFs into memory,
    extracts elective subjects, and maps them to specialization digits (e.g. '9' for Informatica Engleza).
    """
    target_url = page_url or build_optionals_page_url(academic_year=academic_year)
    html = fetch_page_content(target_url)
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
DEFAULT_SEMESTER_WEEKS = int(os.getenv("SEMESTER_WEEKS", "14"))


def get_semester_weeks(weeks: Optional[int] = None) -> int:
    """Return configured number of teaching weeks in the semester (minimum 1)."""
    count = (
        weeks
        if weeks is not None
        else int(os.getenv("SEMESTER_WEEKS", str(DEFAULT_SEMESTER_WEEKS)))
    )
    return max(1, count)


def should_schedule_in_week(frequency: Optional[str], teaching_week: int) -> bool:
    """Evaluate UBB frequency ('sapt. 1', 'sapt. 2', or '') against 1-based teaching week."""
    freq = (frequency or "").strip().lower()
    if not freq:
        return True
    if re.search(r"\b1\b", freq) or "impar" in freq:
        return teaching_week % 2 == 1
    if re.search(r"\b2\b", freq) or re.search(r"\bpar\b", freq):
        return teaching_week % 2 == 0
    return True


def get_first_semester_monday(academic_year: Optional[int] = None) -> date:
    """
    Returns the Monday of the first semester week.
    The first semester week is defined as the Monday-Sunday week containing October 1.
    """
    year = resolve_academic_year(academic_year)
    oct1 = date(year, 10, 1)
    return oct1 - timedelta(days=oct1.weekday())


def normalize_time(
    day_ro: str,
    hours_str: str,
    reference_monday: Optional[date] = None,
    academic_year: Optional[int] = None,
) -> Tuple[datetime, datetime, str]:
    """
    Normalizes 'Ziua' (e.g. 'Luni') and 'Orele' (e.g. '10-12') in campus local time
    into standardized UTC datetime timestamps and a local display string
    (e.g. '10:00 AM - 12:00 PM').
    Dates are relative to `reference_monday` (default: first semester week Monday).
    """
    if reference_monday is None:
        reference_monday = get_first_semester_monday(academic_year)

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

    campus_tz = get_campus_timezone()
    start_local = datetime(target_date.year, target_date.month, target_date.day, start_hour, 0, tzinfo=campus_tz)
    end_local = datetime(target_date.year, target_date.month, target_date.day, end_hour, 0, tzinfo=campus_tz)

    start_dt = start_local.astimezone(timezone.utc)
    end_dt = end_local.astimezone(timezone.utc)

    # 12-hour formatted time display string in campus local time (e.g. "10:00 AM - 12:00 PM")
    start_fmt = start_local.strftime("%I:%M %p").lstrip("0")
    end_fmt = end_local.strftime("%I:%M %p").lstrip("0")
    display_time = f"{start_fmt} - {end_fmt}"

    return start_dt, end_dt, display_time


def assemble_class_sessions(
    raw_classes: List[Dict[str, Any]],
    room_dict: Dict[str, Dict[str, Any]],
    optional_subjects_set: Set[str],
    reference_monday: Optional[date] = None,
    academic_year: Optional[int] = None,
    weeks: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Expand timetable entries across semester weeks with room coords and optional flags."""
    if reference_monday is None:
        reference_monday = get_first_semester_monday(academic_year)

    total_weeks = get_semester_weeks(weeks)
    teaching_weeks = [
        (week, reference_monday + timedelta(weeks=week - 1))
        for week in range(1, total_weeks + 1)
    ]

    sessions = []
    seen = set()

    for item in raw_classes:
        subj = item["subject"].strip()
        day = item["day"]
        hours = item["hours"]
        frequency = item.get("frequency")
        room_code = item.get("room", "").strip()
        formatia = item.get("formatia", "").strip() or item.get("base_group", "").strip()

        # Geocode room once per timetable entry
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

        for teaching_week, week_monday in teaching_weeks:
            if not should_schedule_in_week(frequency, teaching_week):
                continue

            start_dt, end_dt, _ = normalize_time(
                day, hours, reference_monday=week_monday, academic_year=academic_year
            )

            # Deduplicate identical occurrences (e.g. lectures for multiple subgroups in same room)
            dedup_key = (subj, start_dt.isoformat(), room_code, formatia)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            session_key = f"{subj}:{start_dt.isoformat()}:{formatia}:{room_code}"
            session_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, session_key))

            sessions.append(
                {
                    "id": session_id,
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
                    "frequency": frequency,
                    "class_type": item.get("class_type"),
                }
            )

    return sessions


def _get_rooms_and_optionals(
    classrooms_url: Optional[str] = None,
    optionals_url: Optional[str] = None,
    api_key: Optional[str] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    force_refresh: bool = False,
) -> Tuple[Dict[str, Dict[str, Any]], Set[str]]:
    resolved_classrooms_url = classrooms_url or build_classrooms_url(
        academic_year=academic_year, semester=semester
    )
    resolved_optionals_url = optionals_url or build_optionals_page_url(
        academic_year=academic_year
    )

    if force_refresh or resolved_classrooms_url not in _ROOMS_CACHE:
        _ROOMS_CACHE[resolved_classrooms_url] = scrape_classrooms(
            resolved_classrooms_url, api_key=api_key
        )

    if force_refresh or resolved_optionals_url not in _OPTIONALS_CACHE:
        try:
            electives = scrape_optional_courses(resolved_optionals_url)
            _OPTIONALS_CACHE[resolved_optionals_url] = {
                item["name_ro"].lower()
                for items in electives.values()
                for item in items
            } | {
                item["name_en"].lower()
                for items in electives.values()
                for item in items
            }
        except Exception:
            _OPTIONALS_CACHE[resolved_optionals_url] = set(_FALLBACK_OPTIONAL_NAMES)

    return _ROOMS_CACHE[resolved_classrooms_url], _OPTIONALS_CACHE[resolved_optionals_url]


def _upsert_sessions(
    db: Session,
    sessions_data: List[Dict[str, Any]],
    prune_stale: bool = False,
) -> Tuple[int, int, int]:
    """Upsert sessions by deterministic ID, optionally pruning unreferenced stale sessions."""
    if prune_stale:
        existing_by_id = {s.id: s for s in db.query(ClassSession).all()}
    else:
        ids = [s["id"] for s in sessions_data]
        existing_by_id = (
            {s.id: s for s in db.query(ClassSession).filter(ClassSession.id.in_(ids)).all()}
            if ids
            else {}
        )

    new_ids = {s["id"] for s in sessions_data}
    created_count = 0
    updated_count = 0
    deleted_count = 0

    for s_dict in sessions_data:
        s_id = s_dict["id"]
        existing_session = existing_by_id.get(s_id)
        if existing_session:
            for key, val in s_dict.items():
                if key != "id":
                    setattr(existing_session, key, val)
            updated_count += 1
        else:
            db.add(ClassSession(**s_dict))
            created_count += 1

    if prune_stale:
        referenced_ids = {
            row[0] for row in db.query(AttendanceRecord.class_session_id).distinct().all()
        }
        for old_id, old_session in existing_by_id.items():
            if old_id not in new_ids and old_id not in referenced_ids:
                db.delete(old_session)
                deleted_count += 1

    return created_count, updated_count, deleted_count


def _resolve_year_code_and_prefix(group_or_year_code: str) -> Tuple[Optional[str], Optional[str]]:
    cleaned = group_or_year_code.strip()
    if not cleaned:
        return None, None

    if cleaned[0].isdigit():
        parsed = parse_group_components(cleaned)
        year_digit = str(parsed["year_digit"])
        if not parsed["is_known_spec"] or year_digit not in {"1", "2", "3", "4"}:
            return None, None
        return str(parsed["year_code"]), f"{parsed['spec_code']}{year_digit}"

    known_prefixes = set(SPEC_MAP.values())
    match = re.match(r"^([A-Za-z]+)([1-4])$", cleaned)
    if match and match.group(1) in known_prefixes:
        return cleaned, None
    return None, None


def ensure_year_code_loaded(
    db: Session,
    group_or_year_code: str,
    classrooms_url: Optional[str] = None,
    optionals_url: Optional[str] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    api_key: Optional[str] = None,
    weeks: Optional[int] = None,
) -> bool:
    """
    Scrape and upsert timetable sessions for `group_or_year_code` on demand
    (e.g., '1631/1' -> '.../{year}-{semester}/tabelar/MIMDS3.html') if not already present in `db`.
    """
    year_code, base_prefix = _resolve_year_code_and_prefix(group_or_year_code)
    if not year_code:
        return False

    has_url_override = bool(
        os.getenv("STUDENT_SCHEDULE_BASE_URL", "").strip()
        or os.getenv("UBB_ORAR_BASE_URL", "").strip()
    )
    if not has_url_override and resolve_semester(semester) is None:
        return False

    filters = [ClassSession.required_group == year_code]
    if base_prefix:
        filters.extend(
            [
                ClassSession.required_group.like(f"{base_prefix}_"),
                ClassSession.required_group.like(f"{base_prefix}_/%"),
            ]
        )
    if db.query(ClassSession.id).filter(or_(*filters)).first() is not None:
        return False

    url = build_student_schedule_url(
        year_code, academic_year=academic_year, semester=semester
    )
    try:
        raw_classes = scrape_student_schedule(url)
    except httpx.HTTPError:
        return False

    if not raw_classes:
        return False

    rooms, optional_names = _get_rooms_and_optionals(
        classrooms_url=classrooms_url,
        optionals_url=optionals_url,
        api_key=api_key,
        academic_year=academic_year,
        semester=semester,
        force_refresh=False,
    )
    sessions_data = assemble_class_sessions(
        raw_classes,
        rooms,
        optional_names,
        academic_year=academic_year,
        weeks=weeks,
    )
    if not sessions_data:
        return False

    _upsert_sessions(db, sessions_data, prune_stale=False)
    db.commit()
    return True


def _collect_schedule_urls(
    db: Session,
    student_schedule_url: Optional[str] = None,
    year_codes: Optional[List[str]] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
) -> List[str]:
    if student_schedule_url is not None:
        return [student_schedule_url]

    codes: Set[str] = set()
    if year_codes:
        codes.update(year_codes)
    else:
        for (group,) in db.query(User.group).filter(User.role == "student").all():
            if group:
                yc, _ = _resolve_year_code_and_prefix(group)
                if yc:
                    codes.add(yc)
        known_prefixes = set(SPEC_MAP.values())
        for (req_group,) in db.query(ClassSession.required_group).distinct().all():
            if req_group:
                m = re.match(r"^([A-Za-z]+)([1-4])$", req_group)
                if m and m.group(1) in known_prefixes:
                    codes.add(req_group)
        if not codes:
            codes.add("IE3")

    return [
        build_student_schedule_url(yc, academic_year=academic_year, semester=semester)
        for yc in sorted(codes)
    ]


def refresh_schedule(
    db: Optional[Session] = None,
    student_schedule_url: Optional[str] = None,
    classrooms_url: Optional[str] = None,
    optionals_url: Optional[str] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    api_key: Optional[str] = None,
    weeks: Optional[int] = None,
    year_codes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Refreshes the schedule by scraping current schedules and classrooms,
    upserting class sessions across semester weeks without destroying attendance records or users.
    """
    Base.metadata.create_all(bind=engine)
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True

    try:
        has_url_override = bool(
            student_schedule_url
            or os.getenv("STUDENT_SCHEDULE_BASE_URL", "").strip()
            or os.getenv("UBB_ORAR_BASE_URL", "").strip()
        )
        if not has_url_override and resolve_semester(semester) is None:
            return {
                "status": "skipped",
                "reason": "non-academic period (Jul-Sep)",
                "sessions_seeded": db.query(ClassSession).count(),
                "users_seeded": db.query(User).count(),
                "rooms_mapped": 0,
                "sessions_created": 0,
                "sessions_updated": 0,
                "sessions_deleted": 0,
                "total_sessions": db.query(ClassSession).count(),
                "attendance_records_preserved": db.query(AttendanceRecord).count(),
            }

        # 1 & 2. Scrape and cache rooms and optional courses
        rooms, optional_names = _get_rooms_and_optionals(
            classrooms_url=classrooms_url,
            optionals_url=optionals_url,
            api_key=api_key,
            academic_year=academic_year,
            semester=semester,
            force_refresh=True,
        )

        # 3. Scrape student schedule(s) dynamically by year code
        urls = _collect_schedule_urls(
            db,
            student_schedule_url=student_schedule_url,
            year_codes=year_codes,
            academic_year=academic_year,
            semester=semester,
        )
        raw_classes: List[Dict[str, Any]] = []
        for url in urls:
            try:
                raw_classes.extend(scrape_student_schedule(url))
            except httpx.HTTPError:
                if student_schedule_url is not None or len(urls) == 1:
                    raise

        # 4. Assemble sessions across the configured semester weeks
        sessions_data = assemble_class_sessions(
            raw_classes,
            rooms,
            optional_names,
            academic_year=academic_year,
            weeks=weeks,
        )

        # 5. Upsert class sessions and prune obsolete unreferenced sessions without touching attendance
        created_count, updated_count, deleted_count = _upsert_sessions(
            db, sessions_data, prune_stale=True
        )

        # 6. Seed default test users if not present
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
        attendance_count = db.query(AttendanceRecord).count()

        return {
            "status": "success",
            "sessions_seeded": total_sessions,
            "users_seeded": total_users,
            "rooms_mapped": len(rooms),
            "sessions_created": created_count,
            "sessions_updated": updated_count,
            "sessions_deleted": deleted_count,
            "total_sessions": total_sessions,
            "attendance_records_preserved": attendance_count,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        if should_close:
            db.close()


def seed_database(
    db: Optional[Session] = None,
    student_schedule_url: Optional[str] = None,
    classrooms_url: Optional[str] = None,
    optionals_url: Optional[str] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    api_key: Optional[str] = None,
    weeks: Optional[int] = None,
    year_codes: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Bulk-load scraped and normalized schedules and users into the database without destroying attendance data."""
    return refresh_schedule(
        db=db,
        student_schedule_url=student_schedule_url,
        classrooms_url=classrooms_url,
        optionals_url=optionals_url,
        academic_year=academic_year,
        semester=semester,
        api_key=api_key,
        weeks=weeks,
        year_codes=year_codes,
    )


if __name__ == "__main__":
    print("Starting UniTrack scraper pipeline...")
    result = seed_database()
    print("Scraping and seeding completed:", result)
