import math, numpy as np

# World frame: meters, x = east, y = north, origin at (37.76, -122.44)
LAT0, LON0 = 37.76, -122.44
R = 6378137.0
MLAT = math.pi / 180 * R
MLON = MLAT * math.cos(math.radians(LAT0))

# Terrain grid (10 m)
GX0, GY0, GRES, GNX, GNY = -6700.0, -6400.0, 10.0, 1420, 1480
# Ground mask grid (4 m)
MX0, MY0, MRES = GX0, GY0, 4.0
MNX, MNY = int(GNX * GRES / MRES), int(GNY * GRES / MRES)

CHUNK = 500.0  # streaming chunk size (m)

import os
_HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(_HERE, 'raw')
OUT = os.path.join(_HERE, '..', 'public', 'data')


def ll2w(lon, lat):
    lon = np.asarray(lon, dtype=float); lat = np.asarray(lat, dtype=float)
    return (lon - LON0) * MLON, (lat - LAT0) * MLAT


def osm2w(P):
    """Convert bnovc local-frame points (N,2) to world metric via fitted affine."""
    M = np.load(os.path.join(_HERE, 'osm_frame.npy'))
    P = np.asarray(P, dtype=float)
    H = np.c_[P, np.ones(len(P))]
    W = H @ M  # metric relative to (37.76,-122.44) already
    return W
