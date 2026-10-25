from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "src", "renderer", "src", "assets")
BUILD = os.path.join(ROOT, "build")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(BUILD, exist_ok=True)

# ---------- helpers ----------
def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)

def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))

# ---------- Minecraft skin ----------
W = H = 64
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

SKIN = (222, 177, 143, 255)
SKIN_D = (192, 145, 112, 255)
SKIN_L = (238, 197, 164, 255)
HAIR = (22, 18, 24, 255)
HAIR_L = (48, 36, 44, 255)
RED = (194, 34, 54, 255)
RED_D = (128, 20, 36, 255)
RED_L = (255, 82, 94, 255)
BLACK = (17, 15, 20, 255)
BLACK_L = (38, 34, 43, 255)
STEEL = (92, 96, 112, 255)
STEEL_L = (142, 148, 168, 255)
WHITE = (240, 234, 225, 255)
EYE = (255, 66, 74, 255)

def rect(x, y, w, h, c):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=c)

# --- head base ---
# top
rect(8, 0, 8, 8, HAIR)
rect(9, 1, 3, 2, HAIR_L)
# bottom
rect(16, 0, 8, 8, SKIN_D)
# right side (character's right)
rect(0, 8, 8, 8, SKIN)
# front
rect(8, 8, 8, 8, SKIN)
# left side
rect(16, 8, 8, 8, SKIN_D)
# back
rect(24, 8, 8, 8, HAIR)
# face details: front 8x8
# hair fringe top 2 rows
rect(8, 8, 8, 2, HAIR)
rect(8, 9, 2, 2, HAIR)
rect(14, 9, 2, 3, HAIR)
# eyebrows
rect(9, 10, 2, 1, HAIR)
rect(13, 10, 2, 1, HAIR)
# eyes glowing
rect(9, 11, 2, 1, EYE)
rect(13, 11, 2, 1, EYE)
# pupils
img.putpixel((10, 11), (255, 210, 180, 255))
img.putpixel((13, 11), (255, 210, 180, 255))
# nose shadow
rect(11, 12, 2, 1, SKIN_D)
# mouth
rect(10, 14, 4, 1, (120, 68, 66, 255))
# scar
rect(9, 12, 1, 2, (176, 104, 92, 180))
# side face shading
rect(0, 10, 2, 5, SKIN_D)
rect(21, 10, 3, 5, shade(SKIN_D, 0.9))
# back hair highlight
rect(25, 9, 5, 2, HAIR_L)
# ears
rect(8, 12, 1, 2, SKIN_D)
rect(15, 12, 1, 2, SKIN_D)

# hat / hair overlay (layer 2)
# hood rim, transparent inside except edges
rect(8, 40, 8, 2, HAIR)
rect(8, 40, 2, 8, HAIR)
rect(14, 40, 2, 8, HAIR)
rect(9, 41, 1, 3, HAIR_L)
# side overlays subtle
rect(0, 40, 8, 2, HAIR)
rect(24, 40, 8, 2, HAIR)

# --- torso ---
# top
rect(20, 16, 8, 4, BLACK_L)
# bottom
rect(28, 16, 8, 4, BLACK)
# right side
rect(16, 20, 4, 12, BLACK_L)
# front
rect(20, 20, 8, 12, BLACK)
# left side
rect(28, 20, 4, 12, shade(BLACK_L, 0.92))
# back
rect(32, 20, 8, 12, BLACK_L)

# jacket front details
rect(20, 20, 8, 2, RED_D)
rect(21, 22, 2, 9, RED_D)
rect(25, 22, 2, 9, RED_D)
rect(23, 22, 2, 9, BLACK_L)
# zipper
rect(23, 23, 1, 8, STEEL_L)
# chest emblem: flame/E
rect(22, 26, 4, 3, RED)
rect(23, 25, 2, 1, RED_L)
rect(22, 29, 1, 1, RED_D)
rect(25, 29, 1, 1, RED_D)
# belt
rect(20, 30, 8, 2, shade(BLACK, 0.7))
rect(24, 30, 1, 2, STEEL_L)
rect(26, 30, 1, 2, STEEL_L)
# jacket sides
rect(16, 20, 2, 2, RED_D)
rect(30, 27, 2, 3, RED_D)
# back emblem
rect(34, 24, 4, 4, RED_D)
rect(35, 23, 2, 2, RED)
rect(35, 27, 2, 1, RED_L)

# jacket overlay layer: collar + trim
rect(20, 52, 8, 1, RED)
rect(20, 52, 1, 6, RED)
rect(27, 52, 1, 6, RED)
rect(16, 52, 4, 1, RED)
rect(28, 52, 4, 1, RED)
rect(32, 52, 8, 1, RED)

# --- right arm (viewer right / character left?) classic layout ---
rect(44, 16, 4, 4, BLACK_L)   # top
rect(48, 16, 4, 4, BLACK)     # bottom
rect(40, 20, 4, 12, BLACK_L)  # outer
rect(44, 20, 4, 12, BLACK)    # front
rect(48, 20, 4, 12, BLACK_L)  # inner
rect(52, 20, 4, 12, shade(BLACK_L, .9))  # back
# sleeve red trim + hand
rect(44, 28, 4, 2, RED_D)
rect(44, 20, 4, 2, RED_D)
rect(44, 30, 4, 2, SKIN)
rect(40, 30, 4, 2, SKIN_D)
rect(48, 30, 4, 2, SKIN_D)
rect(52, 30, 4, 2, SKIN_D)
# overlay sleeve
rect(44, 52, 4, 1, RED)
rect(40, 52, 4, 1, RED)

# --- left arm ---
rect(36, 48, 4, 4, BLACK_L)
rect(40, 48, 4, 4, BLACK)
rect(32, 52, 4, 12, BLACK_L)
rect(36, 52, 4, 12, BLACK)
rect(40, 52, 4, 12, BLACK_L)
rect(44, 52, 4, 12, shade(BLACK_L, .9))
rect(36, 60, 4, 2, RED_D)
rect(36, 52, 4, 2, RED_D)
rect(36, 62, 4, 2, SKIN)
rect(32, 62, 4, 2, SKIN_D)
rect(40, 62, 4, 2, SKIN_D)
rect(44, 62, 4, 2, SKIN_D)

# --- right leg ---
rect(4, 16, 4, 4, BLACK_L)
rect(8, 16, 4, 4, BLACK)
rect(0, 20, 4, 12, BLACK)
rect(4, 20, 4, 12, BLACK_L)
rect(8, 20, 4, 12, BLACK)
rect(12, 20, 4, 12, shade(BLACK_L, .88))
# boots
rect(4, 28, 4, 4, RED_D)
rect(0, 28, 4, 4, shade(RED_D, .8))
rect(8, 28, 4, 4, shade(RED_D, .8))
rect(12, 28, 4, 4, RED_D)
rect(4, 30, 4, 2, RED)
rect(0, 30, 4, 2, shade(RED, .8))
# overlay
rect(4, 52, 4, 1, RED_D)
rect(0, 52, 4, 1, RED_D)

# --- left leg ---
rect(20, 48, 4, 4, BLACK_L)
rect(24, 48, 4, 4, BLACK)
rect(16, 52, 4, 12, BLACK)
rect(20, 52, 4, 12, BLACK_L)
rect(24, 52, 4, 12, BLACK)
rect(28, 52, 4, 12, shade(BLACK_L, .88))
rect(20, 60, 4, 4, RED_D)
rect(16, 60, 4, 4, shade(RED_D, .8))
rect(24, 60, 4, 4, shade(RED_D, .8))
rect(28, 60, 4, 4, RED_D)
rect(20, 62, 4, 2, RED)
rect(16, 62, 4, 2, shade(RED, .8))

# tiny noise/speckle on cloth
random.seed(7)
for y in range(20, 32):
    for x in range(20, 28):
        if img.getpixel((x, y))[3] and random.random() < 0.12:
            r, g, b, a = img.getpixel((x, y))
            img.putpixel((x, y), shade((r, g, b), 1.18) + (a,))

img.save(os.path.join(ASSETS, "ember-skin.png"))

# ---------- cape ----------
cape = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
cd = ImageDraw.Draw(cape)
# front face 10x16 at (1,1)
cd.rectangle([1, 1, 10, 16], fill=(24, 16, 20, 255))
for y in range(1, 17):
    t = (y - 1) / 15
    c = mix((53, 19, 27), (12, 9, 13), t)
    cd.line([(1, y), (10, y)], fill=c + (255,))
# red edges
cd.line([(1, 1), (1, 16)], fill=(168, 28, 45, 255))
cd.line([(10, 1), (10, 16)], fill=(100, 16, 28, 255))
# glowing sigil
for x, y, c in [
    (5, 4, (255, 60, 70, 255)), (6, 4, (255, 60, 70, 255)),
    (4, 5, (214, 38, 56, 255)), (5, 5, (255, 96, 90, 255)), (6, 5, (255, 96, 90, 255)), (7, 5, (214, 38, 56, 255)),
    (5, 6, (255, 60, 70, 255)), (6, 6, (255, 60, 70, 255)),
    (4, 7, (214, 38, 56, 255)), (5, 7, (255, 96, 90, 255)), (6, 7, (255, 96, 90, 255)), (7, 7, (214, 38, 56, 255)),
    (5, 8, (255, 60, 70, 255)), (6, 8, (255, 60, 70, 255)),
    (5, 9, (190, 30, 48, 255)),
    (4, 10, (255, 60, 70, 255)), (5, 10, (255, 120, 100, 255)), (6, 10, (255, 120, 100, 255)), (7, 10, (255, 60, 70, 255)),
    (5, 11, (214, 38, 56, 255)), (6, 11, (214, 38, 56, 255)),
]:
    cd.point((x, y), fill=c)
# top strip / shoulder (1,0)-(10,0)? add subtle
cd.rectangle([1, 0, 10, 0], fill=(38, 22, 27, 255))
cape.save(os.path.join(ASSETS, "ember-cape.png"))

# ---------- app icon ----------
S = 1024
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# rounded dark plate
plate = Image.new("RGBA", (S, S), (0, 0, 0, 0))
pd = ImageDraw.Draw(plate)
pd.rounded_rectangle([32, 32, S - 32, S - 32], radius=210, fill=(12, 8, 10, 255))
# radial warm glow
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for i in range(220, 0, -1):
    r = int(430 * i / 220)
    a = int(2.2 * (220 - i) * 0.55)
    gd.ellipse([S // 2 - r, S // 2 - r - 40, S // 2 + r, S // 2 + r - 40], fill=(255, 44, 66, max(0, a)))
glow = glow.filter(ImageFilter.GaussianBlur(70))
icon = Image.alpha_composite(icon, plate)
icon = Image.alpha_composite(icon, glow)

d = ImageDraw.Draw(icon)
# stylized E / flame mark
# outer hex / diamond ring
ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring)
cx, cy = S // 2, S // 2 - 6
for rr, wdt, alpha in [(300, 5, 90), (336, 2, 45)]:
    rd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(255, 82, 94, alpha), width=wdt)
icon = Image.alpha_composite(icon, ring)

d = ImageDraw.Draw(icon)
# E body as bold geometric strokes
w = 54
# vertical
d.rounded_rectangle([cx - 172, cy - 222, cx - 172 + 92, cy + 214], radius=18, fill=(240, 226, 222, 255))
# top arm
d.rounded_rectangle([cx - 172, cy - 222, cx + 132, cy - 222 + 92], radius=18, fill=(240, 226, 222, 255))
# middle arm
d.rounded_rectangle([cx - 172, cy - 42, cx + 52, cy - 42 + 84], radius=16, fill=(255, 58, 76, 255))
# bottom arm
d.rounded_rectangle([cx - 172, cy + 122, cx + 148, cy + 122 + 92], radius=18, fill=(240, 226, 222, 255))
# ember slash cut through bottom
slash = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(slash)
sd.polygon([(cx + 16, cy + 118), (cx + 148, cy + 118), (cx + 148, cy + 214), (cx - 32, cy + 214)], fill=(12, 8, 10, 0))
# glowing accent line
d.line([(cx - 172, cy + 122), (cx + 148, cy + 122)], fill=(255, 80, 88, 255), width=8)
# small spark dots
for x, y, r, a in [(760, 270, 8, 220), (798, 316, 4, 140), (238, 742, 6, 180), (690, 810, 3, 120)]:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 92, 96, a))

# inner vignette
vig = Image.new("L", (S, S), 0)
vd = ImageDraw.Draw(vig)
vd.rounded_rectangle([32, 32, S - 32, S - 32], radius=210, fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(1))
# shadow border
bd = ImageDraw.Draw(icon)
bd.rounded_rectangle([32, 32, S - 32, S - 32], radius=210, outline=(255, 255, 255, 20), width=4)

icon.save(os.path.join(BUILD, "icon.png"))
icon.resize((512, 512), Image.LANCZOS).save(os.path.join(ASSETS, "logo.png"))
icon.resize((64, 64), Image.LANCZOS).save(os.path.join(BUILD, "tray.png"))
icon.save(os.path.join(BUILD, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# ---------- social/cover texture? ----------
# A dark ember noise tile for backgrounds
noise = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
random.seed(42)
px = noise.load()
for y in range(512):
    for x in range(512):
        if random.random() < 0.06:
            v = random.randint(120, 255)
            px[x, y] = (v, v, v, random.randint(6, 22))
noise.save(os.path.join(ASSETS, "grain.png"))

print("assets generated")

# ---------- ambient dust ----------
# A transparent, tileable dust field used by the background. Drawn at 2x and
# downsampled so the tiny particles stay soft instead of aliasing.
S = 1024
dust = Image.new("RGBA", (S * 2, S * 2), (0, 0, 0, 0))
dd = ImageDraw.Draw(dust)
rng = random.Random(20261023)
palette = [(255, 235, 226), (255, 120, 130), (150, 205, 255), (255, 255, 255)]
for _ in range(260):
    x = rng.uniform(0, S * 2)
    y = rng.uniform(0, S * 2)
    r = rng.choice([0.5, 0.7, 0.9, 1.2, 1.6, 2.1]) * 2
    c = rng.choice(palette)
    a = rng.randint(25, 110)
    dd.ellipse([x - r, y - r, x + r, y + r], fill=(*c, a))
for _ in range(18):
    x = rng.uniform(20, S * 2 - 20)
    y = rng.uniform(20, S * 2 - 20)
    arm = rng.uniform(3, 8) * 2
    c = rng.choice(palette)
    a = rng.randint(40, 120)
    dd.line([x - arm, y, x + arm, y], fill=(*c, a), width=1)
    dd.line([x, y - arm, x, y + arm], fill=(*c, a), width=1)
dust = dust.resize((S, S), Image.LANCZOS)
dust.save(os.path.join(ASSETS, "dust.png"), optimize=True)
print("wrote dust.png")
