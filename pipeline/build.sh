#!/usr/bin/env bash
# Rebuild public/data from the source datasets.
set -euo pipefail
cd "$(dirname "$0")"
[ -f raw/trees.csv ] || ./fetch.sh
[ -f osm_frame.npy ] || python3 align.py
python3 terrain.py && python3 roads.py && python3 trees.py && python3 mapimg.py && python3 streets.py && python3 buildings.py
cd ../public/data
for f in terrain.u16 trees.bin roads.pack buildings.pack; do gzip -9 -f $f && base64 -w0 $f.gz > $f.gz.b64.txt && rm $f.gz; done
echo "public/data rebuilt"
