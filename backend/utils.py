from datetime import date, datetime, timedelta, timezone
import math
import os
from typing import Dict, Optional, Tuple
from zoneinfo import ZoneInfo

DEFAULT_CAMPUS_TIMEZONE = "Europe/Bucharest"

SPEC_MAP: Dict[str, str] = {
    "1": "M",
    "2": "I",
    "3": "MI",
    "4": "MM",
    "5": "IM",
    "6": "MIM",
    "7": "IG",
    "8": "MIE",
    "9": "IE",
    "10": "IA",
    "13": "II",
    "14": "IIM",
    "15": "MIDS",
    "16": "MIMDS",
}


class NonAcademicPeriodError(RuntimeError):
    """Raised when attempting to resolve an active UBB semester during July-September without an override."""


def resolve_academic_year(
    academic_year: Optional[int] = None,
    today: Optional[date] = None,
) -> int:
    """
    Resolve the UBB academic start year (e.g. 2026 for 2026-2027):
    - Explicit `academic_year` or `ACADEMIC_YEAR` env var takes precedence.
    - Oct-Dec -> `today.year`; Jan-Jun -> `today.year - 1`; Jul-Sep -> `today.year`.
    """
    if academic_year is not None:
        return academic_year

    env_year = os.getenv("ACADEMIC_YEAR", "").strip()
    if env_year:
        return int(env_year)

    current = today or datetime.now(get_campus_timezone()).date()
    return current.year - 1 if current.month <= 6 else current.year


def resolve_semester(
    semester: Optional[int] = None,
    today: Optional[date] = None,
) -> Optional[int]:
    """
    Resolve the UBB semester from `semester`, `ACADEMIC_SEMESTER` env var, or campus date:
    - Oct-Jan (months 10, 11, 12, 1) -> 1
    - Feb-Jun (months 2..6) -> 2
    - Jul-Sep (months 7..9) -> None (non-academic months)
    """
    if semester is not None:
        return semester

    env_semester = os.getenv("ACADEMIC_SEMESTER", "").strip()
    if env_semester:
        return int(env_semester)

    current = today or datetime.now(get_campus_timezone()).date()
    if current.month >= 10 or current.month == 1:
        return 1
    if 2 <= current.month <= 6:
        return 2
    return None


def is_academic_period(today: Optional[date] = None) -> bool:
    """Return True when `today` (or current campus date) falls in Semester 1 or 2."""
    return resolve_semester(today=today) is not None


def require_semester(
    semester: Optional[int] = None,
    today: Optional[date] = None,
) -> int:
    """Return active semester (1 or 2) or raise NonAcademicPeriodError during Jul-Sep."""
    resolved = resolve_semester(semester=semester, today=today)
    if resolved is None:
        raise NonAcademicPeriodError(
            "July, August, and September are outside the academic semesters "
            "(set ACADEMIC_SEMESTER=1 or 2 to override)."
        )
    return resolved


def parse_group_components(group: str) -> Dict[str, object]:
    """
    Split '933/1' or '1631/1' into semi_group, base_group, spec_code,
    year_digit, year_code ('IE3' / 'MIMDS3'), and is_known_spec.
    """
    cleaned = group.strip()
    base_group = cleaned.split("/")[0].strip()
    if len(base_group) >= 3 and base_group.isdigit():
        spec_code = base_group[:-2]
        year_digit = base_group[-2]
    elif len(base_group) >= 2:
        spec_code = base_group[0]
        year_digit = base_group[1]
    else:
        spec_code = base_group
        year_digit = ""

    known_prefix = SPEC_MAP.get(spec_code)
    prefix = known_prefix if known_prefix is not None else f"G{spec_code}"
    year_code = f"{prefix}{year_digit}" if year_digit else prefix
    return {
        "semi_group": cleaned,
        "base_group": base_group,
        "spec_code": spec_code,
        "year_digit": year_digit,
        "year_code": year_code,
        "is_known_spec": known_prefix is not None,
    }


def build_orar_base_url(
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    today: Optional[date] = None,
) -> str:
    """Build UBB's `{year}-{semester}` timetable base URL at call time."""
    override = os.getenv("UBB_ORAR_BASE_URL", "").strip().rstrip("/")
    if override:
        return override
    year = resolve_academic_year(academic_year, today=today)
    sem = require_semester(semester, today=today)
    return f"https://www.cs.ubbcluj.ro/files/orar/{year}-{sem}"


def build_student_schedule_url(
    year_code: str,
    base_url: Optional[str] = None,
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    today: Optional[date] = None,
) -> str:
    """Build the UBB tabular schedule URL for a year code (e.g. 'MIMDS3' -> '.../2026-1/tabelar/MIMDS3.html')."""
    configured_base = (base_url or os.getenv("STUDENT_SCHEDULE_BASE_URL", "")).strip().rstrip("/")
    if not configured_base:
        configured_base = f"{build_orar_base_url(academic_year=academic_year, semester=semester, today=today)}/tabelar"
    return f"{configured_base}/{year_code.strip()}.html"


def build_classrooms_url(
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    today: Optional[date] = None,
) -> str:
    """Build the UBB classroom legend URL (`.../sali/legenda.html`)."""
    return f"{build_orar_base_url(academic_year=academic_year, semester=semester, today=today)}/sali/legenda.html"


def build_teacher_schedule_url(
    teacher_code: str = "mogr1",
    academic_year: Optional[int] = None,
    semester: Optional[int] = None,
    today: Optional[date] = None,
) -> str:
    """Build the UBB teacher schedule URL (`.../cadre/<teacher_code>.html`)."""
    return (
        f"{build_orar_base_url(academic_year=academic_year, semester=semester, today=today)}"
        f"/cadre/{teacher_code.strip()}.html"
    )


def build_optionals_page_url(
    academic_year: Optional[int] = None,
    today: Optional[date] = None,
) -> str:
    """Build the UBB optional courses page URL (`...-{year}-{year + 1}/`)."""
    year = resolve_academic_year(academic_year, today=today)
    return (
        "https://www.cs.ubbcluj.ro/"
        f"lista-cursurilor-optionale-alese-pentru-anul-universitar-{year}-{year + 1}/"
    )


def get_campus_timezone() -> ZoneInfo:
    """Return the configured campus timezone (defaults to Europe/Bucharest)."""
    tz_name = os.getenv("CAMPUS_TIMEZONE", DEFAULT_CAMPUS_TIMEZONE).strip() or DEFAULT_CAMPUS_TIMEZONE
    return ZoneInfo(tz_name)


def ensure_utc(dt: datetime) -> datetime:
    """Attach UTC tzinfo when SQLite returns naive datetimes, or convert to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_campus_time(dt: datetime) -> datetime:
    """Convert a stored datetime (treating naive SQLite values as UTC) to campus local time."""
    return ensure_utc(dt).astimezone(get_campus_timezone())


def campus_day_window_utc(anchor_date: date, days: int = 1) -> Tuple[datetime, datetime]:
    """Return [start_utc, end_utc) covering `days` local calendar days from `anchor_date`."""
    campus_tz = get_campus_timezone()
    end_date = anchor_date + timedelta(days=days)
    start_local = datetime(anchor_date.year, anchor_date.month, anchor_date.day, 0, 0, tzinfo=campus_tz)
    end_local = datetime(end_date.year, end_date.month, end_date.day, 0, 0, tzinfo=campus_tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def calculate_distance(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    R = 6_371_000  # Earth's mean radius in metres

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c
