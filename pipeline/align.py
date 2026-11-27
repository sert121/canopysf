"""Fit the affine that maps the OSM tiles' local frame (rotated ~9.4 deg about Union Square) onto
world metres, by matching OSM road vertices to DataSF street centrelines (ICP). Writes osm_frame.npy."""
import json, glob, csv, re, math, numpy as np
from scipy.spatial import cKDTree
from common import *

def dense(lines, step):
    out = []
    for pts in lines:
        for a, b in zip(pts[:-1], pts[1:]):
            n = max(1, int(math.dist(a, b) / step))
            out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    return np.array(out)

P = dense([r[3] for f in glob.glob(RAW + '/tiles/*.json') for r in json.load(open(f))['roads']
           if r[1] in ('residential', 'tertiary', 'secondary', 'primary')], 5)
csv.field_size_limit(10 ** 9)
S = dense([[(float(a), float(b)) for a, b in re.findall(r'(-122\.\d+) (37\.\d+)', row['line'])]
           for row in csv.DictReader(open(RAW + '/streets.csv')) if row['active'] == 'true'], 0.00005)
Sx, Sy = ll2w(S[:, 0], S[:, 1]); Sm = np.c_[Sx, Sy]
# initial guess from landmarks (local x, local y, lat, lon)
L = [(399.4, -1565.3, 37.80239, -122.40582), (1384.5, -638.5, 37.79552, -122.39342), (-3269.1, -2239.7, 37.80292, -122.44843),
     (-4848.3, 932.6, 37.77172, -122.46030), (-9422.5, -492.4, 37.77830, -122.51404), (-2492.9, 8722.4, 37.70739, -122.41890)]
A = np.array([[a, b, 1] for a, b, _, _ in L]); wx, wy = ll2w([l[3] for l in L], [l[2] for l in L])
M = np.linalg.lstsq(A, np.c_[wx, wy], rcond=None)[0]
H = np.c_[P, np.ones(len(P))]; t = cKDTree(Sm)
for it in range(70):
    d, i = t.query(H @ M)
    m = d < (np.percentile(d, 50) if it < 10 else 6)
    M = np.linalg.lstsq(H[m], Sm[i[m]], rcond=None)[0]
print('median residual (m):', np.median(d))
np.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'osm_frame.npy'), M)
