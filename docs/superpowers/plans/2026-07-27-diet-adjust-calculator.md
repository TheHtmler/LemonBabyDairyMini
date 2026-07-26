# Diet Adjust Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 试验功能「饮食调整换算」：预选多普奶/特奶/食物 → 按蛋白或热量目标+占比/份额求解推荐量 → 覆盖应用到某天。

**Architecture:** 纯函数 `dietAdjustCalculator.js` 负责求解与校验；`pkg-misc/diet-adjust-calculator` 分步向导页负责选品/目标/结果/应用；应用时复用 FeedingRecordV2Model 硬删奶 + FoodIntakeRecordModel 软删辅食再写入。

**Tech Stack:** 微信小程序、云开发、`node:test`、现有 nutritionProfile / FoodModel / feedingRecordV2Utils

**Spec:** `docs/superpowers/specs/2026-07-27-diet-adjust-calculator-design.md`

---

### Task 1: 求解纯函数 + 测试
### Task 2: 向导页（四步 UI）+ app.json + 我的入口
### Task 3: 应用写入（删旧写新）+ 菜单契约测试
### Task 4: 回归测试与收尾
