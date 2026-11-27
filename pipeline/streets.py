"""Street + block index for search: street name -> centroid, and hundred-block -> centroid (world metres)."""
import csv, re, json, collections, numpy as np
from common import *
rows = [r for r in csv.DictReader(open(RAW + '/trees.csv')) if r['Latitude'] and r['PlantType'].lower() == 'tree']
acc = collections.defaultdict(list)
for r in rows:
    m = re.match(r'^\s*(\d+)[A-Za-z]?\s+(.+?)\s*$', r['qAddress'] or '')
    if not m: continue
    num, street = int(m.group(1)), m.group(2).strip()
    street = re.sub(r'\s+', ' ', street).title().strip()
    street = re.sub(r'\b0*(\d+)(St|Nd|Rd|Th)\b', lambda m: m.group(1) + m.group(2).lower(), street)
    x, y = ll2w(float(r['Longitude']), float(r['Latitude']))
    acc[street].append((num // 100 * 100, float(x), float(y)))
out = {}
for s, L in acc.items():
    if len(L) < 3: continue
    a = np.array([(x, y) for _, x, y in L])
    blocks = collections.defaultdict(list)
    for b, x, y in L: blocks[b].append((x, y))
    out[s] = {'c': [round(float(a[:, 0].mean()), 1), round(float(a[:, 1].mean()), 1)], 'n': len(L),
              'b': {str(b): [round(float(np.mean([p[0] for p in v])), 1), round(float(np.mean([p[1] for p in v])), 1)] for b, v in sorted(blocks.items())}}
json.dump(out, open(OUT + '/streets.json', 'w'), separators=(',', ':'))
print(len(out), 'streets')
