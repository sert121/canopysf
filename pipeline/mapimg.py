"""Stylized field-map image of SF (land, parks, water, hillshade, roads) + neighborhoods json."""
import json, pickle, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import zoom, gaussian_filter
from common import *

W = 2400; S = W / (GNX * GRES)  # px per meter
Hh = int(GNY * GRES * S)
H = np.load(RAW + '/H.npy')
g = np.array(Image.open(OUT + '/ground.png')).astype(float) / 255
Hs = zoom(H, (Hh / H.shape[0], W / H.shape[1]), order=1)
gs = zoom(g, (Hh / g.shape[0], W / g.shape[1], 1), order=1)

paper = np.array([236, 226, 203]) / 255
park = np.array([168, 186, 132]) / 255
sand = np.array([238, 214, 160]) / 255
water = np.array([96, 140, 150]) / 255
deep = np.array([70, 112, 128]) / 255

gy, gx = np.gradient(gaussian_filter(Hs, 1.0))
shade = np.clip(1.0 + (-gx + gy) * 0.09, 0.72, 1.12)[..., None]
img = np.ones((Hh, W, 3)) * paper
hn = np.clip(Hs / 260, 0, 1)[..., None]
img = img * (1 - 0.12 * hn) + np.array([214, 196, 170]) / 255 * 0.12 * hn
img = img * (1 - gs[..., 2:3]) + sand * gs[..., 2:3]
img = img * (1 - gs[..., 0:1]) + park * gs[..., 0:1]
img = img * shade
wd = np.clip(-Hs / 8, 0, 1)[..., None]
wcol = water * (1 - wd) + deep * wd
img = img * (1 - gs[..., 1:2]) + wcol * gs[..., 1:2]
im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))

# contour hint lines every 20 m on land
d = ImageDraw.Draw(im, 'RGBA')
roads = pickle.load(open(RAW + '/roads_world.pkl', 'rb'))
TYPES = json.load(open(OUT + '/roads.json'))['types']
style = {
    'motorway': ((150, 92, 62, 255), 3.2), 'trunk': ((150, 92, 62, 255), 2.8), 'primary': ((120, 104, 92, 255), 2.2),
    'secondary': ((120, 104, 92, 240), 1.8), 'tertiary': ((128, 114, 100, 230), 1.4), 'residential': ((140, 128, 114, 210), 1.0),
    'unclassified': ((140, 128, 114, 200), 1.0), 'living_street': ((140, 128, 114, 200), 1.0), 'service': ((150, 140, 126, 130), 0.7),
    'pedestrian': ((150, 120, 90, 200), 1.0), 'track': ((132, 104, 70, 200), 0.8), 'path': ((112, 86, 56, 190), 0.7),
    'footway': ((112, 86, 56, 170), 0.6), 'cycleway': ((112, 86, 56, 170), 0.6), 'steps': ((112, 86, 56, 200), 0.7)}
order = ['service', 'footway', 'cycleway', 'path', 'track', 'steps', 'pedestrian', 'living_street', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']
for t in order:
    col, w = style[t]
    for ti, ww, run in roads:
        if TYPES[ti] != t: continue
        pts = [((x - GX0) * S, (GNY * GRES - (y - GY0)) * S) for x, y in run]
        d.line(pts, fill=col, width=max(1, int(round(w))))
im = im.filter(ImageFilter.SMOOTH)
im.save(OUT + '/map.jpg', quality=86, optimize=True, progressive=True)
print('map', im.size)

# neighborhoods: simplified polygons + label points
nh = []
for f in json.load(open(RAW + '/sf_find_neighborhoods.geojson'))['features']:
    g_ = f['geometry']; ps = [g_['coordinates']] if g_['type'] == 'Polygon' else g_['coordinates']
    polys = []
    best = None
    for p in ps:
        a = np.array(p[0])[:, :2]; x, y = ll2w(a[:, 0], a[:, 1])
        ring = np.c_[x, y][::max(1, len(a) // 60)]
        polys.append(np.round(ring, 1).tolist())
        area = abs(np.sum(x[:-1] * y[1:] - x[1:] * y[:-1])) / 2
        if best is None or area > best[0]: best = (area, float(np.mean(x)), float(np.mean(y)))
    nh.append({'name': f['properties']['name'], 'polys': polys, 'c': [round(best[1], 1), round(best[2], 1)], 'area': round(best[0])})
json.dump(nh, open(OUT + '/neighborhoods.json', 'w'), separators=(',', ':'))
print('nh', len(nh))
