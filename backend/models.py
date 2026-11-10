import uuid
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, JSON, String
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    role = Column(String, nullable=False, default="student")
    group = Column(String, nullable=True)  # e.g., "933/1"
    optionals = Column(JSON, default=list)  # list of chosen elective subject names


class ClassSession(Base):
    __tablename__ = "class_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    subject = Column(String, nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    building_name = Column(String, nullable=False)
    target_lat = Column(Float, nullable=False)
    target_lng = Column(Float, nullable=False)
    radius_meters = Column(Float, default=100.0)
    required_group = Column(String, nullable=False)  # "933", "933/1", "IE3", etc.
    is_optional = Column(Boolean, default=False)
    room = Column(String, nullable=True)
    teacher_name = Column(String, nullable=True)
    frequency = Column(String, nullable=True)  # "sapt. 1", "sapt. 2", ""
    class_type = Column(String, nullable=True)  # "Curs", "Laborator", "Seminar"


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    class_session_id = Column(String, ForeignKey("class_sessions.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, default="Pending")  # "Pending", "Present", "Left Early"
    check_in_time = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    override = Column(Boolean, default=False)
