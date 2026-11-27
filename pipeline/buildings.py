"""OSM building footprints (bnovc tiles) -> world frame, 500 m chunks, one packed binary.
Record: uint16 nverts, uint16 height_dm, uint8 flags(1 = height from OSM), then nverts * (int16 x_dm, int16 y_dm) relative to chunk origin."""
import json, glob, struct, collections, numpy as np
from common import *
seen = set(); chunks = collections.defaultdict(list)
for f in glob.glob(RAW + '/tiles/*.json'):
    for bid, ring, h, src in json.load(open(f)).get('buildings', []):
        if bid in seen or len(ring) < 3: continue
        seen.add(bid)
        P = osm2w(np.array(ring))
        if np.allclose(P[0], P[-1]): P = P[:-1]
        if len(P) < 3: continue
        c = P.mean(0)
        chunks[(int(np.floor(c[0] / CHUNK)), int(np.floor(c[1] / CHUNK)))].append((P, float(h or 10), 1 if 'osm' in str(src) else 0))
pack = bytearray(); index = []
for (cx, cy), items in chunks.items():
    buf = bytearray(struct.pack('<I', len(items)))
    for P, h, fl in items:
        q = np.clip(np.round((P - [cx * CHUNK, cy * CHUNK]) * 10), -32768, 32767).astype('<i2')
        buf += struct.pack('<HHB', len(P), min(65535, int(h * 10)), fl) + q.tobytes()
    index.append([cx, cy, len(pack), len(buf)]); pack += buf
open(OUT + '/buildings.pack', 'wb').write(bytes(pack))
json.dump(index, open(OUT + '/buildings.json', 'w'))
print(len(seen), 'buildings', len(index), 'chunks', len(pack), 'bytes')
