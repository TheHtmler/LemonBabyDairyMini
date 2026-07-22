# 喝水记录一期设计

## 目标
为柠檬宝宝增加「记喝水」：独立集合、日汇总接入、柠檬环形容器水位可视化。不做饮水目标或医学建议。

## 页面
- 首屏：今日累计 ml + 居中柠檬环形容器（Option B 抠透明）+「＋ 新增喝水」
- 录入：底部弹窗（时间、水量、快捷 10/20/30/50）
- 水位：裁切在容器内腔椭圆；有水时水面持续流动；标注「水位仅表示已记录量」
- 视觉满水位参考：300ml（仅展示，非目标）

## 数据
- 集合 `water_records`：`babyUid`, `date`, `dateKey`, `recordTime`, `timeString`, `volumeMl`, `notes?`, `status`, 审计字段
- Model：`create` / `update` / `delete` / `findByDate` + `markDirty`
- `daily_summary_v2.water = { totalVolume, totalRecords }`，`recordCounts.water`

## 录入弹层
- 时间 / 水量控件对齐尿布、治疗页的 `compact-picker` / `compact-input`
- 快捷水量：`20 / 30 / 50 / 80 / 100 / 150 / 200 / 250`
- 备注选填
- 保存按钮必须通栏对齐，遵循 `docs/miniprogram/ui-conventions.md`

## 入口
- 首页快捷「记喝水」
- 数据记录 Tab「喝水记录」
