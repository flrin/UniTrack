from datetime import date
import math
import os
import unittest
from unittest.mock import patch

from utils import (
    NonAcademicPeriodError,
    build_classrooms_url,
    build_optionals_page_url,
    build_student_schedule_url,
    build_teacher_schedule_url,
    calculate_distance,
    is_academic_period,
    parse_group_components,
    resolve_academic_year,
    resolve_semester,
)

RADIUS_M = 100
# One degree of latitude is ~111,195 m on a sphere of radius 6,371 km.
METRES_PER_DEG_LAT = 6_371_000 * math.pi / 180


class TestCalculateDistance(unittest.TestCase):
    def setUp(self):
        self.lat = 47.1585
        self.lon = 27.6014

    def offset_north(self, metres):
        return self.lat + metres / METRES_PER_DEG_LAT

    def test_identical_coordinates_return_zero(self):
        self.assertEqual(calculate_distance(self.lat, self.lon, self.lat, self.lon), 0)

    def test_99m_apart_is_within_radius(self):
        distance = calculate_distance(self.lat, self.lon, self.offset_north(99), self.lon)
        self.assertAlmostEqual(distance, 99, places=3)
        self.assertLessEqual(distance, RADIUS_M)

    def test_101m_apart_is_outside_radius(self):
        distance = calculate_distance(self.lat, self.lon, self.offset_north(101), self.lon)
        self.assertAlmostEqual(distance, 101, places=3)
        self.assertGreater(distance, RADIUS_M)

    def test_distance_is_symmetric(self):
        lat2 = self.offset_north(50)
        self.assertAlmostEqual(
            calculate_distance(self.lat, self.lon, lat2, self.lon),
            calculate_distance(lat2, self.lon, self.lat, self.lon),
        )


class TestGroupDecodingAndUrls(unittest.TestCase):
    def test_parse_all_1_and_2_digit_specialization_codes(self):
        expected = [
            ("111/1", "111", "1", "1", "M1"),
            ("211/2", "211", "2", "1", "I1"),
            ("321/1", "321", "3", "2", "MI2"),
            ("421/1", "421", "4", "2", "MM2"),
            ("521/1", "521", "5", "2", "IM2"),
            ("631/1", "631", "6", "3", "MIM3"),
            ("721/1", "721", "7", "2", "IG2"),
            ("821/1", "821", "8", "2", "MIE2"),
            ("921/1", "921", "9", "2", "IE2"),
            ("1021/1", "1021", "10", "2", "IA2"),
            ("1321/1", "1321", "13", "2", "II2"),
            ("1421/1", "1421", "14", "2", "IIM2"),
            ("1521/1", "1521", "15", "2", "MIDS2"),
            ("1621/1", "1621", "16", "2", "MIMDS2"),
            ("1631/1", "1631", "16", "3", "MIMDS3"),
        ]
        for group, base, spec, year, year_code in expected:
            parsed = parse_group_components(group)
            self.assertEqual(parsed["semi_group"], group)
            self.assertEqual(parsed["base_group"], base)
            self.assertEqual(parsed["spec_code"], spec)
            self.assertEqual(parsed["year_digit"], year)
            self.assertEqual(parsed["year_code"], year_code)
            self.assertTrue(parsed["is_known_spec"])

    def test_build_student_schedule_url(self):
        self.assertEqual(
            build_student_schedule_url("MIMDS3", today=date(2026, 11, 10)),
            "https://www.cs.ubbcluj.ro/files/orar/2026-1/tabelar/MIMDS3.html",
        )
        self.assertEqual(
            build_student_schedule_url("IE2", today=date(2027, 3, 15)),
            "https://www.cs.ubbcluj.ro/files/orar/2026-2/tabelar/IE2.html",
        )

    def test_academic_year_semester_and_dynamic_urls(self):
        # Oct-Dec -> current year, semester 1
        self.assertEqual(resolve_academic_year(today=date(2026, 11, 10)), 2026)
        self.assertEqual(resolve_semester(today=date(2026, 11, 10)), 1)
        self.assertTrue(is_academic_period(today=date(2026, 11, 10)))

        # January -> still semester 1 of prior Oct's academic year
        self.assertEqual(resolve_academic_year(today=date(2027, 1, 15)), 2026)
        self.assertEqual(resolve_semester(today=date(2027, 1, 15)), 1)

        # Feb-Jun -> semester 2 of prior Oct's academic year
        self.assertEqual(resolve_academic_year(today=date(2027, 3, 15)), 2026)
        self.assertEqual(resolve_semester(today=date(2027, 3, 15)), 2)

        # Jul-Sep -> non-academic months
        self.assertIsNone(resolve_semester(today=date(2027, 8, 1)))
        self.assertFalse(is_academic_period(today=date(2027, 9, 15)))
        with self.assertRaises(NonAcademicPeriodError):
            build_classrooms_url(today=date(2027, 8, 1))

        # URL builders with dynamic academic_year / semester & env overrides
        self.assertEqual(
            build_classrooms_url(today=date(2027, 4, 10)),
            "https://www.cs.ubbcluj.ro/files/orar/2026-2/sali/legenda.html",
        )
        self.assertEqual(
            build_teacher_schedule_url("mogr1", today=date(2026, 11, 10)),
            "https://www.cs.ubbcluj.ro/files/orar/2026-1/cadre/mogr1.html",
        )
        self.assertEqual(
            build_optionals_page_url(today=date(2027, 3, 15)),
            "https://www.cs.ubbcluj.ro/lista-cursurilor-optionale-alese-pentru-anul-universitar-2026-2027/",
        )
        with patch.dict(os.environ, {"ACADEMIC_YEAR": "2027", "ACADEMIC_SEMESTER": "2"}):
            self.assertEqual(
                build_student_schedule_url("IE3"),
                "https://www.cs.ubbcluj.ro/files/orar/2027-2/tabelar/IE3.html",
            )
            self.assertEqual(
                build_optionals_page_url(),
                "https://www.cs.ubbcluj.ro/lista-cursurilor-optionale-alese-pentru-anul-universitar-2027-2028/",
            )


if __name__ == "__main__":
    unittest.main()
