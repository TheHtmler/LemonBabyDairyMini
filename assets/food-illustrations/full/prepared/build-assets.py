#!/usr/bin/env python3
"""按已经人工核对的图集位置裁切食品插画，并生成本组清单。"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
GROUP = Path(__file__).resolve().parent
PLAN = GROUP / 'asset-plan.json'
plan = json.loads(PLAN.read_text())
assets = []
foods = {}
for item in plan['generated']:
    # 纠偏图集分别采用三列两行、两列一行，其余图集采用六列四行。
    columns, rows = (2, 1) if item['atlas'] == '15' else (3, 2) if item['atlas'] == '14' else (6, 4)
    atlas = GROUP / 'atlases' / (item['atlas'] + '.png')
    size = subprocess.check_output(['magick', 'identify', '-format', '%w %h', str(atlas)], text=True)
    width, height = map(int, size.split())
    cell_width, cell_height = width // columns, height // rows
    column, row = item['cell'] % columns, item['cell'] // columns
    output = GROUP / 'images' / (item['key'] + '.jpg')
    subprocess.run([
        'magick', str(atlas), '-crop',
        f'{cell_width}x{cell_height}+{column * cell_width}+{row * cell_height}',
        '+repage', '-resize', '192x192!', '-background', '#fcfaf6',
        '-alpha', 'remove', '-alpha', 'off', '-strip', '-sampling-factor', '4:2:0',
        '-quality', '82', str(output)
    ], check=True)
    if output.stat().st_size > 30000:
        raise ValueError(f'素材超过 30 KB：{output.name}')
    description = item.get('descriptionZh', item['name'] + '的具体食品形态，暖白底精细手绘插画。')
    asset = {k: item[k] for k in ['key', 'name', 'sourceCodes']}
    asset['description'] = description
    asset['localPath'] = str(output.relative_to(ROOT))
    assets.append(asset)
for item in plan['reused']:
    assets.append(item)
for item in assets:
    if not re.fullmatch(r'[a-z0-9_-]+', item['key']):
        raise ValueError('素材标识不合规：' + item['key'])
    for code in item['sourceCodes']:
        if code in foods:
            raise ValueError('重复食品映射：' + code)
        foods[code] = item['key']
manifest = dict(group='prepared', foods=foods, assets=assets)
(GROUP / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(foods=len(foods), assets=len(assets), generated=len(plan['generated']), jpegBytes=sum((ROOT / x['localPath']).stat().st_size for x in assets)), ensure_ascii=False))
