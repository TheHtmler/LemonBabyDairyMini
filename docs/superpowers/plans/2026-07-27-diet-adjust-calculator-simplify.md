# 饮食调整换算简化重设计 · 实现计划

> **For agentic workers:** 按任务顺序执行；每任务先测后改；保持白话 UI。

**Goal:** 按 `docs/superpowers/specs/2026-07-27-diet-adjust-calculator-design.md` 把现有四步百分比向导改成「滑条 + 勾选 + 能量粉补热 + 软目标对照 + 应用」。

**Tech notes:** 纯函数在 `miniprogram/utils/dietAdjustCalculator.js`；页面在 `pkg-misc/diet-adjust-calculator/`；测试用 `node --test`。

### Task 1: 求解器

- 自动均分份额；普奶/特奶按天然/特殊蛋白系数切开  
- `energyPowders` 只补热量缺口  
- 返回 `achieved` / `gaps` / `hints`  
- 更新 `tests/diet-adjust-calculator.test.js`

### Task 2: 页面

- 单页：目标、滑条、勾选（含能量粉）、结果、软目标对照、应用  
- 去掉份额输入；食物上限 5  
- 更新 `tests/diet-adjust-calculator-page.test.js`

### Task 3: 提交

- docs + code 分开或一次提交，说明简化重设计
