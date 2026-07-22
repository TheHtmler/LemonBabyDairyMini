# 小程序 UI 约定（全局）

## 按钮对齐（高频问题，必须关注）

微信小程序原生 `<button>` **默认带外边距与伪元素边框**，很容易出现：

- 按钮相对左右内边距看起来「没对齐 / 偏一边」
- 宽度不是真正的 `100%`
- 圆角按钮左右露出空白不一致

### 强制规则

凡页面主操作按钮（保存、提交、确认等），必须同时满足：

1. **显式重置盒模型**
   - `width: 100%`
   - `margin: 0`
   - `padding: 0`（或与设计一致的对称 padding）
   - `box-sizing: border-box`
2. **去掉默认边框**
   - `button::after { border: none; }`
3. **放在通栏容器里**
   - 推荐 `footer-actions` / 弹层底部操作区
   - 容器自身用对称 `padding-left/right`
   - 不要依赖 button 默认居中外边距
4. **自测**
   - 看左右边距是否相等
   - 对比同页其他卡片/输入框的左右边界是否齐平

### 推荐样式骨架

```css
.footer-actions {
  padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.save-btn {
  width: 100%;
  height: 84rpx;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  line-height: 84rpx;
  border: none;
}

.save-btn::after {
  border: none;
}
```

参考实现：`pkg-records/bowel-record`、`pkg-records/treatment-record` 的底部保存按钮。

## 表单控件一致性

时间、日期、数量输入优先复用现有记录页样式：

- 标签在上：`.field-label`
- 控件本体：`.compact-picker` / `.compact-input` / `.notes-area`
- 背景 `#FFF9EA`，描边 `rgba(255, 184, 0, 0.14)`，圆角约 `14~16rpx`

不要在新页面再发明一套「右侧大号右对齐输入」除非产品明确要求。
