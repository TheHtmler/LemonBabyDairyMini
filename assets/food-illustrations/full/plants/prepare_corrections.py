import json,pathlib
base=pathlib.Path(__file__).parent
m=json.loads((base/"manifest.json").read_text())
a=m["assets"]; patches=[]
def split(codes,key,name,description):
 cs=codes.split()
 for g in a:g["sourceCodes"]=[c for c in g["sourceCodes"] if c not in cs]
 g={"key":"plants-"+key,"name":name,"description":description,"localPath":"assets/food-illustrations/full/plants/images/"+key+".jpg","sourceCodes":cs}
 a.append(g);patches.append(g)
def patch(code,description):
 g=next(g for g in a if code in g["sourceCodes"])
 c=dict(g);c["description"]=description;patches.append(c)
# 分开近似但实际不同的具体食材，保留原批次格子位置。
split("047101","greater-yam","大薯","新鲜大薯，粗壮不规则棕色大块根，一块切开露浅紫白色淀粉肉；不是细长铁棍山药")
split("048070 048081","sow-thistle","苦苣菜","苦苣菜，浅绿茎上柔软长椭圆锯齿叶，基部抱茎，少量较宽嫩叶；只画此种野菜")
next(g for g in a if "048040" in g["sourceCodes"])["name"]="蒲公英鲜叶"
split("051053","dried-late-oyster","干元蘑","元蘑干，黄褐色扇形干菌盖，较短侧生菌柄，菌褶清楚，明显干燥皱缩")
split("071014","apricot-kernel-raw","生杏仁","中国甜杏仁，一堆较扁短、心形三角状的杏核仁，淡乳白内仁，部分淡褐皮；不是长条巴旦木")
split("071016","apricot-kernel-roasted","炒杏仁","中国炒杏仁，一堆较扁短、心形三角状的杏核仁，微金黄熟仁，部分浅褐皮；不是长条巴旦木")
patch("011311","干虾蓉挂面，浅粉米黄色细直干面条一小束，无汤、无碗、无配菜、不画鲜虾")
patch("019001","高粱米，圆形小粒乳白米粒，表面有红褐色斑点或红皮残留，一小碗，不能画长米或薏米")
patch("019010","荞麦面粉，一碗细腻灰褐色干粉，禁止画面条、禁止画完整谷粒")
patch("019011","莜麦面粉，一碗细腻浅米黄色干粉，禁止画面条、禁止画燕麦片")
patch("022104","团粉淀粉，一碗雪白色极细干粉，少量粉末堆尖；禁止晶体、禁止胶片")
patch("022105","干藕粉，一碗非常细腻的浅米粉色干粉，不能冲调、不透明胶、无莲藕块")
patch("022106","桂花干藕粉，一碗细腻浅米粉色干粉，点缀几粒金黄干桂花，不能冲调、不画透明糊")
patch("039204","煮熟的豇豆干豆粒，一碗白米色熟豆粒，各粒有黑色豆脐，湿润饱满；禁止豆荚、禁止绿色菜段")
patch("044302","脱水白洋葱，一小堆乳白色微黄干洋葱碎片、干燥卷曲，不画完整洋葱球")
patch("044303","脱水紫洋葱，一小堆淡紫白相间的干洋葱碎片、干燥卷曲，不画完整洋葱球")
patch("045422","三七尖鲜嫩芽，一小把绿紫色嫩梢与三到五枚卵形尖端小叶，柔嫩光滑叶片，不画香椿羽状叶")
patch("048002","白花菜嫩梢，三出掌状复叶，叶片卵形，几朵细小白色四瓣花带细长花丝；不是西兰花、不是花椰菜")
patch("051006","干黄蘑，黄色至黄褐色圆伞状皱缩菌盖与细菌柄，一小堆；菌盖中央略凸，不画鸡油菌漏斗状")
patch("062207","布朗李子，两枚非常深紫近黑色光滑圆形黑布林李子，一枚切开露淡黄果肉与扁核；绝不画面包或饼")
m["foods"]={c:g["key"] for g in a for c in g["sourceCodes"]}
(base/"manifest.json").write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n")
# 补图仍是一份可按格裁切的单独图集。
first=json.loads((base/"atlases/batch-24.json").read_text())["prompt"].split("请严格按行从左到右：")[0]
prompt=first+"请严格按行从左到右：\n"
for i,g in enumerate(patches):prompt+=f"第{i//6+1}行第{i%6+1}格：{g['description']}。\n"
for i in range(len(patches),24):prompt+=f"第{i//6+1}行第{i%6+1}格：保持空白暖白底。\n"
d={"rows":4,"columns":6,"cells":patches,"prompt":prompt,"purpose":"纠正容易混淆的生熟、粉面形态，并拆开外观相近的不同具体食材。"}
(base/"atlases/batch-25.json").write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n")
(base/"atlases/batch-25.prompt.txt").write_text(prompt)
print(len(patches),len(a))
