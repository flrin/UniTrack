import os
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from database import Base, SessionLocal, engine
from main import app
from models import AttendanceRecord, ClassSession, User
from scraper import (
    _GEOCODE_CACHE,
    assemble_class_sessions,
    get_building_coords,
    get_first_semester_monday,
    normalize_time,
    refresh_schedule,
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
        self.db.query(AttendanceRecord).delete()
        self.db.query(ClassSession).delete()
        self.db.query(User).delete()
        self.db.commit()
        _GEOCODE_CACHE.clear()

    def tearDown(self):
        self.db.query(AttendanceRecord).delete()
        self.db.query(ClassSession).delete()
        self.db.query(User).delete()
        self.db.commit()
        self.db.close()

    # -----------------------------------------------------------------------
    # Sub-issue 21: Room Geocoding & Legenda Parsing
    # -----------------------------------------------------------------------
    def test_building_geocoding(self):
        # Fallback coordinates for Univ Dimitrie Cantemir from README specification
        lat, lng, bld = get_building_coords("Univ Dimitrie Cantemir, etaj 5 (str. Teodor Mihali nr. 56)")
        self.assertAlmostEqual(lat, 46.5743, places=3)
        self.assertAlmostEqual(lng, 23.7841, places=3)
        self.assertIn("Cantemir", bld)

        # Fallback coordinates for FSEGA
        fsega_lat, fsega_lng, _ = get_building_coords("Cladirea FSEGA, etaj 3 (str. Teodor Mihali, nr. 58-60)")
        self.assertAlmostEqual(fsega_lat, 46.7732, places=3)
        self.assertAlmostEqual(fsega_lng, 23.6236, places=3)

    @patch("httpx.Client.get")
    def test_building_geocoding_google_maps_api(self, mock_get):
        # Primary retrieval via Google Maps Geocoding API
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "status": "OK",
            "results": [
                {
                    "geometry": {"location": {"lat": 46.771234, "lng": 23.601234}},
                    "formatted_address": "Google Geocoded Campus, Cluj-Napoca, Romania",
                }
            ],
        }
        mock_get.return_value = mock_resp

        lat, lng, bld = get_building_coords("Sala Noua Campus", api_key="fake-google-api-key")
        self.assertAlmostEqual(lat, 46.771234, places=5)
        self.assertAlmostEqual(lng, 23.601234, places=5)
        self.assertEqual(bld, "Google Geocoded Campus, Cluj-Napoca, Romania")

    @patch("httpx.Client.get")
    def test_building_geocoding_api_failure_fallback(self, mock_get):
        # When Google Maps API fails, fall back to known hardcoded coordinates
        mock_get.side_effect = Exception("API connection error")

        lat, lng, bld = get_building_coords("Cladirea FSEGA", api_key="fake-key")
        self.assertAlmostEqual(lat, 46.7732, places=3)
        self.assertAlmostEqual(lng, 23.6236, places=3)
        self.assertEqual(bld, "Cladirea FSEGA")

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
        groups = {c["formatia"] for c in classes}
        self.assertTrue(any("931" in g for g in groups))
        self.assertTrue(any("/1" in g or "/2" in g for g in groups))

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
        # 2026: October 1 is Thursday; first semester week Monday is 2026-09-28 (EEST, UTC+3)
        mon_first_week = get_first_semester_monday(2026)
        self.assertEqual(mon_first_week, date(2026, 9, 28))

        start_dt, end_dt, display = normalize_time("Luni", "10-12", academic_year=2026)
        self.assertEqual(start_dt.year, 2026)
        self.assertEqual(start_dt.month, 9)
        self.assertEqual(start_dt.day, 28)
        self.assertEqual(start_dt.hour, 7)
        self.assertEqual(end_dt.hour, 9)
        self.assertEqual(display, "10:00 AM - 12:00 PM")

        # Post-DST (2026-11-09 week is EET, UTC+2): 10-12 campus local == 08:00-10:00 UTC
        start_dst, end_dst, display_dst = normalize_time(
            "Marti", "10-12", reference_monday=date(2026, 11, 9)
        )
        self.assertEqual(start_dst.day, 10)
        self.assertEqual(start_dst.hour, 8)
        self.assertEqual(end_dst.hour, 10)
        self.assertEqual(display_dst, "10:00 AM - 12:00 PM")

        # Friday of the first semester week: 2026-10-02 (EEST, UTC+3)
        start_fri, end_fri, _ = normalize_time("Vineri", "14-16", academic_year=2026)
        self.assertEqual(start_fri.year, 2026)
        self.assertEqual(start_fri.month, 10)
        self.assertEqual(start_fri.day, 2)
        self.assertEqual(start_fri.hour, 11)
        self.assertEqual(end_fri.hour, 13)

        # Configurable academic year (2025: Oct 1 is Wednesday -> Monday is 2025-09-29)
        start_2025, _, _ = normalize_time("Luni", "8-10", academic_year=2025)
        self.assertEqual(start_2025.year, 2025)
        self.assertEqual(start_2025.month, 9)
        self.assertEqual(start_2025.day, 29)

        # Configurable via ACADEMIC_YEAR environment variable
        with patch.dict(os.environ, {"ACADEMIC_YEAR": "2027"}):
            # 2027: Oct 1 is Friday -> Monday is 2027-09-27
            start_env, _, _ = normalize_time("Luni", "8-10")
            self.assertEqual(start_env.year, 2027)
            self.assertEqual(start_env.month, 9)
            self.assertEqual(start_env.day, 27)

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
        sessions = assemble_class_sessions(
            raw, rooms, optional_subjects_set=set(), academic_year=2026, weeks=1
        )
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual(s["subject"], "Interactiunea om-calculator")
        self.assertEqual(s["required_group"], "933/1")
        self.assertEqual(s["target_lat"], 46.5743)
        self.assertFalse(s["is_optional"])

        # Check deterministic ID stability
        sessions_again = assemble_class_sessions(
            raw, rooms, optional_subjects_set=set(), academic_year=2026, weeks=1
        )
        self.assertEqual(sessions[0]["id"], sessions_again[0]["id"])

        # Full-semester expansion: 14 weekly sessions, 7 odd ('sapt. 1'), 7 even ('sapt. 2')
        multi_raw = [
            {**raw[0], "subject": "Weekly Course", "frequency": ""},
            {**raw[0], "subject": "Odd Course", "frequency": "sapt. 1"},
            {**raw[0], "subject": "Even Course", "frequency": "sapt. 2"},
        ]
        semester_sessions = assemble_class_sessions(
            multi_raw,
            rooms,
            optional_subjects_set=set(),
            academic_year=2026,
            weeks=14,
        )
        weekly = [x for x in semester_sessions if x["subject"] == "Weekly Course"]
        odd = [x for x in semester_sessions if x["subject"] == "Odd Course"]
        even = [x for x in semester_sessions if x["subject"] == "Even Course"]
        self.assertEqual(len(weekly), 14)
        self.assertEqual(len(odd), 7)
        self.assertEqual(len(even), 7)
        # Unique deterministic ID across weeks
        self.assertEqual(len({x["id"] for x in weekly}), 14)
        self.assertEqual(odd[0]["start_time"].date(), date(2026, 9, 28))
        self.assertEqual(even[0]["start_time"].date(), date(2026, 10, 5))

    def test_seed_database_and_refresh_preserves_attendance(self):
        result = seed_database(db=self.db)
        self.assertEqual(result["status"], "success")
        self.assertGreater(result["sessions_seeded"], 500)
        self.assertGreater(result["users_seeded"], 0)

        student = self.db.query(User).filter_by(role="student").first()
        self.assertIsNotNone(student)
        self.assertEqual(student.name, "John Doe")
        self.assertEqual(student.group, "933/1")

        session = self.db.query(ClassSession).first()
        record = AttendanceRecord(
            id="test-att-1",
            user_id=student.id,
            class_session_id=session.id,
            status="Present",
        )
        # Stale unreferenced session should be cleaned up on refresh; referenced ones stay
        stale_session = ClassSession(
            id="stale-unreferenced-session",
            subject="Obsolete Class",
            start_time=datetime(2026, 9, 28, 10, 0),
            end_time=datetime(2026, 9, 28, 12, 0),
            building_name="Old Building",
            target_lat=46.7679,
            target_lng=23.5898,
            required_group="933/1",
            is_optional=False,
        )
        self.db.add(record)
        self.db.add(stale_session)
        self.db.commit()

        # refresh_schedule must NOT destroy attendance data, while pruning unreferenced stale sessions
        refresh_result = refresh_schedule(db=self.db)
        self.assertEqual(refresh_result["status"], "success")
        self.assertEqual(refresh_result["attendance_records_preserved"], 1)
        self.assertGreaterEqual(refresh_result["sessions_deleted"], 1)
        self.assertIsNone(self.db.get(ClassSession, "stale-unreferenced-session"))

        saved_record = self.db.query(AttendanceRecord).filter_by(id="test-att-1").first()
        self.assertIsNotNone(saved_record)
        self.assertEqual(saved_record.status, "Present")
        self.assertEqual(saved_record.class_session_id, session.id)

        # seed_database also preserves attendance data
        reseed_result = seed_database(db=self.db)
        self.assertEqual(reseed_result["status"], "success")
        preserved = self.db.query(AttendanceRecord).filter_by(id="test-att-1").first()
        self.assertIsNotNone(preserved)
        self.assertEqual(preserved.status, "Present")

    def test_api_endpoints(self):
        client = TestClient(app)
        resp = client.get("/")
        self.assertEqual(resp.status_code, 200)

        get_seed = client.get("/api/seed")
        self.assertEqual(get_seed.status_code, 405)

        post_seed = client.post("/api/seed")
        self.assertEqual(post_seed.status_code, 200)
        self.assertEqual(post_seed.json()["status"], "success")

        post_refresh = client.post("/api/schedule/refresh")
        self.assertEqual(post_refresh.status_code, 200)
        self.assertEqual(post_refresh.json()["status"], "success")

    @patch("scraper.resolve_semester", return_value=None)
    def test_refresh_skips_during_non_academic_months(self, _mock_sem):
        result = refresh_schedule(db=self.db)
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(result["sessions_created"], 0)


if __name__ == "__main__":
    unittest.main()
