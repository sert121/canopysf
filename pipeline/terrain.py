"""Heightmap from SF 5-ft contours + land mask + ground mask (parks/water/sand)."""
import json, glob, os, numpy as np
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter, distance_transform_edt, zoom
from PIL import Image, ImageDraw
from common import *

os.makedirs(OUT, exist_ok=True)

def polys_of(geom):
    t = geom['type']; c = geom['coordinates']
    if t == 'Polygon': return [c]
    if t == 'MultiPolygon': return c
    return []

def raster_polys(polys_world, nx, ny, x0, y0, res, img=None, fill=255):
    """polys_world: list of polygons, each list of rings (arrays Nx2 world)."""
    if img is None: img = Image.new('L', (nx, ny), 0)
    d = ImageDraw.Draw(img)
    for rings in polys_world:
        for k, ring in enumerate(rings):
            px = [((x - x0) / res, (ny - 1) - (y - y0) / res) for x, y in ring]  # row 0 = north
            if len(px) >= 3: d.polygon(px, fill=(fill if k == 0 else 0))
    return img

def gj_world(path, filt=None):
    out = []
    for f in json.load(open(path))['features']:
        if f['geometry'] is None: continue
        if filt and not filt(f['properties']): continue
        for poly in polys_of(f['geometry']):
            rings = []
            for ring in poly:
                a = np.array(ring)[:, :2]
                x, y = ll2w(a[:, 0], a[:, 1]); rings.append(np.c_[x, y])
            out.append(rings)
    return out

# ---------- land mask (10 m grid and 4 m grid) ----------
land_polys = gj_world(RAW + '/supervisor_districts.geojson')
land10 = np.array(raster_polys(land_polys, GNX, GNY, GX0, GY0, GRES)) > 0
land4 = np.array(raster_polys(land_polys, MNX, MNY, MX0, MY0, MRES)) > 0
print('land cells', land10.sum(), 'km2', land10.sum() * 100 / 1e6)

# ---------- contours -> heights ----------
F = json.load(open(RAW + '/kc.json'))['features']
pts = []; vals = []
for f in F:
    g = f['geometry']
    if not g: continue
    lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
    e = f['properties']['elevation'] * 0.3048 + 3.4  # SF datum ft -> ~NAVD88 m
    for line in lines:
        a = np.array(line)
        x, y = ll2w(a[:, 0], a[:, 1])
        # resample at ~6 m
        seg = np.hypot(np.diff(x), np.diff(y)); s = np.r_[0, np.cumsum(seg)]
        if s[-1] < 1: continue
        n = max(2, int(s[-1] / 6))
        si = np.linspace(0, s[-1], n)
        pts.append(np.c_[np.interp(si, s, x), np.interp(si, s, y)]); vals.append(np.full(n, e))
pts = np.vstack(pts); vals = np.concatenate(vals)
print('contour pts', len(pts))

gx = GX0 + np.arange(GNX) * GRES
gy = GY0 + (GNY - 1 - np.arange(GNY)) * GRES  # row 0 north
GXX, GYY = np.meshgrid(gx, gy)

# ocean anchor points: water cells far from land
dist_land = distance_transform_edt(~land10) * GRES
oc = (~land10) & (dist_land > 40)
oi = np.argwhere(oc)[::7]
opts = np.c_[gx[oi[:, 1]], gy[oi[:, 0]]]
allp = np.vstack([pts, opts]); allv = np.concatenate([vals, np.full(len(opts), -6.0)])

H = griddata(allp, allv, (GXX, GYY), method='linear')
Hn = griddata(allp, allv, (GXX, GYY), method='nearest')
H = np.where(np.isnan(H), Hn, H)
H = gaussian_filter(H, 1.6)
# land clamp / ocean shaping
H = np.where(land10, np.maximum(H, 0.6), np.minimum(H, -1.0 - np.clip(dist_land / 40, 0, 8)))
H = gaussian_filter(H, 0.7)
H = np.where(land10, np.maximum(H, 0.4), H)

# ---------- OSM park + water areas ----------
parks, waters = [], []
for f in glob.glob(RAW + '/tiles/*.json'):
    for a in json.load(open(f))['areas']:
        ring = osm2w(a[2])
        (parks if a[1] == 'park' else waters).append([ring])
# city lands parks too
city_parks = gj_world(RAW + '/lands.geojson', lambda p: p.get('cat') == 'park')
PRESIDIO = [(-122.4475, 37.8058), (-122.4467, 37.7987), (-122.4462, 37.7905), (-122.4590, 37.7881), (-122.4710, 37.7866),
            (-122.4846, 37.7866), (-122.4925, 37.7878), (-122.4870, 37.7990), (-122.4800, 37.8080), (-122.4775, 37.8112),
            (-122.4650, 37.8068), (-122.4475, 37.8062)]
px, py = ll2w([p[0] for p in PRESIDIO], [p[1] for p in PRESIDIO])
presidio = [[np.c_[px, py]]]
json.dump([[float(a), float(b)] for a, b in zip(px, py)], open(RAW + '/presidio.json', 'w'))
park4 = (np.array(raster_polys(parks + city_parks + presidio, MNX, MNY, MX0, MY0, MRES)) > 0) & land4
water4 = np.array(raster_polys(waters, MNX, MNY, MX0, MY0, MRES)) > 0
# Lake Merced: flat interior of its shoreline contour within the PUC parcels
lm_polys = gj_world(RAW + '/lands.geojson', lambda p: (p.get('name') or '').startswith('LAKE MERCED PARK'))
lm10 = np.array(raster_polys(lm_polys, GNX, GNY, GX0, GY0, GRES)) > 0
from scipy.ndimage import binary_dilation as _bd, label as _lab
lm10 = _bd(lm10, iterations=10)
gyy, gxx = np.gradient(H)
flat = (np.hypot(gxx, gyy) < 0.02) & lm10 & land10
fl, fn = _lab(flat)
lake10 = np.zeros_like(flat)
for i in range(1, fn + 1):
    m = fl == i
    if m.sum() > 40: lake10 |= m
lake4 = zoom(lake10.astype(float), GRES / MRES, order=1)[:MNY, :MNX] > 0.5
water4 |= lake4
print('lake merced cells', lake10.sum())

# lakes: flatten terrain under lake (10m) to rim minimum
water10 = zoom(water4.astype(float), GRES / MRES * 0 + MRES / GRES, order=1) > 0.5
water10 = water10[:GNY, :GNX]
from scipy.ndimage import label, binary_dilation
lab, n = label(water10 & land10)
for i in range(1, n + 1):
    m = lab == i
    rim = binary_dilation(m, iterations=2) & ~m
    if rim.sum() == 0: continue
    lvl = np.percentile(H[rim], 10)
    H[m] = lvl - 1.2
print('lakes', n)

# ---------- sand (beaches) ----------
ocean4 = ~land4
d_ocean4 = distance_transform_edt(~ocean4) * MRES
Hm = zoom(H, GRES / MRES, order=1)[:MNY, :MNX]
mx = MX0 + np.arange(MNX) * MRES
west = (mx < -1800)[None, :]
sand4 = land4 & (d_ocean4 < 90) & (Hm < 9) & west & ~park4
sand4 = gaussian_filter(sand4.astype(float), 1.5) > 0.5

# ---------- write ----------
q = np.clip(np.round((H + 50) * 100), 0, 65535).astype('<u2')
q.tofile(OUT + '/terrain.u16')
park_s = gaussian_filter(park4.astype(float), 0.8)
water_s = gaussian_filter((water4 | ocean4).astype(float), 0.8)
sand_s = gaussian_filter(sand4.astype(float), 1.0)
img = np.stack([park_s, water_s, sand_s], -1)
Image.fromarray((img * 255).astype(np.uint8), 'RGB').save(OUT + '/ground.png', optimize=True)
np.save(RAW + '/H.npy', H); np.save(RAW + '/park4.npy', park4); np.save(RAW + '/water4.npy', water4 | ocean4); np.save(RAW + '/land4.npy', land4)
meta = dict(gx0=GX0, gy0=GY0, gres=GRES, gnx=GNX, gny=GNY, mx0=MX0, my0=MY0, mres=MRES, mnx=MNX, mny=MNY, hoff=50, hscale=100,
            lat0=LAT0, lon0=LON0, mlat=MLAT, mlon=MLON, chunk=CHUNK)
json.dump(meta, open(OUT + '/world.json', 'w'))
print('H range', H.min(), H.max())
for name, lat, lon in [('twin peaks', 37.7544, -122.4477), ('mt davidson', 37.7383, -122.4545), ('telegraph', 37.8024, -122.4058), ('union sq', 37.788, -122.4075), ('ocean beach', 37.76, -122.5095)]:
    x, y = ll2w(lon, lat); c = int((x - GX0) / GRES); r = int(GNY - 1 - (y - GY0) / GRES)
    print(name, round(float(H[r, c]), 1))
