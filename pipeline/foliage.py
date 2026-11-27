# Builds leaf-cluster and bark tiles from EZ-Tree's photographic assets (MIT; bark CC0 from ambientCG/Poly Haven).
# Leaf tiles: RGBA 512, R = normalised luminance, G = 0 (flower mask), B = hue variation, A = coverage.
# Sprigs are fanned out from the stem point so one card reads as a full, gap-free cluster.
import numpy as np, math, os
from PIL import Image
SRC = os.path.join(os.path.dirname(__file__), '..', 'node_modules/@dgreenheck/ez-tree/src/lib/assets')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src/assets')
rng = np.random.default_rng(7)

def sprig(name):
    im = Image.open(f'{SRC}/leaves/{name}_color.png').convert('RGBA')
    return im

def cluster(name, fan, n, scale, out):
    sp = sprig(name)
    W = 1024
    canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    base = (W // 2, W - 20)
    angs = np.linspace(-fan, fan, n) if n > 1 else [0]
    order = sorted(range(n), key=lambda k: abs(angs[k]))[::-1]   # centre sprig drawn last (on top)
    for k in order:
        a = angs[k] + rng.uniform(-6, 6)
        s = scale * (1.0 - 0.18 * abs(angs[k]) / max(fan, 1)) * rng.uniform(0.92, 1.05)
        im = sp.resize((int(1024 * s), int(1024 * s)), Image.LANCZOS)
        if rng.random() < 0.5: im = im.transpose(Image.FLIP_LEFT_RIGHT)
        # pivot at the stem (bottom centre); rotate around it
        big = Image.new('RGBA', (im.width * 2, im.height * 2), (0, 0, 0, 0))
        big.paste(im, (im.width // 2, 0))
        big = big.rotate(-a, resample=Image.BICUBIC, center=(im.width, im.height))
        canvas.alpha_composite(big, (base[0] - im.width, base[1] - im.height))
    bb = canvas.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    w = max(bb[2] - bb[0], bb[3] - bb[1]) + 16
    cx = (bb[0] + bb[2]) // 2
    sq = Image.new('RGBA', (w, w), (0, 0, 0, 0))
    sq.alpha_composite(canvas.crop((cx - w // 2, bb[3] + 8 - w, cx + w // 2, bb[3] + 8)))
    canvas = sq.resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(canvas).astype(np.float32) / 255
    rgb, al = a[..., :3], a[..., 3]
    lum = rgb @ np.array([0.3, 0.59, 0.11])
    m = al > 0.5
    lum = lum / max(1e-3, np.percentile(lum[m], 92)) * 0.88
    hue = np.clip(0.5 + (rgb[..., 0] - rgb[..., 1]) * 2.5, 0, 1)
    o = np.stack([np.clip(lum, 0, 1), np.zeros_like(lum), hue, al], -1)
    # bleed colour into transparent texels so mip-maps don't darken the edges
    img = Image.fromarray((o * 255).astype(np.uint8), 'RGBA').resize((512, 512), Image.LANCZOS)
    img.save(f'{OUT}/{out}.png', optimize=True)

cluster('ash', 40, 5, 0.62, 'leaf_feather')
cluster('aspen', 38, 5, 0.6, 'leaf_small')
cluster('oak', 36, 5, 0.62, 'leaf_oak')
cluster('pine', 45, 6, 0.58, 'leaf_needle')

for name, out in [('oak', 'furrowed'), ('pine', 'plates'), ('willow', 'fiber')]:
    im = Image.open(f'{SRC}/bark/{name}_color_1k.jpg').convert('L').resize((512, 512), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    a = (a - a.mean()) / (a.std() + 1e-3) * 0.17 + (0.72 if name == 'birch' else 0.5)
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(f'{OUT}/bark_{out}.png', optimize=True)
print('ok')
