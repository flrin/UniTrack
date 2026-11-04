import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, JSON, String
from pydantic import BaseModel, ConfigDict
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


# Pydantic Schemas
class StudentConfigPayload(BaseModel):
    group: str
    optionals: List[str] = []


class CheckInPayload(BaseModel):
    class_id: str
    user_lat: float
    user_lng: float


class StudentScheduleItem(BaseModel):
    class_id: str
    subject: str
    time: str
    building_name: str
    target_lat: float
    target_lng: float
    status: str = "Pending"


class ClassSessionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    subject: str
    start_time: datetime
    end_time: datetime
    building_name: str
    target_lat: float
    target_lng: float
    radius_meters: float = 100.0
    required_group: str
    is_optional: bool = False
    room: Optional[str] = None
    teacher_name: Optional[str] = None
    frequency: Optional[str] = None
    class_type: Optional[str] = None


class UserSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: str
    group: Optional[str] = None
    optionals: List[str] = []


class AttendanceRecordSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    class_session_id: str
    status: str
    check_in_time: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    override: bool = False
