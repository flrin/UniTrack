import unittest
from datetime import datetime
from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
from main import app
from models import AttendanceRecord, ClassSession, User
from scraper import (
    assemble_class_sessions,
    get_building_coords,
    normalize_time,
    scrape_classrooms,
    scrape_student_schedule,
    scrape_teacher_schedule,
    seed_database,
    SPECIALIZATION_CODE_MAP,
)


class TestUniTrackScraper(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    # -----------------------------------------------------------------------
    # Sub-issue 21: Room Geocoding & Legenda Parsing
    # -----------------------------------------------------------------------
    def test_building_geocoding(self):
        # Univ Dimitrie Cantemir from README specification
        lat, lng, bld = get_building_coords("Univ Dimitrie Cantemir, etaj 5 (str. Teodor Mihali nr. 56)")
        self.assertAlmostEqual(lat, 46.5743, places=3)
        self.assertAlmostEqual(lng, 23.7841, places=3)
        self.assertIn("Cantemir", bld)

        # FSEGA
        fsega_lat, fsega_lng, _ = get_building_coords("Cladirea FSEGA, etaj 3 (str. Teodor Mihali, nr. 58-60)")
        self.assertAlmostEqual(fsega_lat, 46.7732, places=3)
        self.assertAlmostEqual(fsega_lng, 23.6236, places=3)

    def test_scrape_classrooms(self):
        rooms = scrape_classrooms()
        self.assertGreater(len(rooms), 50)
        self.assertIn("DC508", rooms)
        self.assertAlmostEqual(rooms["DC508"]["target_lat"], 46.5743, places=3)
        self.assertAlmostEqual(rooms["DC508"]["target_lng"], 23.7841, places=3)

    # -----------------------------------------------------------------------
    # Sub-issue 22: Student & Teacher Schedule Parsing
    # -----------------------------------------------------------------------
    def test_scrape_student_schedule(self):
        classes = scrape_student_schedule()
        self.assertGreater(len(classes), 50)
        # Check subgroup formatia values exist
        groups = {c["formatia"] for c in classes}
        self.assertTrue(any("931" in g for g in groups))
        self.assertTrue(any("/1" in g or "/2" in g for g in groups))

        # Check required fields exist on every item
        sample = classes[0]
        for field in ["base_group", "day", "hours", "room", "formatia", "subject", "class_type"]:
            self.assertIn(field, sample)

    def test_scrape_teacher_schedule(self):
        t_classes = scrape_teacher_schedule()
        self.assertGreater(len(t_classes), 0)
        sample = t_classes[0]
        for col in ["teacher", "day", "hours", "room", "formatia", "class_type", "subject"]:
            self.assertIn(col, sample)

    # -----------------------------------------------------------------------
    # Sub-issue 23: Specialization Code Mapping
    # -----------------------------------------------------------------------
    def test_specialization_code_mapping(self):
        self.assertEqual(SPECIALIZATION_CODE_MAP["9"], "Informatica Engleza")
        self.assertEqual(SPECIALIZATION_CODE_MAP["2"], "Informatica Romana")
        self.assertEqual(SPECIALIZATION_CODE_MAP["4"], "Informatica Germana")

    # -----------------------------------------------------------------------
    # Sub-issue 24: Data Normalization & Database Seeding
    # -----------------------------------------------------------------------
    def test_normalize_time(self):
        start_dt, end_dt, display = normalize_time("Luni", "10-12")
        self.assertEqual(start_dt.hour, 10)
        self.assertEqual(end_dt.hour, 12)
        self.assertEqual(display, "10:00 AM - 12:00 PM")

        # Test Friday (matches README 2026-10-30 date)
        start_fri, end_fri, _ = normalize_time("Vineri", "14-16")
        self.assertEqual(start_fri.day, 30)
        self.assertEqual(start_fri.hour, 14)
        self.assertEqual(end_fri.hour, 16)

    def test_assemble_class_sessions(self):
        raw = [
            {
                "base_group": "933",
                "day": "Luni",
                "hours": "10-12",
                "frequency": "",
                "room": "DC508",
                "formatia": "933/1",
                "class_type": "Laborator",
                "subject": "Interactiunea om-calculator",
                "teacher": "Conf. COJOCAR Grigoreta",
            }
        ]
        rooms = {
            "DC508": {
                "room": "DC508",
                "building_name": "Univ Dimitrie Cantemir, etaj 5",
                "target_lat": 46.5743,
                "target_lng": 23.7841,
            }
        }
        sessions = assemble_class_sessions(raw, rooms, optional_subjects_set=set())
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual(s["subject"], "Interactiunea om-calculator")
        self.assertEqual(s["required_group"], "933/1")
        self.assertEqual(s["target_lat"], 46.5743)
        self.assertFalse(s["is_optional"])

    def test_seed_database_and_api(self):
        result = seed_database(db=self.db)
        self.assertEqual(result["status"], "success")
        self.assertGreater(result["sessions_seeded"], 50)
        self.assertGreater(result["users_seeded"], 0)

        # Check seeded student user exists
        student = self.db.query(User).filter_by(role="student").first()
        self.assertIsNotNone(student)
        self.assertEqual(student.name, "John Doe")
        self.assertEqual(student.group, "933/1")

        # Test re-seeding safely when attendance records exist (finding 1)
        session = self.db.query(ClassSession).first()
        record = AttendanceRecord(
            id="test-att-1",
            user_id=student.id,
            class_session_id=session.id,
            status="Present",
        )
        self.db.add(record)
        self.db.commit()

        reseed_result = seed_database(db=self.db)
        self.assertEqual(reseed_result["status"], "success")

        # Check API endpoint works and GET /api/seed is blocked (finding 2)
        client = TestClient(app)
        resp = client.get("/")
        self.assertEqual(resp.status_code, 200)

        get_seed = client.get("/api/seed")
        self.assertEqual(get_seed.status_code, 405)

        post_seed = client.post("/api/seed")
        self.assertEqual(post_seed.status_code, 200)
        self.assertEqual(post_seed.json()["status"], "success")


if __name__ == "__main__":
    unittest.main()
