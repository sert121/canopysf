# Canopy: San Francisco, tree by tree

An open 3D world of San Francisco made only of its trees, streets and hills. Walk (or fly) anywhere in the city. Point at any tree to see what it is: the species, where it comes from, a few facts, and the city's own record for that tree (address, planting date, trunk size, caretaker, tree ID).

- **194,726 surveyed street trees** on their recorded GPS positions (SF Public Works Street Tree List)
- **44,121 approximate park-forest trees** in Golden Gate Park, the Presidio, Mount Sutro, McLaren Park and other forests. These are modelled from each stand's documented plantings and are labelled "approximate" in the app.
- Streets, paths and stairways from OpenStreetMap; terrain from the city's 5-ft elevation contours
- Every tree is grown procedurally from one of 38 species growth models (Weber–Penn style branching, golden-angle phyllotaxis, crown-envelope shapes, multi-stem trunks, weeping and wind-sheared forms, palms and rosettes), each with three variants and three levels of detail. Plane trees, Brisbane box, New Zealand Christmas trees, Monterey cypress, Canary Island date palms and the rest each have their own silhouette, bark and leaf
- Seasonal colour taken from today's date: ginkgos go gold in November, cherry plums bloom in February
- Field map with fast travel, a field journal of identified species, species search and tracking (glowing trees plus a compass marker), and the city's 244 Landmark Trees
- Four kinds of light (golden hour, Karl the Fog, clear noon, blue dusk) and a generative ambient score

## Rendering engines

Canopy picks its engine at load (`src/gfx/engine.js`):

- **WebGPU** (three.js `WebGPURenderer`, shaders in TSL) wherever the browser ships it: Chrome / Edge 113+ on desktop, Chrome on Android 12+, and Safari 26+ on macOS, iOS and iPadOS.
  - **GPU-driven trees** (`src/gfx/gputrees.js`): all ~195k trees live in GPU storage buffers. Each frame a compute shader frustum-culls them, picks a level of detail, and writes the survivors straight into indirect-draw arguments, so the CPU never touches per-tree data. Full-detail trees reach 170 m and 3D trees reach 2.6 km on desktop (versus 100 m and 1.15 km on WebGL).
  - **Cascaded sun shadows**: a 4096² near cascade plus a wide far cascade (`src/gfx/shadows.js`).
  - **Post chain**: ground-truth ambient occlusion, bloom, and temporal reprojection anti-aliasing, which resolves leaf cut-outs that MSAA can't, then ACES tone mapping (`src/gfx/post.js`).
  - **Quality levels** (`gpuQuality` in `src/platform.js`): ultra for desktop GPUs, high for integrated GPUs, tablet, and mobile.
  - **Shader warm-up**: every pipeline compiles behind the title card.
  - **Device loss**: if the GPU device is lost, the page reloads on the WebGL engine.
- **WebGL 2** (the original hand-written GLSL engine) everywhere else, e.g. iOS 17–18 Safari, where WebGPU is still behind a flag. iOS 17+ iPhones get the medium tier and iPads the high tier.

Force an engine with `?engine=gpu` or `?engine=gl`, and a WebGPU level with `?quality=ultra|high|tablet|mobile`. Effects can be switched off for testing with `?taa=0`, `?gtao=0` or `?bloom=0`.

## Devices

The page detects the device on load (`src/platform.js`): iPhone, iPad, Android phone or tablet, or computer, plus a rough GPU class. It picks a detail tier (resolution, antialiasing, shadow-map size, tree draw distance, buildings radius) and then adapts the resolution live to hold a smooth frame rate. Touch devices get a thumb joystick (push past the ring to run), drag-to-look, tap-to-identify, and Fly / climb / descend / jump buttons. Override with `?quality=low|medium|high` or `?touch=1`. Works on iOS 15+ Safari (WebGL 2); older iOS without native gzip falls back to a bundled inflater.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Controls: `WASD` walk · `Shift` hurry · `F` fly · `Click` inspect a tree · `M` map · `J` journal · `/` search · `T` light · `H` help. On a phone, drag the left side to walk, drag the right side to look, and tap a tree.

## Deploy (Vercel)

It's a static Vite site; `vercel.json` sets the build and cache headers. Run `vercel` or import the repo, and it deploys as-is.

## Data pipeline

`public/data/` is prebuilt. To rebuild it from the latest city data:

```bash
pip install numpy scipy pillow matplotlib
./pipeline/build.sh
```

| Output | Built from |
| --- | --- |
| `trees.bin.gz`, `species.json`, `meta/*.json` | SF Public Works Street Tree List (DataSF `tkzw-k3nq`), via the daily mirror in simonw/sf-tree-history |
| `terrain.u16.gz` (10 m heightmap) | SF 5-ft elevation contours (DataSF), packaged in keplergl/kepler.gl-data |
| `ground.png` (parks, water, sand) | OpenStreetMap park and water areas, SF Rec & Park city lands, supervisor districts (land mask) |
| `roads/*.bin` | OpenStreetMap roads, paths and steps (BBBike extract tiled by bnovc/san-francisco), aligned to DataSF street centrelines (median residual 1.6 m) |
| `map.jpg`, `neighborhoods.json` | All of the above, plus DataSF neighborhoods |

`src/assets/` (leaf clusters and bark) is built by `pipeline/foliage.py` from the EZ-Tree photo sprigs and bark scans.

Preview a lineup of the growth models with `?lab=0&per=2&play` (page through with `lab=1, 2, …`; `&lod=1` for mid detail, `&v=2` for another variant).

World frame: metres, x east, y north, origin at 37.76 N, 122.44 W.

## Credits

Street tree data © City and County of San Francisco (Public Works), published on DataSF under the PDDL. Map data © OpenStreetMap contributors (ODbL). The species notes were written for this project. Park trees are illustrative, not surveyed: Rec & Park doesn't publish its ~131,000-tree inventory, so every park is planted from its documented species mix (e.g. Alamo Square is two-thirds Monterey cypress) with edge rows, groves and open lawns. Leaf sprig photos and bark scans from EZ-Tree by Daniel Greenheck (MIT); bark scans originally from ambientCG and Poly Haven (CC0). Tree architecture follows Weber & Penn, *Creation and Rendering of Realistic Trees* (SIGGRAPH 1995).
