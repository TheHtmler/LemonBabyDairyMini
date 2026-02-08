#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920

PALETTE = {
    "primary": "#FFB800",
    "primary_dark": "#E0A000",
    "accent": "#FF6B35",
    "bg_top": "#FFF9E6",
    "bg_bottom": "#FFFFFF",
    "card": "#FFFFFF",
    "muted": "#666666",
    "text": "#333333",
    "line": "#F0E2B6",
    "green": "#4CAF50",
    "blue": "#2196F3",
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


def paste_logo(canvas, logo_path, box):
    try:
        logo = Image.open(logo_path).convert("RGBA")
        logo.thumbnail((box[2]-box[0], box[3]-box[1]))
        lx = box[0] + (box[2]-box[0]-logo.size[0])//2
        ly = box[1] + (box[3]-box[1]-logo.size[1])//2
        canvas.alpha_composite(logo, (lx, ly))
    except Exception:
        pass


def draw_badge(draw, center, text, fill, text_color):
    x, y = center
    r = 34
    draw.ellipse([x-r, y-r, x+r, y+r], fill=fill)
    font = load_font(28)
    tw, th = draw.textlength(text, font=font), font.size
    draw.text((x - tw/2, y - th/2 - 2), text, font=font, fill=text_color)


def draw_title(draw, x, y, title, subtitle=None):
    font_title = load_font(56)
    draw.text((x, y), title, font=font_title, fill=PALETTE["text"])
    if subtitle:
        font_sub = load_font(30)
        draw.text((x, y+70), subtitle, font=font_sub, fill=PALETTE["muted"])


def make_slide_base():
    base = vertical_gradient((W, H), PALETTE["bg_top"], PALETTE["bg_bottom"]).convert("RGBA")
    return base


def slide_cover(out_path, logo_path):
    canvas = make_slide_base()
    draw = ImageDraw.Draw(canvas)

    paste_logo(canvas, logo_path, (60, 80, 200, 220))

    draw_title(draw, 60, 260, "MMA宝宝喂养记录", "新手引导 · 5步上手")

    # steps list
    steps = [
        "1. 建宝宝档案",
        "2. 设置营养与用药",
        "3. 今日喂养一键记录",
        "4. 数据与生长趋势",
        "5. 报告分析与分享",
    ]
    font = load_font(34)
    y = 420
    for s in steps:
        draw.rounded_rectangle([60, y, 1020, y+70], radius=24, fill="#FFFFFF", outline=PALETTE["line"], width=2)
        draw.text((90, y+18), s, font=font, fill=PALETTE["text"])
        y += 90

    # Feature chips
    chip_font = load_font(26)
    chips = ["快速记录", "趋势分析", "家庭协作", "专病关注"]
    x = 60
    y = 880
    for c in chips:
        w = int(draw.textlength(c, font=chip_font)) + 40
        draw.rounded_rectangle([x, y, x+w, y+48], radius=24, fill="#FFF3CC", outline=PALETTE["primary"], width=2)
        draw.text((x+20, y+10), c, font=chip_font, fill=PALETTE["text"])
        x += w + 16

    # Bottom card
    shadow_rect(canvas, (60, 1060, 1020, 1760), radius=32)
    rounded_rect(draw, (60, 1060, 1020, 1760), radius=32, fill=PALETTE["card"], outline=PALETTE["line"], width=2)
    draw.text((90, 1100), "新手重点", font=load_font(36), fill=PALETTE["text"])
    bullet_font = load_font(30)
    bullets = [
        "每天记录奶量/特殊配方/加餐",
        "用药时间与剂量一并记录",
        "一周内查看趋势与报告",
    ]
    by = 1160
    for b in bullets:
        draw.ellipse([90, by+10, 104, by+24], fill=PALETTE["primary"])
        draw.text((120, by), b, font=bullet_font, fill=PALETTE["muted"])
        by += 60

    canvas.save(out_path)


def slide_step_profile(out_path, logo_path):
    canvas = make_slide_base()
    draw = ImageDraw.Draw(canvas)
    draw_title(draw, 60, 120, "步骤1  建宝宝档案", "先完善基础信息与喂养目标")
    draw_badge(draw, (950, 150), "1", PALETTE["primary"], "#FFFFFF")

    shadow_rect(canvas, (60, 320, 1020, 930), radius=32)
    rounded_rect(draw, (60, 320, 1020, 930), radius=32, fill=PALETTE["card"], outline=PALETTE["line"], width=2)

    # avatar
    draw.ellipse([110, 380, 230, 500], fill="#FFE7A8", outline=PALETTE["primary"], width=3)
    draw.text((255, 395), "宝宝档案", font=load_font(34), fill=PALETTE["text"])
    draw.text((255, 445), "姓名 · 月龄 · 体重", font=load_font(28), fill=PALETTE["muted"])

    # info rows
    info_font = load_font(30)
    rows = ["喂养类型：专病配方", "过敏/禁忌：已记录", "目标：按医嘱管理摄入"]
    y = 540
    for r in rows:
        draw.rounded_rectangle([110, y, 970, y+70], radius=18, fill="#FFF9E6", outline=PALETTE["line"], width=2)
        draw.text((140, y+18), r, font=info_font, fill=PALETTE["text"])
        y += 90

    # CTA
    draw.rounded_rectangle([110, 840, 970, 900], radius=24, fill=PALETTE["primary"], outline=PALETTE["primary_dark"], width=2)
    draw.text((420, 855), "进入营养设置", font=load_font(28), fill="#FFFFFF")

    # tips
    shadow_rect(canvas, (60, 1000, 1020, 1700), radius=28)
    rounded_rect(draw, (60, 1000, 1020, 1700), radius=28, fill="#FFFFFF", outline=PALETTE["line"], width=2)
    draw.text((90, 1040), "新手提醒", font=load_font(32), fill=PALETTE["text"])
    tips = [
        "录入宝宝基础信息，便于后续分析",
        "设置专病配方与用量目标",
        "可随时在“宝宝信息/营养设置”修改",
    ]
    y = 1100
    tip_font = load_font(28)
    for t in tips:
        draw.ellipse([90, y+10, 104, y+24], fill=PALETTE["primary"])
        draw.text((120, y), t, font=tip_font, fill=PALETTE["muted"])
        y += 58

    canvas.save(out_path)


def slide_step_record(out_path, logo_path):
    canvas = make_slide_base()
    draw = ImageDraw.Draw(canvas)
    draw_title(draw, 60, 120, "步骤2  今日喂养记录", "一键录入奶量/配方/加餐/用药")
    draw_badge(draw, (950, 150), "2", PALETTE["primary"], "#FFFFFF")

    shadow_rect(canvas, (60, 320, 1020, 1120), radius=32)
    rounded_rect(draw, (60, 320, 1020, 1120), radius=32, fill=PALETTE["card"], outline=PALETTE["line"], width=2)

    # buttons
    btn_font = load_font(28)
    btns = [
        ("奶量", "#FFF3CC"),
        ("专病配方", "#E8F4FD"),
        ("加餐", "#FCE4EC"),
        ("用药", "#E8F5E8"),
    ]
    bx, by = 110, 380
    for i, (label, color) in enumerate(btns):
        x0 = bx + (i%2)*430
        y0 = by + (i//2)*140
        draw.rounded_rectangle([x0, y0, x0+360, y0+100], radius=20, fill=color, outline=PALETTE["line"], width=2)
        draw.text((x0+40, y0+30), label, font=btn_font, fill=PALETTE["text"])

    # summary card
    draw.rounded_rectangle([110, 660, 970, 1060], radius=24, fill="#FFF9E6", outline=PALETTE["line"], width=2)
    draw.text((140, 700), "今日汇总", font=load_font(30), fill=PALETTE["text"])
    draw.text((140, 760), "总奶量：720ml", font=load_font(28), fill=PALETTE["muted"])
    draw.text((140, 810), "专病配方：3次", font=load_font(28), fill=PALETTE["muted"])
    draw.text((140, 860), "用药：已记录", font=load_font(28), fill=PALETTE["muted"])

    # tips
    shadow_rect(canvas, (60, 1200, 1020, 1720), radius=28)
    rounded_rect(draw, (60, 1200, 1020, 1720), radius=28, fill="#FFFFFF", outline=PALETTE["line"], width=2)
    draw.text((90, 1240), "新手提醒", font=load_font(32), fill=PALETTE["text"])
    tips = [
        "记录越完整，分析越准确",
        "用药与喂养时间放在同一天录入",
        "支持补录历史记录",
    ]
    y = 1300
    for t in tips:
        draw.ellipse([90, y+10, 104, y+24], fill=PALETTE["primary"])
        draw.text((120, y), t, font=load_font(28), fill=PALETTE["muted"])
        y += 58

    canvas.save(out_path)


def slide_step_trend(out_path, logo_path):
    canvas = make_slide_base()
    draw = ImageDraw.Draw(canvas)
    draw_title(draw, 60, 120, "步骤3  数据与生长趋势", "查看历史记录与关键变化")
    draw_badge(draw, (950, 150), "3", PALETTE["primary"], "#FFFFFF")

    shadow_rect(canvas, (60, 320, 1020, 1120), radius=32)
    rounded_rect(draw, (60, 320, 1020, 1120), radius=32, fill=PALETTE["card"], outline=PALETTE["line"], width=2)

    # chart area
    chart_box = (110, 380, 970, 900)
    draw.rounded_rectangle(chart_box, radius=18, fill="#F8F9FF", outline=PALETTE["line"], width=2)
    # axes
    draw.line([(150, 860), (940, 860)], fill="#D9D9D9", width=3)
    draw.line([(150, 420), (150, 860)], fill="#D9D9D9", width=3)
    # line
    points = [(180, 800), (300, 760), (420, 780), (540, 720), (660, 700), (780, 640), (900, 620)]
    draw.line(points, fill=PALETTE["primary"], width=5)
    for p in points:
        draw.ellipse([p[0]-6, p[1]-6, p[0]+6, p[1]+6], fill=PALETTE["primary"])
    draw.text((170, 430), "摄入趋势", font=load_font(28), fill=PALETTE["text"])
    draw.text((170, 470), "生长记录同步查看", font=load_font(24), fill=PALETTE["muted"])

    # metrics
    draw.rounded_rectangle([110, 930, 450, 1080], radius=18, fill="#FFF9E6", outline=PALETTE["line"], width=2)
    draw.rounded_rectangle([480, 930, 970, 1080], radius=18, fill="#E8F5E8", outline=PALETTE["line"], width=2)
    draw.text((140, 960), "7日平均 710ml", font=load_font(26), fill=PALETTE["text"])
    draw.text((510, 960), "增长趋势 稳定", font=load_font(26), fill=PALETTE["text"])

    # tips
    shadow_rect(canvas, (60, 1200, 1020, 1720), radius=28)
    rounded_rect(draw, (60, 1200, 1020, 1720), radius=28, fill="#FFFFFF", outline=PALETTE["line"], width=2)
    draw.text((90, 1240), "新手提醒", font=load_font(32), fill=PALETTE["text"])
    tips = [
        "关注趋势变化，及时调整记录",
        "成长记录与喂养数据联动",
        "支持按日期快速筛选",
    ]
    y = 1300
    for t in tips:
        draw.ellipse([90, y+10, 104, y+24], fill=PALETTE["primary"])
        draw.text((120, y), t, font=load_font(28), fill=PALETTE["muted"])
        y += 58

    canvas.save(out_path)


def slide_step_report(out_path, logo_path):
    canvas = make_slide_base()
    draw = ImageDraw.Draw(canvas)
    draw_title(draw, 60, 120, "步骤4  报告分析与协作", "形成清晰报告，便于沟通")
    draw_badge(draw, (950, 150), "4", PALETTE["primary"], "#FFFFFF")

    shadow_rect(canvas, (60, 320, 1020, 1120), radius=32)
    rounded_rect(draw, (60, 320, 1020, 1120), radius=32, fill=PALETTE["card"], outline=PALETTE["line"], width=2)

    draw.text((110, 370), "报告摘要", font=load_font(32), fill=PALETTE["text"])
    draw.rounded_rectangle([110, 430, 970, 740], radius=20, fill="#F8F9FA", outline=PALETTE["line"], width=2)
    draw.text((140, 470), "关键点", font=load_font(28), fill=PALETTE["text"])
    draw.text((140, 520), "• 摄入趋势稳定", font=load_font(26), fill=PALETTE["muted"])
    draw.text((140, 560), "• 用药记录完整", font=load_font(26), fill=PALETTE["muted"])
    draw.text((140, 600), "• 可分享给家人/医生", font=load_font(26), fill=PALETTE["muted"])

    # share row
    draw.rounded_rectangle([110, 780, 970, 930], radius=20, fill="#FFF9E6", outline=PALETTE["line"], width=2)
    draw.text((140, 820), "一键分享报告", font=load_font(28), fill=PALETTE["text"])
    draw.rounded_rectangle([760, 805, 940, 885], radius=18, fill=PALETTE["primary"], outline=PALETTE["primary_dark"], width=2)
    draw.text((800, 828), "分享", font=load_font(26), fill="#FFFFFF")

    # collab mini row
    draw.rounded_rectangle([110, 960, 970, 1080], radius=20, fill="#E8F4FD", outline=PALETTE["line"], width=2)
    draw.text((140, 1000), "邀请家人协作记录", font=load_font(26), fill=PALETTE["text"])
    draw.text((700, 1000), "多人可查看", font=load_font(22), fill=PALETTE["muted"])

    # tips
    shadow_rect(canvas, (60, 1200, 1020, 1720), radius=28)
    rounded_rect(draw, (60, 1200, 1020, 1720), radius=28, fill="#FFFFFF", outline=PALETTE["line"], width=2)
    draw.text((90, 1240), "新手提醒", font=load_font(32), fill=PALETTE["text"])
    tips = [
        "记录越完整，报告越清晰",
        "分享给照护人，统一喂养节奏",
        "支持多人协作，避免遗漏",
    ]
    y = 1300
    for t in tips:
        draw.ellipse([90, y+10, 104, y+24], fill=PALETTE["primary"])
        draw.text((120, y), t, font=load_font(28), fill=PALETTE["muted"])
        y += 58

    canvas.save(out_path)


def main():
    out_dir = Path("docs/onboarding")
    out_dir.mkdir(parents=True, exist_ok=True)
    logo = Path("miniprogram/images/LemonLogo.png")

    slide_cover(out_dir / "01_cover.png", logo)
    slide_step_profile(out_dir / "02_profile.png", logo)
    slide_step_record(out_dir / "03_record.png", logo)
    slide_step_trend(out_dir / "04_trend.png", logo)
    slide_step_report(out_dir / "05_report.png", logo)

if __name__ == "__main__":
    main()
