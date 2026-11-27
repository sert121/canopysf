"""Street trees (DataSF) + approximate park forest stands -> trees.bin, species.json, meta chunks."""
import csv, json, os, glob, re, math, pickle, collections, numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter
from common import *

rng = np.random.default_rng(7)
H = np.load(RAW + '/H.npy'); water4 = np.load(RAW + '/water4.npy'); park4 = np.load(RAW + '/park4.npy')

def h_at(x, y):
    c = np.clip(((x - GX0) / GRES).astype(int), 0, GNX - 1); r = np.clip((GNY - 1 - (y - GY0) / GRES).astype(int), 0, GNY - 1)
    return H[r, c]

def m_idx(x, y):
    c = np.clip(((x - MX0) / MRES).astype(int), 0, MNX - 1); r = np.clip((MNY - 1 - (y - MY0) / MRES).astype(int), 0, MNY - 1)
    return r, c

# ---------------- street trees ----------------
rows = [r for r in csv.DictReader(open(RAW + '/trees.csv'))
        if r['Latitude'] and r['PlantType'].lower() == 'tree']
skip = {'Potential Site :: Potential Site', 'Shrub :: Shrub'}
rows = [r for r in rows if r['qSpecies'].strip() not in skip]
print('street trees', len(rows))

def norm_q(q):
    q = q.strip()
    if q in ('::', 'Tree(s) ::', 'Tree :: Tree', ''): return 'Tree(s) ::'
    return q

lat = np.array([float(r['Latitude']) for r in rows]); lon = np.array([float(r['Longitude']) for r in rows])
X, Y = ll2w(lon, lat)
ok = (X > GX0) & (X < GX0 + GNX * GRES) & (Y > GY0) & (Y < GY0 + GNY * GRES)
rows = [r for r, k in zip(rows, ok) if k]; X = X[ok]; Y = Y[ok]
# spread trees that share an identical coordinate (multi-tree sites)
grp = collections.defaultdict(list)
for i, (x, y) in enumerate(zip(np.round(X, 2), np.round(Y, 2))): grp[(x, y)].append(i)
nspread = 0
for idx in grp.values():
    if len(idx) < 2: continue
    n = len(idx); nspread += n
    for k, i in enumerate(sorted(idx, key=lambda i: int(rows[i]['SiteOrder'] or 0))):
        ang = k * 2.39996; rad = 1.6 * math.sqrt(k + 0.5)
        X[i] += rad * math.cos(ang); Y[i] += rad * math.sin(ang)
print('spread', nspread)

qs = [norm_q(r['qSpecies']) for r in rows]
dbh = []
for r in rows:
    try: d = float(r['DBH'])
    except: d = 0
    if d > 90: d = 0  # bogus outliers
    dbh.append(d)
dbh = np.array(dbh)
flags = np.zeros(len(rows), np.uint8)
for i, r in enumerate(rows):
    ls = r['qLegalStatus']
    if ls == 'Landmark tree': flags[i] |= 2
    if ls == 'Significant Tree': flags[i] |= 4

# ---------------- approximate park stands ----------------
def gj_polys(path, names):
    out = []
    for f in json.load(open(path))['features']:
        n = (f['properties'].get('name') or '')
        if n not in names or not f['geometry']: continue
        g = f['geometry']; ps = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for p in ps:
            a = np.array(p[0])[:, :2]; x, y = ll2w(a[:, 0], a[:, 1]); out.append(np.c_[x, y])
    return out

SP = {
    'cyp': 'Cupressus macrocarpa :: Monterey Cypress', 'pine': 'Pinus radiata :: Monterey Pine',
    'gum': 'Eucalyptus globulus :: Blue Gum', 'red': 'Sequoia sempervirens :: Coast Redwood',
    'oak': 'Quercus agrifolia :: Coast Live Oak', 'aca': 'Acacia melanoxylon :: Blackwood Acacia',
    'tea': 'Leptospermum laevigatum :: Australian Tea Tree', 'myo': 'Myoporum laetum :: Myoporum',
    'wil': 'Salix lasiolepis :: Arroyo Willow', 'bay': 'Umbellularia californica :: California Bay',
    'plane': 'Platanus x hispanica :: Sycamore: London Plane', 'nzx': 'Metrosideros excelsa :: New Zealand Xmas Tree',
    'hoak': 'Quercus ilex :: Holly Oak', 'palm': 'Phoenix canariensis :: Canary Island Date Palm',
    'redgum': 'Corymbia ficifolia :: Red Flowering Gum', 'mag': 'Magnolia grandiflora :: Southern Magnolia',
    'bris': 'Lophostemon confertus :: Brisbane Box', 'vbox': 'Pittosporum undulatum :: Victorian Box',
}
STANDS = [
    # name(s), mix, coverage, spacing
    (['GOLDEN GATE PARK'], dict(cyp=.32, pine=.28, gum=.26, red=.05, oak=.04, aca=.03, tea=.02), .50, 10),
    (['LINCOLN PARK'], dict(cyp=.55, pine=.30, gum=.10, oak=.05), .55, 10),
    (['JOHN MCLAREN PARK'], dict(gum=.45, pine=.25, cyp=.25, oak=.05), .45, 10),
    (['SIGMUND STERN RECREATION GROVE', 'PINE LAKE PARK'], dict(gum=.50, red=.15, cyp=.20, pine=.15), .70, 9),
    (['MT DAVIDSON PARK'], dict(gum=.85, pine=.08, oak=.07), .75, 8),
    (['GLEN PARK'], dict(gum=.55, oak=.25, wil=.10, bay=.10), .45, 9),
    (['BUENA VISTA PARK'], dict(cyp=.35, pine=.25, gum=.25, oak=.15), .65, 9),
    (['LAKE MERCED PARK'], dict(cyp=.40, pine=.30, gum=.25, myo=.05), .25, 11),
    (['MOUNTAIN LAKE PARK'], dict(cyp=.35, pine=.30, gum=.25, oak=.10), .45, 10),
]
stand_polys = [(gj_polys(RAW + '/lands.geojson', set(n)), mix, cov, sp, n[0]) for n, mix, cov, sp in STANDS]
pres = np.array(json.load(open(RAW + '/presidio.json')))
stand_polys.append(([pres], dict(cyp=.35, pine=.33, gum=.25, oak=.07), .25, 11, 'PRESIDIO'))
# Mount Sutro forest (UCSF reserve): ellipse
cx_, cy_ = ll2w(-122.4565, 37.7590)
t = np.linspace(0, 2 * np.pi, 40)
stand_polys.append(([np.c_[cx_ + 330 * np.cos(t), cy_ + 230 * np.sin(t)]], dict(gum=.92, aca=.05, pine=.03), .85, 7, 'MOUNT SUTRO'))

# exclusion: roads + paths (raster at 4 m), water, existing street trees
road_img = Image.new('L', (MNX, MNY), 0); d = ImageDraw.Draw(road_img)
for t_, w, run in pickle.load(open(RAW + '/roads_world.pkl', 'rb')):
    px = [((x - MX0) / MRES, MNY - 1 - (y - MY0) / MRES) for x, y in run]
    d.line(px, fill=255, width=max(1, int((w / 4) / MRES * 2 + 1)))
roadm = np.array(road_img) > 0
d_road = distance_transform_edt(~roadm) * MRES
# grove noise
nz = gaussian_filter(rng.standard_normal((MNY // 8 + 1, MNX // 8 + 1)), 3.0)
nz = (nz - nz.mean()) / nz.std()
def noise_at(x, y):
    r, c = m_idx(x, y); return nz[r // 8, c // 8]

from matplotlib.path import Path
ax, ay, aq, adbh = [], [], [], []
st = [];  # stand name per approx tree
tx_tree = np.c_[X, Y]
from scipy.spatial import cKDTree
street_kd = cKDTree(tx_tree)
for polys, mix, cov, spacing, name in stand_polys:
    keys = list(mix.keys()); p = np.array([mix[k] for k in keys]); p /= p.sum()
    thr = {0.85: -1.04, 0.75: -0.67, 0.70: -0.52, 0.65: -0.39, 0.55: -0.13, 0.50: 0.0, 0.45: 0.13, 0.38: 0.31, 0.25: 0.67}.get(cov, 0)
    n0 = len(ax)
    for poly in polys:
        x0, y0 = poly.min(0); x1, y1 = poly.max(0)
        gx = np.arange(x0, x1, spacing); gy = np.arange(y0, y1, spacing)
        G = np.array(np.meshgrid(gx, gy)).reshape(2, -1).T
        G = G + rng.uniform(-spacing * 0.45, spacing * 0.45, G.shape)
        G = G[Path(poly).contains_points(G)]
        if len(G) == 0: continue
        r, c = m_idx(G[:, 0], G[:, 1])
        keep = (~water4[r, c]) & (d_road[r, c] > 5) & (noise_at(G[:, 0], G[:, 1]) > thr) & (h_at(G[:, 0], G[:, 1]) > 1.0)
        G = G[keep]
        dd, _ = street_kd.query(G); G = G[dd > 4]
        sp = rng.choice(len(keys), len(G), p=p)
        for (x, y), s in zip(G, sp):
            ax.append(x); ay.append(y); aq.append(SP[keys[s]]); adbh.append(float(np.clip(rng.gamma(4, 6), 6, 60))); st.append(name.title())
    print(name, len(ax) - n0)
print('forest stand trees', len(ax))

# ---------------- every other park ----------------
# Rec & Park manages ~131,000 trees but doesn't publish the inventory, so the remaining parks are planted from
# how San Francisco parks are actually treed: rows of trees along the edges, groves inside, lawns left open,
# with each park's documented species mix where we have one (Alamo Square is two-thirds Monterey cypress).
def raster_polys(polys, val=1, img=None):
    img = img or Image.new('I', (MNX, MNY), 0); d = ImageDraw.Draw(img)
    for poly in polys:
        pts = [((x - MX0) / MRES, MNY - 1 - (y - MY0) / MRES) for x, y in poly]
        if len(pts) >= 3: d.polygon(pts, fill=val)
    return img
standMask = np.array(raster_polys([p for polys, *_ in stand_polys for p in polys])) > 0
lands = json.load(open(RAW + '/lands.geojson'))['features']
name_img = Image.new('I', (MNX, MNY), 0); names = ['']
for f in lands:
    pr = f['properties']
    if pr.get('cat') not in ('park', 'openspace') or not f['geometry']: continue
    g = f['geometry']; ps = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    polys = []
    for pp in ps:
        a_ = np.array(pp[0])[:, :2]; x_, y_ = ll2w(a_[:, 0], a_[:, 1]); polys.append(np.c_[x_, y_])
    names.append(pr['name']); raster_polys(polys, len(names) - 1, name_img)
nameR = np.array(name_img)
ground = np.array(Image.open(OUT + '/ground.png').convert('RGB'))
sandR = np.array(Image.fromarray(ground[:, :, 2]).resize((MNX, MNY))) > 128

PALETTES = {
    'ALAMO SQUARE': dict(cyp=.67, pine=.10, nzx=.08, gum=.05, hoak=.05, palm=.03, mag=.02),
    'MISSION DOLORES PARK': dict(palm=.22, cyp=.22, mag=.12, plane=.10, pine=.08, nzx=.08, bris=.06, gum=.06, oak=.06),
    'LAFAYETTE PARK': dict(cyp=.35, pine=.20, aca=.15, gum=.12, nzx=.08, redgum=.05, oak=.05),
    'DUBOCE PARK': dict(plane=.30, cyp=.20, nzx=.15, mag=.10, bris=.10, oak=.15),
    'WASHINGTON SQUARE': dict(cyp=.35, plane=.25, palm=.10, nzx=.15, mag=.15),
    'UNION SQUARE': dict(palm=.6, plane=.2, mag=.2),
    'SOUTH PARK': dict(plane=.4, nzx=.2, mag=.2, bris=.2),
    'PRECITA PARK': dict(cyp=.25, plane=.25, nzx=.15, oak=.15, mag=.1, bris=.1),
    'HUNTINGTON PARK': dict(cyp=.30, plane=.25, mag=.20, nzx=.15, vbox=.10),
    'COLUMBIA SQUARE': dict(plane=.4, nzx=.3, bris=.3),
    'JEFFERSON SQUARE': dict(cyp=.35, pine=.20, gum=.15, nzx=.15, oak=.15),
    'HAMILTON RECREATION CENTER': dict(cyp=.30, pine=.20, plane=.20, nzx=.15, oak=.15),
    'MCKINLEY SQUARE': dict(cyp=.35, pine=.25, gum=.25, oak=.15),
    'BERNAL HEIGHTS PARK': dict(gum=.5, cyp=.3, pine=.2),
}
DEFAULT = dict(cyp=.26, pine=.14, gum=.10, plane=.09, nzx=.07, oak=.07, aca=.06, red=.05, bris=.05, mag=.04, redgum=.04, vbox=.03)
# open spaces that are grass, scrub or rock on top: edge trees only
EDGE_ONLY = {'MARINA GREEN', 'TWIN PEAKS', 'CORONA HEIGHTS', 'GRANDVIEW PARK', 'BERNAL HEIGHTS PARK', 'TANK HILL', 'BILLY GOAT HILL',
             'KITE HILL', 'DOUGLASS PLAYGROUND', 'POTRERO HILL RECREATION CENTER', 'BAYVIEW PARK', 'HAWK HILL', 'ROCK OUTCROPPING',
             'CIVIC CENTER PLAZA', 'JUSTIN HERMAN PLAZA', 'CANDLESTICK POINT', 'HERON\'S HEAD PARK', 'INDIA BASIN SHORELINE PARK'}
parkM = park4 & ~standMask & ~water4 & ~sandR
edge = distance_transform_edt(parkM) * MRES
n1 = len(ax)
def plant(spacing, cond, drop):
    gx = np.arange(MX0, MX0 + MNX * MRES, spacing); gy = np.arange(MY0, MY0 + MNY * MRES, spacing)
    G = np.array(np.meshgrid(gx, gy)).reshape(2, -1).T
    G = G + rng.uniform(-spacing * 0.42, spacing * 0.42, G.shape)
    r, c = m_idx(G[:, 0], G[:, 1])
    k = parkM[r, c] & (d_road[r, c] > 2.5) & (h_at(G[:, 0], G[:, 1]) > 1.0) & (rng.random(len(G)) > drop)
    G = G[k]; r, c = r[k], c[k]
    k = cond(G, r, c); return G[k], r[k], c[k]
edge_only = np.array([n.upper() in EDGE_ONLY for n in names])
rows_ = []
# 1) rows along the park edges and paths
G1 = plant(8.0, lambda G, r, c: (edge[r, c] >= 2.0) & (edge[r, c] <= 11), 0.08)
# 2) groves inside, leaving lawns and playfields open
G2 = plant(7.0, lambda G, r, c: (edge[r, c] > 11) & (noise_at(G[:, 0], G[:, 1]) > 0.3) & ~edge_only[nameR[r, c]], 0.1)
for G, r, c in (G1, G2):
    if len(G) == 0: continue
    dd, _ = street_kd.query(G); keep = dd > 3.5
    for (x, y), rr, cc in zip(G[keep], r[keep], c[keep]):
        nm = names[nameR[rr, cc]]
        mix = PALETTES.get(nm.upper(), DEFAULT)
        keys = list(mix); pp = np.array([mix[k] for k in keys]); pp /= pp.sum()
        sp = keys[rng.choice(len(keys), p=pp)]
        ax.append(x); ay.append(y); aq.append(SP[sp]); adbh.append(float(np.clip(rng.gamma(4, 6), 6, 60)))
        st.append(nm.title() if nm else 'Park')
print('park trees', len(ax) - n1)
print('approx trees', len(ax))

# ---------------- combine ----------------
allX = np.r_[X, ax]; allY = np.r_[Y, ay]; allQ = qs + aq; allD = np.r_[dbh, adbh]
allF = np.r_[flags, np.ones(len(ax), np.uint8)]
src = list(range(len(rows))) + [-(k + 1) for k in range(len(ax))]

# species table
cnt = collections.Counter(allQ)
species = sorted(cnt, key=lambda q: -cnt[q])
sid = {q: i for i, q in enumerate(species)}
def split_q(q):
    a, _, b = q.partition('::'); return a.strip(), b.strip()
sp_out = []
street_cnt = collections.Counter(qs)
for q in species:
    sci, com = split_q(q)
    sp_out.append({'q': q, 'sci': sci, 'common': com, 'n': street_cnt.get(q, 0), 'na': cnt[q] - street_cnt.get(q, 0)})

# sort by meta chunk (1 km) so metadata lives in contiguous files
MC = 1000.0
mcx = np.floor(allX / MC).astype(int); mcy = np.floor(allY / MC).astype(int)
order = np.lexsort((allY, allX, mcy, mcx))
allX, allY, allD, allF = allX[order], allY[order], allD[order], allF[order]
allS = np.array([sid[allQ[i]] for i in order], np.uint16); src = [src[i] for i in order]
mcx, mcy = mcx[order], mcy[order]

N = len(allX)
xi = np.round(allX * 2).astype('<i2'); yi = np.round(allY * 2).astype('<i2')
with open(OUT + '/trees.bin', 'wb') as f:
    f.write(np.array([N], '<u4').tobytes()); f.write(xi.tobytes()); f.write(yi.tobytes())
    f.write(allS.astype('<u2').tobytes()); f.write(np.clip(np.round(allD), 0, 255).astype(np.uint8).tobytes()); f.write(allF.tobytes())
json.dump(sp_out, open(OUT + '/species.json', 'w'), separators=(',', ':'))

os.makedirs(OUT + '/meta', exist_ok=True)
for f_ in glob.glob(OUT + '/meta/*.json'): os.remove(f_)
idx = {}
keys = list(zip(mcx, mcy)); start = 0
def clean_date(s):
    if not s: return ''
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s) or None
    if m: return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m: return f'{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
    return s[:10]
i = 0
while i < N:
    k = keys[i]; j = i
    recs = []
    while j < N and keys[j] == k:
        s = src[j]
        if s >= 0:
            r = rows[s]
            recs.append([int(r['TreeID']), r['qAddress'], clean_date(r['PlantDate']), r['qSiteInfo'], r['qCaretaker'], r['qLegalStatus'], r['qSpecies'].strip(), round(float(r['Latitude']), 6), round(float(r['Longitude']), 6)])
        else:
            recs.append(st[-s - 1] if s < 0 and st else 0)
        j += 1
    name = f'{k[0]}_{k[1]}'
    json.dump(recs, open(f'{OUT}/meta/{name}.json', 'w'), separators=(',', ':'))
    idx[name] = [i, j - i]
    i = j
json.dump(idx, open(OUT + '/meta/index.json', 'w'))
print('total', N, 'species', len(species), 'meta files', len(idx))
