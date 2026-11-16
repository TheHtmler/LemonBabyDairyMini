"""将已审核的食物图集裁成专用缩略图，并输出可追溯清单。"""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[4]
GROUP = pathlib.Path(__file__).resolve().parent
SPECS = json.loads((GROUP / 'specs.json').read_text())
OVERRIDES_PATH = GROUP / 'overrides.json'
OVERRIDES = json.loads(OVERRIDES_PATH.read_text()) if OVERRIDES_PATH.exists() else {}

def prepare():
    for index, item in enumerate(SPECS):
        target = GROUP / 'images' / f'{item["key"]}.jpg'
        override = OVERRIDES.get(item['key'])
        if override:
            # 定向修正图优先于原图集，重建时不再裁回已废弃的格子。
            source = GROUP / override['sourceImage']
            subprocess.run(['magick', str(source), '-resize', '168x168!', '-background', '#fffcf8', '-gravity', 'center', '-extent', '192x192', '-strip', '-sampling-factor', '4:2:0', '-quality', '82', str(target)], check=True)
            continue
        atlas = GROUP / 'atlases' / f'atlas-{index // 24 + 1:02d}.png'
        if not atlas.exists():
            continue
        if target.exists():
            continue
        size = subprocess.check_output(['magick', 'identify', '-format', '%w %h', str(atlas)], text=True)
        width, height = map(int, size.split())
        cell_width, cell_height = width // 6, height // 4
        column, row = index % 6, index % 24 // 6
        crop = f'{cell_width}x{cell_height}+{column * cell_width}+{row * cell_height}'
        subprocess.run(['magick', str(atlas), '-crop', crop, '+repage', '-resize', '192x192!', '-strip', '-sampling-factor', '4:2:0', '-quality', '82', str(target)], check=True)
    assets = []
    for index, item in enumerate(SPECS):
        asset = {**item, 'localPath': f'assets/food-illustrations/full/proteins/images/{item["key"]}.jpg'}
        if item['key'] in OVERRIDES:
            asset.update(OVERRIDES[item['key']])
        else:
            asset.update({'atlas': f'atlases/atlas-{index // 24 + 1:02d}.png', 'cell': index % 24 + 1})
        assets.append(asset)
    reused = [
        {'key': 'pork', 'name': '生猪肉（肥瘦）', 'description': '已有专用粉红色生猪肉块插画，肌肉与白色脂肪相间。', 'sourceCodes': ['081101']},
        {'key': 'beef', 'name': '生牛肉', 'description': '已有专用深红色生牛肉块插画，白色脂肪纹清楚。', 'sourceCodes': ['082101']},
        {'key': 'milk', 'name': '液态乳', 'description': '已有专用一杯白色液态乳插画；这些未调色乳品均为相同外观的白色乳液。', 'sourceCodes': ['101101','101102','101104','101105','101106','101152','101161','101166','101187','101201','101301','101501']},
        {'key': 'egg', 'name': '煮鸡蛋', 'description': '已有专用煮鸡蛋插画，半个切面露出凝固白蛋白与黄色熟蛋黄。', 'sourceCodes': ['111204']},
    ]
    for item in reused:
        assets.append({**item, 'localPath': f'miniprogram/images/food-illustrations/{item["key"]}.jpg'})
    foods = {code: asset['key'] for asset in assets for code in asset['sourceCodes']}
    manifest = {'group': 'proteins', 'foods': foods, 'assets': assets}
    # 只有所有资源真实存在时才发布正式清单，避免半成品被总构建误用。
    if all((ROOT / item['localPath']).is_file() for item in assets):
        (GROUP / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'existingImages': len(list((GROUP / 'images').glob('*.jpg'))), 'expectedImages': len(SPECS), 'mappedFoods': len(foods)}, ensure_ascii=False))

if __name__ == '__main__':
    prepare()
