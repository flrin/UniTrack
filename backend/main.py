import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import AttendanceRecord, ClassSession, User
from schemas import CheckInPayload, StudentConfigPayload, StudentScheduleItem
from scraper import ensure_year_code_loaded, refresh_schedule, seed_database

from utils import (
    SPEC_MAP,
    calculate_distance,
    campus_day_window_utc,
    ensure_utc,
    get_campus_timezone,
    parse_group_components,
    to_campus_time,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="UniTrack API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

# TODO: Replace with real JWT verification once Developer 1's auth module is merged.
# For now, treats the raw Bearer token value as the user's UUID.
def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    user_id = authorization.removeprefix("Bearer ").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    return user_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _group_filter_for(group: str):
    """Build SQLAlchemy filter matching a group's semi-group, base group, and year code."""
    c = parse_group_components(group)
    if "/" in group:
        return or_(
            ClassSession.required_group == c["semi_group"],
            ClassSession.required_group == c["base_group"],
            ClassSession.required_group == c["year_code"],
        )
    return or_(
        ClassSession.required_group == c["base_group"],
        ClassSession.required_group.like(f"{c['base_group']}/%"),
        ClassSession.required_group == c["year_code"],
    )


def fmt_time(dt: datetime) -> str:
    """Format a datetime in campus local time as '10:00 AM' (no leading zero)."""
    local_dt = to_campus_time(dt)
    return local_dt.strftime("%I:%M %p").lstrip("0") or "12:00 AM"


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Ingestion (Developer 1)
# ---------------------------------------------------------------------------

@app.post("/api/seed")
def trigger_seed(db: Session = Depends(get_db)):
    """Trigger the scraper and database seeding pipeline on demand."""
    result = seed_database(db=db)
    return result


@app.post("/api/schedule/refresh")
def trigger_refresh_schedule(db: Session = Depends(get_db)):
    """Refresh the schedule without destroying attendance data."""
    result = refresh_schedule(db=db)
    return result


# ---------------------------------------------------------------------------
# Student endpoints (Developer 2)
# ---------------------------------------------------------------------------

@app.get("/api/student/optionals", response_model=List[str])
def get_optional_courses(
    group: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return distinct optional course names available for selection."""
    trimmed_group = group.strip() if group else ""
    if trimmed_group:
        ensure_year_code_loaded(db, trimmed_group)

    query = db.query(ClassSession.subject).filter(ClassSession.is_optional == True)
    if trimmed_group:
        query = query.filter(
            or_(_group_filter_for(trimmed_group), ClassSession.required_group == "optional")
        )
    rows = query.distinct().order_by(ClassSession.subject).all()
    return [row[0] for row in rows]


@app.put("/api/student/config")
def update_student_config(
    payload: StudentConfigPayload,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Save the student's subgroup and chosen electives."""
    user: Optional[User] = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can update their configuration")

    user.group = payload.group
    user.optionals = payload.optionals
    db.add(user)
    db.commit()
    db.refresh(user)
    ensure_year_code_loaded(db, payload.group)
    return {"message": "Configuration saved"}


@app.get("/api/student/schedule", response_model=List[StudentScheduleItem])
def get_student_schedule(
    target_date: Optional[date] = Query(None, alias="date"),
    days: Optional[int] = Query(None, ge=1, le=365),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Return the personalised class list for the authenticated student."""
    user: Optional[User] = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")
    if not user.group:
        return []

    ensure_year_code_loaded(db, user.group)
    optionals: List[str] = user.optionals or []

    group_filter = _group_filter_for(user.group)
    mandatory_filter = (ClassSession.is_optional == False) & group_filter
    if optionals:
        elective_scope = or_(group_filter, ClassSession.required_group == "optional")
        elective_filter = (
            (ClassSession.is_optional == True)
            & ClassSession.subject.in_(optionals)
            & elective_scope
        )
        combined_filter = or_(mandatory_filter, elective_filter)
    else:
        combined_filter = mandatory_filter

    query = db.query(ClassSession).filter(combined_filter)
    if target_date is not None or days is not None:
        anchor = target_date or datetime.now(get_campus_timezone()).date()
        window_start, window_end = campus_day_window_utc(anchor, days=days if days is not None else 1)
        query = query.filter(
            ClassSession.start_time >= window_start,
            ClassSession.start_time < window_end,
        )

    sessions: List[ClassSession] = query.order_by(ClassSession.start_time).all()

    result: List[StudentScheduleItem] = []
    for session in sessions:
        record: Optional[AttendanceRecord] = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.user_id == user_id,
                AttendanceRecord.class_session_id == session.id,
            )
            .first()
        )
        start_time = ensure_utc(session.start_time)
        end_time = ensure_utc(session.end_time)
        room = session.room.strip() if session.room and session.room.strip() else None
        class_type = (
            session.class_type.strip()
            if session.class_type and session.class_type.strip()
            else None
        )
        result.append(
            StudentScheduleItem(
                class_id=session.id,
                subject=session.subject,
                time=f"{fmt_time(start_time)} - {fmt_time(end_time)}",
                building_name=session.building_name,
                room=room,
                class_type=class_type,
                target_lat=session.target_lat,
                target_lng=session.target_lng,
                start_time=start_time,
                end_time=end_time,
                status=record.status if record else "Pending",
            )
        )
    return result


@app.post("/api/student/checkin")
def student_checkin(
    payload: CheckInPayload,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Process a 60-second GPS heartbeat and upsert the attendance record."""
    user: Optional[User] = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")

    session: Optional[ClassSession] = db.get(ClassSession, payload.class_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"ClassSession '{payload.class_id}' not found")

    distance_m = calculate_distance(
        payload.user_lat, payload.user_lng,
        session.target_lat, session.target_lng,
    )
    new_status = "Present" if distance_m <= session.radius_meters else "Left Early"
    now = datetime.now(tz=timezone.utc)

    record: Optional[AttendanceRecord] = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.user_id == user_id,
            AttendanceRecord.class_session_id == payload.class_id,
        )
        .first()
    )

    if record is None:
        record = AttendanceRecord(
            id=str(uuid.uuid4()),
            user_id=user_id,
            class_session_id=payload.class_id,
            status=new_status,
            check_in_time=now,
            last_seen_at=now,
            override=False,
        )
        db.add(record)
    else:
        record.last_seen_at = now
        if not record.override:
            record.status = new_status
        db.add(record)

    db.commit()
    db.refresh(record)
    return {"status": record.status, "distance_meters": round(distance_m, 2)}
