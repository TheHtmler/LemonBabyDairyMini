import pathlib,json
base=pathlib.Path(__file__).parent
for p in sorted((base/"atlases").glob("batch-*.json")):
 d=json.loads(p.read_text()); cells=d["cells"]
 prompt="""Use case: scientific-educational. 本图是宝宝饮食记录应用的具体食物插画图集，用于裁切为24张小方图。只借鉴参考图的绘画风格，不复用参考图的食材。
生成横向1536×1024像素图，严格6列×4行，每格256×256，24个等大正方形，均匀隐形网格，纯净统一暖白色背景#FFFCF8，无格线无文字。每格仅有指定的一种具体食物，形态准确，每个物体完整在格子中央，四边留15%空白，绝不跨格。相邻格互不接触，不合并食物，不添加装饰或其他食材。所有食品同一精细柔和手绘插画风，接近实物的真实颜色纹理和解剖特征，细腻彩铅水彩混合、柔和自然投影。不是照片、不是3D、不是卡通，不拟人，无字、无数字、无标签、无水印、无商标。生食画生食，粉画小碗细粉，干食画干燥状态，熟食画熟食；罐头画打开的无标签简单罐与可见的指定内容，饮品画透明玻璃杯。每格只能画本格列出的食物。
请严格按行从左到右：\n"""
 for i,g in enumerate(cells): prompt+=f"第{i//6+1}行第{i%6+1}格：{g['name']}。\n"
 if len(cells)<24:
  for i in range(len(cells),24): prompt+=f"第{i//6+1}行第{i%6+1}格：保持空白暖白底，无任何物体。\n"
 d["prompt"]=prompt
 p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n")
 (p.with_suffix(".prompt.txt")).write_text(prompt)
