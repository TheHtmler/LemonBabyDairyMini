#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
PALETTE = {
    "primary": "#FFB800",
    "primary_dark": "#E0A000",
    "bg_top": "#FFF9E6",
    "bg_bottom": "#FFFFFF",
    "card": "#FFFFFF",
    "line": "#F0E2B6",
    "text": "#333333",
    "muted": "#666666",
}

FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]

def load_font(size):
    for path in FONT_CANDIDATES:
        p = Path(path)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()

def vertical_gradient(size, top, bottom):
    base = Image.new("RGB", size, top)
    top_r, top_g, top_b = Image.new("RGB", (1,1), top).getpixel((0,0))
    bot_r, bot_g, bot_b = Image.new("RGB", (1,1), bottom).getpixel((0,0))
    draw = ImageDraw.Draw(base)
    for y in range(size[1]):
        t = y / (size[1]-1)
        r = int(top_r + (bot_r-top_r)*t)
        g = int(top_g + (bot_g-top_g)*t)
        b = int(top_b + (bot_b-top_b)*t)
        draw.line([(0,y),(size[0],y)], fill=(r,g,b))
    return base

def rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

def shadow_rect(img, xy, radius=24, offset=(0,8), shadow_color=(0,0,0,40)):
    x0,y0,x1,y1 = xy
    shadow = Image.new("RGBA", img.size, (0,0,0,0))
    sd = ImageDraw.Draw(shadow)
    sx0, sy0 = x0+offset[0], y0+offset[1]
    sx1, sy1 = x1+offset[0], y1+offset[1]
    sd.rounded_rectangle([sx0,sy0,sx1,sy1], radius=radius, fill=shadow_color)
    img.alpha_composite(shadow)


def fit_cover(img, size):
    # cover crop
    w, h = img.size
    tw, th = size
    scale = max(tw/w, th/h)
    nw, nh = int(w*scale), int(h*scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw)//2
    top = (nh - th)//2
    return resized.crop((left, top, left+tw, top+th))


def draw_title(draw, step, title, subtitle):
    font_step = load_font(28)
    font_title = load_font(54)
    font_sub = load_font(30)
    draw.text((60, 80), f"STEP {step}", font=font_step, fill=PALETTE["primary"])
    draw.text((60, 120), title, font=font_title, fill=PALETTE["text"])
    draw.text((60, 190), subtitle, font=font_sub, fill=PALETTE["muted"])


def paste_panel(canvas, img_path, box, label=None):
    draw = ImageDraw.Draw(canvas)
    shadow_rect(canvas, box, radius=22)
    rounded_rect(draw, box, radius=22, fill=PALETTE["card"], outline=PALETTE["line"], width=2)
    # inner padding
    x0,y0,x1,y1 = box
    pad = 14
    inner = (x0+pad, y0+pad, x1-pad, y1-pad)
    img = Image.open(img_path).convert("RGB")
    fitted = fit_cover(img, (inner[2]-inner[0], inner[3]-inner[1]))
    canvas.paste(fitted, (inner[0], inner[1]))
    if label:
        font = load_font(26)
        tw = draw.textlength(label, font=font)
        lx = x0 + 18
        ly = y0 + 12
        # label bg
        draw.rounded_rectangle([lx-8, ly-6, lx+tw+16, ly+30], radius=12, fill="#FFF3CC", outline=PALETTE["primary"], width=1)
        draw.text((lx, ly), label, font=font, fill=PALETTE["text"])


def make_slide(step, title, subtitle, panels, out_path):
    canvas = vertical_gradient((W, H), PALETTE["bg_top"], PALETTE["bg_bottom"]).convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    draw_title(draw, step, title, subtitle)
    for p in panels:
        paste_panel(canvas, **p)
    canvas.save(out_path)


def main():
    root = Path("docs/demo-images")
    out_dir = Path("docs/onboarding_v2")
    out_dir.mkdir(parents=True, exist_ok=True)

    slides = [
        {
            "step": 1,
            "title": "角色与建档",
            "subtitle": "先完成身份与宝宝信息",
            "panels": [
                {"img_path": root/"角色选择页.png", "box": (60, 260, 1020, 860), "label": "角色选择"},
                {"img_path": root/"宝宝信息管理1.png", "box": (60, 900, 1020, 1700), "label": "宝宝信息"},
            ],
            "out": out_dir/"01_role_profile.png"
        },
        {
            "step": 2,
            "title": "配奶设置",
            "subtitle": "普奶与特奶参数先配置",
            "panels": [
                {"img_path": root/"奶粉设置-普奶.png", "box": (60, 260, 1020, 900), "label": "普奶设置"},
                {"img_path": root/"奶粉设置-特奶.png", "box": (60, 940, 1020, 1700), "label": "特奶设置"},
            ],
            "out": out_dir/"02_nutrition.png"
        },
        {
            "step": 3,
            "title": "添加喂奶",
            "subtitle": "记录体积与配方，自动汇总",
            "panels": [
                {"img_path": root/"添加喂奶1.png", "box": (60, 260, 1020, 780), "label": "喂奶记录"},
                {"img_path": root/"添加喂奶2.png", "box": (60, 800, 1020, 1260), "label": "补充信息"},
                {"img_path": root/"摄入汇总1.png", "box": (60, 1280, 1020, 1700), "label": "今日汇总"},
            ],
            "out": out_dir/"03_feeding.png"
        },
        {
            "step": 4,
            "title": "添加食物与用药",
            "subtitle": "食物/药物一并记录",
            "panels": [
                {"img_path": root/"添加食物1.png", "box": (60, 260, 1020, 820), "label": "添加食物"},
                {"img_path": root/"添加食物2.png", "box": (60, 840, 1020, 1320), "label": "营养预览"},
                {"img_path": root/"药物管理1.png", "box": (60, 1340, 1020, 1700), "label": "用药记录"},
            ],
            "out": out_dir/"04_food_med.png"
        },
        {
            "step": 5,
            "title": "记录与分析",
            "subtitle": "趋势与报告一目了然",
            "panels": [
                {"img_path": root/"数据记录1.png", "box": (60, 260, 1020, 800), "label": "数据记录"},
                {"img_path": root/"分析曲线1.png", "box": (60, 820, 1020, 1300), "label": "趋势分析"},
                {"img_path": root/"报告分析1.png", "box": (60, 1320, 1020, 1700), "label": "报告分析"},
            ],
            "out": out_dir/"05_analysis.png"
        },
    ]

    for s in slides:
        make_slide(s["step"], s["title"], s["subtitle"], s["panels"], s["out"])

if __name__ == "__main__":
    main()
