"""按图集记录裁切缩略图，并同步最终素材来源。"""

import concurrent.futures
import json
import pathlib
import subprocess

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[3]
manifest = json.loads((BASE / 'manifest.json').read_text())
latest = {}
jobs = []

for batch_file in sorted((BASE / 'atlases').glob('batch-*.json')):
    batch = json.loads(batch_file.read_text())
    atlas = batch_file.with_suffix('.png')
    width, height = map(int, subprocess.check_output(
        ['magick', 'identify', '-format', '%w %h', str(atlas)], text=True
    ).split())
    assert width % 6 == 0 and height % 4 == 0, (atlas, width, height)
    cell_width, cell_height = width // 6, height // 4
    batch['localAtlasPath'] = str(atlas.relative_to(ROOT))
    batch['reviewed'] = True
    for index, asset in enumerate(batch['cells']):
        source = {
            'atlasPath': str(atlas.relative_to(ROOT)),
            'atlasCell': {'row': index // 6 + 1, 'column': index % 6 + 1},
            'description': asset['description'],
        }
        # 后生成的定向补图优先，原图集仍保留供追溯。
        latest[asset['key']] = (atlas, index, cell_width, cell_height, asset, source)
    batch_file.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + '\n')


def crop(job):
    atlas, index, width, height, asset, source = job
    target = ROOT / asset['localPath']
    target.parent.mkdir(parents=True, exist_ok=True)
    offset_x, offset_y = index % 6 * width, index // 6 * height
    subprocess.run([
        'magick', str(atlas), '-crop', f'{width}x{height}+{offset_x}+{offset_y}',
        '+repage', '-resize', '192x192!', '-strip', '-sampling-factor', '4:2:0',
        '-interlace', 'Plane', '-quality', '82', str(target),
    ], check=True, capture_output=True)
    assert 0 < target.stat().st_size <= 30 * 1024, target


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    list(executor.map(crop, latest.values()))

for asset in manifest['assets']:
    if asset['key'] in latest:
        asset.update(latest[asset['key']][-1])

(BASE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'cropped': len(latest), 'manifestAssets': len(manifest['assets'])}))
