"""OSM roads -> world frame, chained polylines, filtered, chunked binary files."""
import json, glob, os, struct, collections, numpy as np
from common import *

TYPES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street',
         'service', 'pedestrian', 'track', 'path', 'footway', 'cycleway', 'steps']
TID = {t: i for i, t in enumerate(TYPES)}

H = np.load(RAW + '/H.npy'); park4 = np.load(RAW + '/park4.npy')

def h_at(x, y):
    c = np.clip(((x - GX0) / GRES).astype(int), 0, GNX - 1); r = np.clip((GNY - 1 - (y - GY0) / GRES).astype(int), 0, GNY - 1)
    return H[r, c]

def park_at(x, y):
    c = np.clip(((x - MX0) / MRES).astype(int), 0, MNX - 1); r = np.clip((MNY - 1 - (y - MY0) / MRES).astype(int), 0, MNY - 1)
    return park4[r, c]

segs = collections.defaultdict(set)  # (way,type,width) -> set of segments
for f in glob.glob(RAW + '/tiles/*.json'):
    for way, typ, w, pts, br in json.load(open(f))['roads']:
        if typ not in TID: continue
        a = tuple(np.round(pts[0], 1)); b = tuple(np.round(pts[-1], 1))
        if a == b: continue
        segs[(way, typ, w)].add((a, b) if a < b else (b, a))

def chain(seglist):
    adj = collections.defaultdict(list)
    for i, (a, b) in enumerate(seglist):
        adj[a].append((i, b)); adj[b].append((i, a))
    used = [False] * len(seglist); lines = []
    # start from endpoints (degree != 2) first
    starts = [p for p, l in adj.items() if len(l) != 2] + list(adj.keys())
    for s in starts:
        for i, nb in adj[s]:
            if used[i]: continue
            used[i] = True; line = [s, nb]; cur = nb
            while True:
                nxt = [(j, q) for j, q in adj[cur] if not used[j]]
                if len(adj[cur]) != 2 or not nxt: break
                j, q = nxt[0]; used[j] = True; line.append(q); cur = q
            lines.append(line)
    return lines

out = collections.defaultdict(list)
kept = collections.Counter()
for (way, typ, w), ss in segs.items():
    for line in chain(list(ss)):
        P = osm2w(np.array(line))
        x, y = P[:, 0], P[:, 1]
        h = h_at(x, y)
        # sidewalks: footways/cycleways only inside parks
        if typ in ('footway', 'cycleway'):
            inpark = park_at(x, y)
            if inpark.mean() < 0.5: continue
        # split where over water
        on = h > 0.5
        runs = []; cur = []
        for k in range(len(P)):
            if on[k]: cur.append(P[k])
            else:
                if len(cur) >= 2: runs.append(cur)
                cur = []
        if len(cur) >= 2: runs.append(cur)
        for run in runs:
            run = np.array(run)
            mid = run.mean(0)
            key = (int(np.floor(mid[0] / CHUNK)), int(np.floor(mid[1] / CHUNK)))
            out[key].append((TID[typ], w, run)); kept[typ] += 1

pack = bytearray()
index = []
total = 0
for (cx, cy), items in out.items():
    ox, oy = cx * CHUNK, cy * CHUNK
    buf = bytearray()
    buf += struct.pack('<I', len(items))
    for t, w, run in items:
        q = np.round((run - [ox, oy]) * 10).astype(np.int32)
        q = np.clip(q, -32768, 32767).astype('<i2')
        buf += struct.pack('<BBH', t, min(255, int(round(w * 4))), len(run))
        buf += q.tobytes()
    index.append([cx, cy, len(pack), len(buf)]); pack += buf; total += len(buf)
open(OUT + '/roads.pack', 'wb').write(bytes(pack))
json.dump({'types': TYPES, 'chunks': index}, open(OUT + '/roads.json', 'w'))
print(kept, 'chunks', len(index), 'bytes', total)

# also export simplified polylines for the 2D map renderer
mp = []
for items in out.values():
    for t, w, run in items: mp.append((t, w, run))
import pickle; pickle.dump(mp, open(RAW + '/roads_world.pkl', 'wb'))
