from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class StudentConfigPayload(BaseModel):
    group: str = Field(..., pattern=r"^\d{3,4}/\d+$")
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
    room: Optional[str] = None
    class_type: Optional[str] = None
    target_lat: float
    target_lng: float
    start_time: datetime
    end_time: datetime
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
