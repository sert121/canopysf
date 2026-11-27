#!/usr/bin/env bash
# Downloads the source datasets into pipeline/raw (public GitHub mirrors of the official data).
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p raw/tiles; cd raw
# SF Public Works Street Tree List (DataSF tkzw-k3nq), mirrored daily by simonw/sf-tree-history
curl -sL -o trees.csv https://raw.githubusercontent.com/simonw/sf-tree-history/main/Street_Tree_List.csv
# SF 5-ft elevation contours (DataSF), packaged by keplergl/kepler.gl-data
curl -sL -o kc.json https://raw.githubusercontent.com/keplergl/kepler.gl-data/master/sfcontour/data.json
# DataSF street centrelines, city lands, neighborhoods, supervisor districts (burritojustice/sf-blocks)
B=https://raw.githubusercontent.com/burritojustice/sf-blocks/main/data
curl -sL -o streets.csv $B/sf_streets.csv
for f in boundaries/supervisor_districts.geojson boundaries/sf_find_neighborhoods.geojson layers/lands.geojson; do curl -sL -o "$(basename $f)" "$B/$f"; done
# OpenStreetMap roads/parks/water, tiled (bnovc/san-francisco, from a BBBike SF extract)
R=https://raw.githubusercontent.com/bnovc/san-francisco/main/public/data/city
curl -sL -o cityindex.json $R/index.json
python3 -c "import json;[print(t[2]) for t in json.load(open('cityindex.json'))['tiles']]" | xargs -P 8 -I{} curl -sL -o "tiles/{}" "$R/{}"
echo "done"
