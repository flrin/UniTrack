import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models import AttendanceRecord, ClassSession, User


class TestStudentApi(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.SessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=self.engine
        )
        Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        db = self.SessionLocal()
        try:
            db.add_all(
                [
                    User(
                        id="student-1",
                        name="John Doe",
                        role="student",
                        group="933/1",
                        optionals=["Cloud Computing"],
                    ),
                    User(
                        id="teacher-1",
                        name="Grigoreta Cojocar",
                        role="teacher",
                        group="",
                        optionals=[],
                    ),
                    ClassSession(
                        id="cls-sub",
                        subject="Interactiunea om-calculator",
                        start_time=datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc),
                        building_name="Univ Dimitrie Cantemir, etaj 5",
                        room="DC508",
                        class_type="Laborator",
                        target_lat=46.5743,
                        target_lng=23.7841,
                        radius_meters=100.0,
                        required_group="933/1",
                        is_optional=False,
                    ),
                    ClassSession(
                        id="cls-opt",
                        subject="Cloud Computing",
                        start_time=datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc),
                        building_name="Cladirea FSEGA",
                        target_lat=46.7732,
                        target_lng=23.6236,
                        radius_meters=100.0,
                        required_group="optional",
                        is_optional=True,
                    ),
                    ClassSession(
                        id="cls-next-week",
                        subject="Machine Learning",
                        start_time=datetime(2026, 11, 17, 8, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 17, 10, 0, tzinfo=timezone.utc),
                        building_name="Cladirea FSEGA",
                        room="L402",
                        target_lat=46.7732,
                        target_lng=23.6236,
                        radius_meters=100.0,
                        required_group="933/1",
                        is_optional=False,
                    ),
                    ClassSession(
                        id="cls-other-sub",
                        subject="Other Subgroup Lab",
                        start_time=datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 10, 10, 0, tzinfo=timezone.utc),
                        building_name="Cladirea Centrala UBB",
                        target_lat=46.7679,
                        target_lng=23.5898,
                        radius_meters=100.0,
                        required_group="933/2",
                        is_optional=False,
                    ),
                    ClassSession(
                        id="cls-unchecked-ie3-opt",
                        subject="Roboti inteligenti",
                        start_time=datetime(2026, 11, 10, 14, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 10, 16, 0, tzinfo=timezone.utc),
                        building_name="Cladirea FSEGA",
                        target_lat=46.7732,
                        target_lng=23.6236,
                        radius_meters=100.0,
                        required_group="IE3",
                        is_optional=True,
                    ),
                    ClassSession(
                        id="cls-opt-other-sub",
                        subject="Cloud Computing",
                        start_time=datetime(2026, 11, 10, 14, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 10, 16, 0, tzinfo=timezone.utc),
                        building_name="Cladirea FSEGA",
                        target_lat=46.7732,
                        target_lng=23.6236,
                        radius_meters=100.0,
                        required_group="933/2",
                        is_optional=True,
                    ),
                    ClassSession(
                        id="cls-opt-other-spec",
                        subject="Other Spec Optional",
                        start_time=datetime(2026, 11, 10, 14, 0, tzinfo=timezone.utc),
                        end_time=datetime(2026, 11, 10, 16, 0, tzinfo=timezone.utc),
                        building_name="Cladirea Centrala UBB",
                        target_lat=46.7679,
                        target_lng=23.5898,
                        radius_meters=100.0,
                        required_group="231",
                        is_optional=True,
                    ),
                ]
            )
            db.add(
                AttendanceRecord(
                    id="att-1",
                    user_id="student-1",
                    class_session_id="cls-opt",
                    status="Present",
                )
            )
            db.commit()
        finally:
            db.close()

    def tearDown(self):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def test_schedule_requires_valid_bearer_auth(self):
        self.assertEqual(self.client.get("/api/student/schedule").status_code, 401)
        self.assertEqual(
            self.client.get(
                "/api/student/schedule", headers={"Authorization": "Bearer   "}
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.get(
                "/api/student/schedule", headers={"Authorization": "Bearer unknown-id"}
            ).status_code,
            404,
        )

    def test_schedule_returns_iso_timestamps_and_existing_fields(self):
        resp = self.client.get(
            "/api/student/schedule",
            headers={"Authorization": "Bearer student-1"},
        )
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertEqual([item["class_id"] for item in items], ["cls-sub", "cls-opt", "cls-next-week"])

        first = items[0]
        self.assertEqual(first["subject"], "Interactiunea om-calculator")
        # 08:00-10:00 UTC on 2026-11-10 == 10:00 AM - 12:00 PM in Europe/Bucharest (EET, UTC+2)
        self.assertEqual(first["time"], "10:00 AM - 12:00 PM")
        self.assertEqual(first["building_name"], "Univ Dimitrie Cantemir, etaj 5")
        self.assertEqual(first["room"], "DC508")
        self.assertEqual(first["class_type"], "Laborator")
        self.assertAlmostEqual(first["target_lat"], 46.5743)
        self.assertAlmostEqual(first["target_lng"], 23.7841)
        self.assertEqual(first["start_time"], "2026-11-10T08:00:00Z")
        self.assertEqual(first["end_time"], "2026-11-10T10:00:00Z")
        self.assertEqual(first["status"], "Pending")

        second = items[1]
        self.assertIsNone(second["room"])
        self.assertIsNone(second["class_type"])
        self.assertEqual(second["status"], "Present")
        self.assertEqual(second["start_time"], "2026-11-10T10:00:00Z")
        self.assertEqual(second["end_time"], "2026-11-10T12:00:00Z")

    def test_get_optional_courses(self):
        all_resp = self.client.get("/api/student/optionals")
        self.assertEqual(all_resp.status_code, 200)
        self.assertEqual(
            all_resp.json(),
            ["Cloud Computing", "Other Spec Optional", "Roboti inteligenti"],
        )

        group_resp = self.client.get("/api/student/optionals?group=933")
        self.assertEqual(group_resp.status_code, 200)
        self.assertEqual(
            group_resp.json(),
            ["Cloud Computing", "Roboti inteligenti"],
        )

    def test_schedule_date_and_days_filtering(self):
        day_only = self.client.get(
            "/api/student/schedule?date=2026-11-10",
            headers={"Authorization": "Bearer student-1"},
        )
        self.assertEqual(day_only.status_code, 200)
        self.assertEqual(
            [item["class_id"] for item in day_only.json()],
            ["cls-sub", "cls-opt"],
        )

        seven_days = self.client.get(
            "/api/student/schedule?date=2026-11-10&days=7",
            headers={"Authorization": "Bearer student-1"},
        )
        self.assertEqual(seven_days.status_code, 200)
        self.assertEqual(
            [item["class_id"] for item in seven_days.json()],
            ["cls-sub", "cls-opt"],
        )

        eight_days = self.client.get(
            "/api/student/schedule?date=2026-11-10&days=8",
            headers={"Authorization": "Bearer student-1"},
        )
        self.assertEqual(eight_days.status_code, 200)
        self.assertEqual(
            [item["class_id"] for item in eight_days.json()],
            ["cls-sub", "cls-opt", "cls-next-week"],
        )

    def test_update_student_config(self):
        resp = self.client.put(
            "/api/student/config",
            headers={"Authorization": "Bearer student-1"},
            json={"group": "933/2", "optionals": []},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"message": "Configuration saved"})

        sched = self.client.get(
            "/api/student/schedule",
            headers={"Authorization": "Bearer student-1"},
        ).json()
        self.assertEqual([item["class_id"] for item in sched], ["cls-other-sub"])

        teacher_resp = self.client.put(
            "/api/student/config",
            headers={"Authorization": "Bearer teacher-1"},
            json={"group": "933/1", "optionals": []},
        )
        self.assertEqual(teacher_resp.status_code, 403)

        bad_group = self.client.put(
            "/api/student/config",
            headers={"Authorization": "Bearer student-1"},
            json={"group": "12/1", "optionals": []},
        )
        self.assertEqual(bad_group.status_code, 422)

    @patch("scraper._get_rooms_and_optionals")
    @patch("scraper.scrape_student_schedule")
    def test_two_digit_specialization_dynamic_scrape_on_config(
        self, mock_scrape_student_schedule, mock_rooms_and_optionals
    ):
        mock_rooms_and_optionals.return_value = (
            {
                "C310": {
                    "room": "C310",
                    "building_name": "Cladirea Centrala UBB",
                    "target_lat": 46.7679,
                    "target_lng": 23.5898,
                }
            },
            {"deep learning"},
        )
        mock_scrape_student_schedule.return_value = [
            {
                "base_group": "1631",
                "day": "Marti",
                "hours": "10-12",
                "frequency": "",
                "room": "C310",
                "formatia": "MIMDS3",
                "class_type": "Curs",
                "subject": "Statistical Learning",
                "teacher": "Prof. Test",
            },
            {
                "base_group": "1631",
                "day": "Marti",
                "hours": "12-14",
                "frequency": "",
                "room": "C310",
                "formatia": "1631/1",
                "class_type": "Laborator",
                "subject": "Deep Learning",
                "teacher": "Prof. Test",
            },
        ]

        cfg_resp = self.client.put(
            "/api/student/config",
            headers={"Authorization": "Bearer student-1"},
            json={"group": "1631/1", "optionals": ["Deep Learning"]},
        )
        self.assertEqual(cfg_resp.status_code, 200)
        mock_scrape_student_schedule.assert_called_once_with(
            "https://www.cs.ubbcluj.ro/files/orar/2026-1/tabelar/MIMDS3.html"
        )

        # Verify dynamic sessions were stored without removing IE3 sessions
        sched_resp = self.client.get(
            "/api/student/schedule?date=2026-11-10&days=1",
            headers={"Authorization": "Bearer student-1"},
        )
        self.assertEqual(sched_resp.status_code, 200)
        subjects = [item["subject"] for item in sched_resp.json()]
        self.assertEqual(subjects, ["Statistical Learning", "Deep Learning"])

        opts_resp = self.client.get("/api/student/optionals?group=1631")
        self.assertEqual(opts_resp.status_code, 200)
        self.assertIn("Deep Learning", opts_resp.json())
        # Should still NOT re-scrape since MIMDS3 sessions are already cached in DB
        self.assertEqual(mock_scrape_student_schedule.call_count, 1)

        # Existing IE3 sessions must still exist in DB
        ie3_opts = self.client.get("/api/student/optionals?group=933").json()
        self.assertIn("Roboti inteligenti", ie3_opts)

    def test_checkin_present_and_left_early(self):
        present_resp = self.client.post(
            "/api/student/checkin",
            headers={"Authorization": "Bearer student-1"},
            json={"class_id": "cls-sub", "user_lat": 46.5743, "user_lng": 23.7841},
        )
        self.assertEqual(present_resp.status_code, 200)
        self.assertEqual(present_resp.json()["status"], "Present")

        left_early_resp = self.client.post(
            "/api/student/checkin",
            headers={"Authorization": "Bearer student-1"},
            json={"class_id": "cls-sub", "user_lat": 46.7732, "user_lng": 23.6236},
        )
        self.assertEqual(left_early_resp.status_code, 200)
        self.assertEqual(left_early_resp.json()["status"], "Left Early")


if __name__ == "__main__":
    unittest.main()
