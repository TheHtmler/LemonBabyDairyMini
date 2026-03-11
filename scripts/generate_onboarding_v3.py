#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
PALETTE = {
    "primary": "#FFB800",
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


def shadow_rect(img, xy, radius=20, offset=(0,6), shadow_color=(0,0,0,35)):
    x0,y0,x1,y1 = xy
    shadow = Image.new("RGBA", img.size, (0,0,0,0))
    sd = ImageDraw.Draw(shadow)
    sx0, sy0 = x0+offset[0], y0+offset[1]
    sx1, sy1 = x1+offset[0], y1+offset[1]
    sd.rounded_rectangle([sx0,sy0,sx1,sy1], radius=radius, fill=shadow_color)
    img.alpha_composite(shadow)


def fit_cover(img, size):
    w, h = img.size
    tw, th = size
    scale = max(tw/w, th/h)
    nw, nh = int(w*scale), int(h*scale)
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw)//2
    top = (nh - th)//2
    return resized.crop((left, top, left+tw, top+th))


def draw_title(draw, step, title, subtitle):
    font_step = load_font(26)
    font_title = load_font(50)
    font_sub = load_font(28)
    draw.text((60, 70), f"STEP {step}", font=font_step, fill=PALETTE["primary"])
    draw.text((60, 110), title, font=font_title, fill=PALETTE["text"])
    draw.text((60, 175), subtitle, font=font_sub, fill=PALETTE["muted"])


def paste_panel(canvas, img_path, box, label=None):
    draw = ImageDraw.Draw(canvas)
    shadow_rect(canvas, box)
    rounded_rect(draw, box, radius=18, fill=PALETTE["card"], outline=PALETTE["line"], width=2)
    x0,y0,x1,y1 = box
    pad = 10
    inner = (x0+pad, y0+pad, x1-pad, y1-pad)
    img = Image.open(img_path).convert("RGB")
    fitted = fit_cover(img, (inner[2]-inner[0], inner[3]-inner[1]))
    canvas.paste(fitted, (inner[0], inner[1]))
    if label:
        font = load_font(24)
        tw = draw.textlength(label, font=font)
        lx = x0 + 16
        ly = y0 + 10
        draw.rounded_rectangle([lx-8, ly-6, lx+tw+16, ly+28], radius=10, fill="#FFF3CC", outline=PALETTE["primary"], width=1)
        draw.text((lx, ly), label, font=font, fill=PALETTE["text"])


def grid_boxes(top, left=60, right=1020, rows=3, cols=2, gap=20, bottom=1760):
    width = right - left
    height = bottom - top
    cell_w = (width - gap*(cols-1)) // cols
    cell_h = (height - gap*(rows-1)) // rows
    boxes = []
    for r in range(rows):
        for c in range(cols):
            x0 = left + c*(cell_w + gap)
            y0 = top + r*(cell_h + gap)
            x1 = x0 + cell_w
            y1 = y0 + cell_h
            boxes.append((x0, y0, x1, y1))
    return boxes


def make_slide(step, title, subtitle, images, labels, out_path):
    canvas = vertical_gradient((W, H), PALETTE["bg_top"], PALETTE["bg_bottom"]).convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    draw_title(draw, step, title, subtitle)
    boxes = grid_boxes(top=240)
    for i, img_path in enumerate(images):
        if i >= len(boxes):
            break
        label = labels[i] if labels and i < len(labels) else None
        paste_panel(canvas, img_path, boxes[i], label)
    canvas.save(out_path)


def main():
    root = Path("docs/demo-images")
    out_dir = Path("docs/onboarding_v3")
    out_dir.mkdir(parents=True, exist_ok=True)

    slides = [
        (1, "角色与建档", "完成身份与宝宝信息", [
            root/"角色选择页.png",
            root/"宝宝信息管理1.png",
            root/"宝宝信息管理2.png",
            root/"参与者邀请码页面.png",
            root/"分享邀请码.png",
            root/"食物管理1.png",
        ], ["角色选择", "宝宝信息", "完善信息", "参与者邀请", "分享邀请码", "食物管理入口"]),
        (2, "奶粉设置", "普奶/特奶参数配置", [
            root/"奶粉设置-普奶.png",
            root/"奶粉设置-特奶.png",
            root/"添加喂奶1.png",
            root/"添加喂奶2.png",
            root/"添加喂奶3.png",
            root/"摄入汇总1.png",
        ], ["普奶设置", "特奶设置", "喂奶步骤", "喂奶补充", "喂奶记录", "今日汇总"]),
        (3, "喂奶记录", "记录体积与自动计算", [
            root/"添加喂奶1.png",
            root/"添加喂奶2.png",
            root/"添加喂奶3.png",
            root/"摄入汇总1.png",
            root/"摄入汇总2.png",
            root/"数据记录1.png",
        ], ["添加喂奶", "补充信息", "选择类型", "摄入汇总", "蛋白/热量", "记录列表"]),
        (4, "添加食物", "食物录入与营养预览", [
            root/"添加食物1.png",
            root/"添加食物2.png",
            root/"添加食物3.png",
            root/"食物管理1.png",
            root/"食物管理2.png",
            root/"食物管理3.png",
        ], ["选择食物", "填写重量", "营养预览", "食物管理", "分类/搜索", "编辑食物"]),
        (5, "用药管理", "记录剂量与时间", [
            root/"药物管理1.png",
            root/"添加喂奶1.png",
            root/"摄入汇总1.png",
            root/"数据记录2.png",
            root/"数据记录3.png",
            root/"数据记录4.png",
        ], ["药物管理", "关联喂奶", "今日汇总", "记录筛选", "记录详情", "多条记录"]),
        (6, "数据记录", "按天/记录快速回看", [
            root/"数据记录1.png",
            root/"数据记录2.png",
            root/"数据记录3.png",
            root/"数据记录4.png",
            root/"摄入汇总1.png",
            root/"摄入汇总2.png",
        ], ["列表视图", "筛选/日期", "记录详情", "多条记录", "今日汇总", "蛋白/热量"]),
        (7, "趋势分析", "曲线帮助发现变化", [
            root/"分析曲线1.png",
            root/"分析曲线2.png",
            root/"数据记录1.png",
            root/"摄入汇总1.png",
            root/"报告分析1.png",
            root/"报告分析2.png",
        ], ["趋势曲线", "趋势对比", "数据记录", "摄入汇总", "报告分析", "报告详情"]),
        (8, "报告与分享", "统一沟通与协作", [
            root/"报告分析1.png",
            root/"报告分析2.png",
            root/"分享邀请码.png",
            root/"参与者邀请码页面.png",
            root/"角色选择页.png",
            root/"宝宝信息管理1.png",
        ], ["报告分析", "报告详情", "分享邀请码", "参与者加入", "角色切换", "宝宝信息"]),
    ]

    for step, title, subtitle, imgs, labels in slides:
        out = out_dir / f"{step:02d}_{title}.png"
        make_slide(step, title, subtitle, imgs, labels, out)

if __name__ == "__main__":
    main()
