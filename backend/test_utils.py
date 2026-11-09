import math
import unittest

from utils import calculate_distance

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


if __name__ == "__main__":
    unittest.main()
