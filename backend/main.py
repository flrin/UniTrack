import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import (
    AttendanceRecord,
    CheckInPayload,
    ClassSession,
    StudentConfigPayload,
    StudentScheduleItem,
    User,
)
from scraper import refresh_schedule, seed_database

from utils import calculate_distance

Base.metadata.create_all(bind=engine)

app = FastAPI(title="UniTrack API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
    return authorization.removeprefix("Bearer ").strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SPEC_MAP = {"9": "IE", "2": "IR", "1": "MR", "4": "IG", "5": "MM", "6": "MI"}


def parse_group_components(group: str) -> dict:
    """Split '933/1' into semi_group, base_group ('933'), and year_code ('IE3')."""
    base_group = group.split("/")[0]
    spec_digit = base_group[0] if base_group else ""
    year_digit = base_group[1] if len(base_group) >= 2 else ""
    prefix = SPEC_MAP.get(spec_digit, f"G{spec_digit}")
    return {
        "semi_group": group,
        "base_group": base_group,
        "year_code": f"{prefix}{year_digit}",
    }


def fmt_time(dt: datetime) -> str:
    """Format a datetime as '10:00 AM' (no leading zero, cross-platform)."""
    return dt.strftime("%I:%M %p").lstrip("0") or "12:00 AM"


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
    return {"message": "Configuration saved"}


@app.get("/api/student/schedule", response_model=List[StudentScheduleItem])
def get_student_schedule(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Return the personalised class list for the authenticated student."""
    user: Optional[User] = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User '{user_id}' not found")
    if not user.group:
        return []

    c = parse_group_components(user.group)
    optionals: List[str] = user.optionals or []

    group_filter = or_(
        ClassSession.required_group == c["semi_group"],
        ClassSession.required_group == c["base_group"],
        ClassSession.required_group == c["year_code"],
    )
    if optionals:
        elective_filter = (ClassSession.is_optional == True) & ClassSession.subject.in_(optionals)
        combined_filter = or_(group_filter, elective_filter)
    else:
        combined_filter = group_filter

    sessions: List[ClassSession] = (
        db.query(ClassSession).filter(combined_filter).order_by(ClassSession.start_time).all()
    )

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
        result.append(
            StudentScheduleItem(
                class_id=session.id,
                subject=session.subject,
                time=f"{fmt_time(session.start_time)} - {fmt_time(session.end_time)}",
                building_name=session.building_name,
                target_lat=session.target_lat,
                target_lng=session.target_lng,
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
