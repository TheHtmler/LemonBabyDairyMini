const WaterRecordModel = require('../../models/waterRecord');
const { getBabyUid } = require('../../utils/index');

const QUICK_VOLUMES = [20, 30, 50, 80, 100, 150, 200, 250];
/**
 * 水位半高参考（ml）：volume / (volume + HALF) 渐进上升，永远不会装满，
 * 避免被理解成「容器容量 / 饮水目标」。
 */
const VISUAL_HALF_ML = 280;
/** 视觉水位上限，留出空气感 */
const VISUAL_MAX_RATIO = 0.82;
/** 相对 vessel 图的内腔椭圆比例（基于 lemon-water-vessel.png 测量） */
const OVAL = { cx: 0.4996, cy: 0.5626, rx: 0.2407, ry: 0.2805 };

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function createForm(overrides = {}) {
  return {
    time: overrides.time || overrides.timeString || formatTime(),
    volume: overrides.volume != null ? String(overrides.volume) : (overrides.volumeMl != null ? String(overrides.volumeMl) : ''),
    notes: overrides.notes != null ? String(overrides.notes) : ''
  };
}

function sumVolumes(records = []) {
  return (records || []).reduce((sum, item = {}) => sum + (Number(item.volumeMl) || 0), 0);
}

function computeFillRatio(totalMl) {
  const volume = Math.max(0, Number(totalMl) || 0);
  if (volume <= 0) return 0;
  // 渐进映射：280ml ≈ 半满，再往上越加越慢，封顶约 82%
  return Math.min(VISUAL_MAX_RATIO, volume / (volume + VISUAL_HALF_ML));
}

Page({
  data: {
    dateKey: '',
    totalMl: 0,
    displayTotalMl: 0,
    recordCountText: '0 次',
    records: [],
    quickVolumes: QUICK_VOLUMES,
    sheetVisible: false,
    saving: false,
    editingId: '',
    form: createForm(),
    entered: false,
    listVisible: false,
    canvasVisible: true,
    staticFillPercent: 0,
    dropFalling: false,
    splashOn: false,
    amountPop: false
  },

  /** 水体渐变：上浅下深，整体平滑过渡 */
  WATER_TOP: 'rgba(132, 214, 245, 0.95)',
  WATER_BOTTOM: 'rgba(48, 148, 210, 0.98)',
  WATER_FOAM: 'rgba(255, 255, 255, 0.22)',

  canvasNode: null,
  canvasCtx: null,
  canvasWidth: 0,
  canvasHeight: 0,
  dpr: 1,
  fillRatio: 0,
  targetFillRatio: 0,
  wavePhase: 0,
  splashBoost: 0,
  rafId: null,
  animating: false,
  countTimer: null,
  effectTimers: [],

  onLoad(options = {}) {
    const dateKey = options.date || getTodayDateKey();
    this.setData({ dateKey });
    if (options.id) {
      this._pendingEditId = options.id;
    }
  },

  onReady() {
    this.initCanvas().then(() => this.refreshRecords());
    setTimeout(() => {
      this.setData({ entered: true });
    }, 40);
  },

  onShow() {
    if (this.canvasCtx) {
      this.refreshRecords();
      if (this.targetFillRatio > 0) {
        this.startWaveLoop();
      }
    }
  },

  onUnload() {
    this.stopWaveLoop();
    this.clearEffectTimers();
    if (this.countTimer) {
      clearInterval(this.countTimer);
      this.countTimer = null;
    }
  },

  onHide() {
    this.stopWaveLoop();
  },

  clearEffectTimers() {
    (this.effectTimers || []).forEach((timer) => clearTimeout(timer));
    this.effectTimers = [];
  },

  scheduleEffect(fn, delay) {
    const timer = setTimeout(fn, delay);
    this.effectTimers.push(timer);
    return timer;
  },

  async initCanvas() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery();
      query.select('#waterCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const entry = res && res[0];
          if (!entry || !entry.node) {
            resolve(false);
            return;
          }
          const canvas = entry.node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio || 1;
          const width = entry.width || 300;
          const height = entry.height || 300;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);
          this.canvasNode = canvas;
          this.canvasCtx = ctx;
          this.canvasWidth = width;
          this.canvasHeight = height;
          this.dpr = dpr;
          this.initBubbles();
          this.drawFrame(true);
          resolve(true);
        });
    });
  },

  initBubbles() {
    this.bubbles = Array.from({ length: 5 }, (_, index) => ({
      xRatio: 0.34 + (index % 4) * 0.1,
      size: 1.6 + (index % 3),
      speed: 0.32 + (index % 3) * 0.1,
      phase: index * 0.9,
      progress: (index * 0.17) % 1
    }));
  },

  async refreshRecords(options = {}) {
    const babyUid = getBabyUid();
    const { dateKey } = this.data;
    if (!babyUid || !dateKey) return;

    const result = await WaterRecordModel.findByDate(dateKey, babyUid);
    const records = (result.data || []).map((item) => ({
      ...item,
      timeString: item.timeString || formatTime(item.recordTime ? new Date(item.recordTime) : new Date()),
      volumeMl: Number(item.volumeMl) || 0,
      notes: String(item.notes || '').trim()
    }));
    const totalMl = sumVolumes(records);
    const prevTotal = Number(this.data.totalMl) || 0;
    this.setData({
      records,
      totalMl,
      recordCountText: `${records.length} 次`
    });
    this.animateTotalMl(totalMl, {
      pop: options.celebrate || totalMl !== prevTotal
    });
    this.setTargetFill(computeFillRatio(totalMl));

    if (this._pendingEditId) {
      const id = this._pendingEditId;
      this._pendingEditId = '';
      await this.openRecordSheetForEditById(id);
    }
  },

  animateTotalMl(target, options = {}) {
    const end = Math.max(0, Math.round(Number(target) || 0));
    const start = Math.max(0, Math.round(Number(this.data.displayTotalMl) || 0));
    if (this.countTimer) {
      clearInterval(this.countTimer);
      this.countTimer = null;
    }
    if (start === end) {
      this.setData({ displayTotalMl: end });
      if (options.pop && end > 0) {
        this.pulseAmount();
      }
      return;
    }

    const diff = end - start;
    const steps = Math.min(18, Math.max(8, Math.abs(diff)));
    let step = 0;
    this.countTimer = setInterval(() => {
      step += 1;
      const next = Math.round(start + (diff * step) / steps);
      this.setData({ displayTotalMl: next });
      if (step >= steps) {
        clearInterval(this.countTimer);
        this.countTimer = null;
        this.setData({ displayTotalMl: end });
        if (options.pop) {
          this.pulseAmount();
        }
      }
    }, 28);
  },

  pulseAmount() {
    this.setData({ amountPop: false });
    this.scheduleEffect(() => {
      this.setData({ amountPop: true });
      this.scheduleEffect(() => {
        this.setData({ amountPop: false });
      }, 500);
    }, 20);
  },

  playSaveCelebration() {
    this.clearEffectTimers();
    this.splashBoost = 1;
    this.setData({
      dropFalling: true,
      splashOn: false
    });
    this.startWaveLoop();

    this.scheduleEffect(() => {
      this.setData({ splashOn: true });
    }, 480);

    this.scheduleEffect(() => {
      this.setData({ dropFalling: false });
    }, 700);

    this.scheduleEffect(() => {
      this.setData({ splashOn: false });
      this.splashBoost = 0;
    }, 1050);
  },

  syncStaticFill(ratio = this.targetFillRatio) {
    const percent = Math.round(Math.max(0, Math.min(1, Number(ratio) || 0)) * 100);
    if (this.data.staticFillPercent !== percent) {
      this.setData({ staticFillPercent: percent });
    }
  },

  setTargetFill(ratio) {
    this.targetFillRatio = Math.max(0, Math.min(1, ratio));
    this.syncStaticFill(this.targetFillRatio);
    if (this.targetFillRatio > 0 || this.fillRatio > 0.001) {
      this.startWaveLoop();
    } else {
      this.fillRatio = 0;
      this.drawFrame(true);
      this.stopWaveLoop();
    }
  },

  startWaveLoop() {
    if (this.animating || !this.canvasNode) return;
    this.animating = true;
    const step = () => {
      if (!this.animating) return;
      const diff = this.targetFillRatio - this.fillRatio;
      if (Math.abs(diff) < 0.001) {
        this.fillRatio = this.targetFillRatio;
      } else {
        this.fillRatio += diff * 0.12;
      }

      if (this.fillRatio > 0.001) {
        // 相位持续推进；速度偏缓，避免水面过于激烈
        this.wavePhase += 0.055 + this.splashBoost * 0.1;
        this.updateBubbles();
      }
      if (this.splashBoost > 0) {
        this.splashBoost *= 0.94;
        if (this.splashBoost < 0.02) this.splashBoost = 0;
      }

      this.drawFrame();

      if (this.fillRatio <= 0.001 && this.targetFillRatio <= 0 && this.splashBoost <= 0) {
        this.stopWaveLoop();
        return;
      }
      this.rafId = this.canvasNode.requestAnimationFrame(step);
    };
    this.rafId = this.canvasNode.requestAnimationFrame(step);
  },

  stopWaveLoop() {
    this.animating = false;
    if (this.canvasNode && this.rafId != null) {
      this.canvasNode.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  },

  updateBubbles() {
    if (!this.bubbles) this.initBubbles();
    this.bubbles.forEach((bubble) => {
      bubble.progress += 0.008 * bubble.speed * (1 + this.splashBoost);
      if (bubble.progress > 1) {
        bubble.progress = 0;
        bubble.xRatio = 0.34 + Math.random() * 0.32;
      }
    });
  },

  /** 双正弦叠加，得到左右此起彼伏的水面高度 */
  sampleWaveY(x, baseY, amp1, amp2, len1, len2, phase) {
    return baseY
      + Math.sin((x / len1) * Math.PI * 2 + phase) * amp1
      + Math.sin((x / len2) * Math.PI * 2 - phase * 1.35 + 0.8) * amp2;
  },

  drawFrame() {
    const ctx = this.canvasCtx;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    if (!ctx || !width || !height) return;

    ctx.clearRect(0, 0, width, height);
    const fillRatio = this.fillRatio;
    if (fillRatio <= 0.001) return;

    const cx = width * OVAL.cx;
    const cy = height * OVAL.cy;
    const rx = width * OVAL.rx;
    const ry = height * OVAL.ry;
    const top = cy - ry;
    const bottom = cy + ry;
    const waterTop = bottom - (bottom - top) * fillRatio;
    const boost = this.splashBoost || 0;
    const phase = this.wavePhase;
    const amp1 = Math.max(2.2, ry * 0.038) * (1 + boost * 0.9);
    const amp2 = Math.max(1.2, ry * 0.018) * (1 + boost * 0.6);
    const len1 = Math.max(34, rx * 1.45);
    const len2 = Math.max(22, rx * 0.85);
    const left = cx - rx - 2;
    const right = cx + rx + 2;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    // 水体顶部按波浪路径裁切填充，水面本身会起伏移动
    ctx.beginPath();
    ctx.moveTo(left, bottom + 4);
    ctx.lineTo(left, this.sampleWaveY(left, waterTop, amp1, amp2, len1, len2, phase));
    for (let x = left + 2; x <= right; x += 2) {
      ctx.lineTo(x, this.sampleWaveY(x, waterTop, amp1, amp2, len1, len2, phase));
    }
    ctx.lineTo(right, bottom + 4);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, waterTop - amp1, 0, bottom);
    gradient.addColorStop(0, this.WATER_TOP);
    gradient.addColorStop(0.45, 'rgba(86, 186, 232, 0.96)');
    gradient.addColorStop(1, this.WATER_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fill();

    // 沿波峰描一圈高光，强化起伏感
    ctx.beginPath();
    const crestY0 = this.sampleWaveY(left, waterTop, amp1, amp2, len1, len2, phase);
    ctx.moveTo(left, crestY0);
    for (let x = left + 2; x <= right; x += 2) {
      ctx.lineTo(x, this.sampleWaveY(x, waterTop, amp1, amp2, len1, len2, phase));
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.lineWidth = Math.max(1.2, ry * 0.014);
    ctx.lineJoin = 'round';
    ctx.stroke();

    this.drawBubbles(ctx, {
      cx, cy, rx, ry, waterTop: waterTop - amp1, bottom
    });

    ctx.restore();
  },

  drawBubbles(ctx, bounds = {}) {
    if (!this.bubbles) return;
    const { cx, rx, waterTop, bottom } = bounds;
    const waterHeight = Math.max(8, bottom - waterTop);
    this.bubbles.forEach((bubble) => {
      const x = cx - rx + rx * 2 * bubble.xRatio + Math.sin(this.wavePhase + bubble.phase) * 2;
      const y = bottom - waterHeight * bubble.progress;
      if (y < waterTop + 2) return;
      const alpha = 0.25 + (1 - bubble.progress) * 0.45;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.arc(x, y, bubble.size, 0, Math.PI * 2);
      ctx.fill();
    });
  },

  setCanvasVisible(visible) {
    const next = !!visible;
    if (this.data.canvasVisible === next) return;
    if (!next) {
      // 先同步静态水位，再销毁 canvas，避免弹窗期间水量“消失”
      this.syncStaticFill(this.fillRatio || this.targetFillRatio);
      this.stopWaveLoop();
      this.canvasNode = null;
      this.canvasCtx = null;
      this.setData({ canvasVisible: false });
      return;
    }
    this.setData({ canvasVisible: true }, () => {
      // 节点重建后重新绑定并续播水面
      setTimeout(() => {
        this.initCanvas().then(() => {
          const ratio = computeFillRatio(this.data.totalMl);
          this.fillRatio = ratio;
          this.setTargetFill(ratio);
        });
      }, 30);
    });
  },

  openRecordSheet() {
    this.setCanvasVisible(false);
    this.setData({
      sheetVisible: true,
      listVisible: false,
      editingId: '',
      form: createForm()
    });
  },

  buildEditForm(record = {}) {
    return createForm({
      time: record.timeString || record.time || '',
      volume: record.volumeMl != null ? record.volumeMl : record.volume,
      notes: record.notes || ''
    });
  },

  openRecordSheetForEdit(record = {}) {
    this.setCanvasVisible(false);
    this.setData({
      sheetVisible: true,
      listVisible: false,
      editingId: record._id || '',
      form: this.buildEditForm(record)
    });
  },

  async openRecordSheetForEditById(recordId) {
    if (!recordId) return;
    const local = (this.data.records || []).find((item) => item._id === recordId);
    if (local) {
      this.openRecordSheetForEdit(local);
      return;
    }
    try {
      wx.showLoading({ title: '加载中...' });
      const result = await WaterRecordModel.getById(recordId);
      wx.hideLoading();
      if (!result.success || !result.data) {
        wx.showToast({ title: result.message || '记录不存在', icon: 'none' });
        return;
      }
      const record = result.data;
      if (record.date || record.dateKey) {
        this.setData({ dateKey: record.dateKey || record.date });
      }
      this.openRecordSheetForEdit(record);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  closeRecordSheet() {
    if (this.data.saving) return;
    this.setData({
      sheetVisible: false,
      editingId: '',
      form: createForm()
    });
    this.setCanvasVisible(true);
  },

  openListSheet() {
    this.setCanvasVisible(false);
    this.setData({ listVisible: true });
  },

  closeListSheet() {
    this.setData({ listVisible: false });
    if (!this.data.sheetVisible) {
      this.setCanvasVisible(true);
    }
  },

  onTimeChange(e) {
    this.setData({
      'form.time': e.detail.value
    });
  },

  onVolumeInput(e) {
    this.setData({
      'form.volume': e.detail.value
    });
  },

  onQuickVolume(e) {
    const volume = e.currentTarget.dataset.volume;
    this.setData({
      'form.volume': String(volume)
    });
  },

  onNotesInput(e) {
    this.setData({
      'form.notes': e.detail.value
    });
  },

  onEditRecord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.openRecordSheetForEditById(id);
  },

  onDeleteRecord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条喝水记录吗？',
      success: async (res) => {
        if (!res.confirm) return;
        const result = await WaterRecordModel.delete(id);
        if (!result.success) {
          wx.showToast({ title: result.message || '删除失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已删除', icon: 'success' });
        await this.refreshRecords();
        await this.refreshPreviousPage();
      }
    });
  },

  async refreshPreviousPage() {
    const pages = getCurrentPages();
    const previousPage = pages[pages.length - 2];
    if (previousPage && typeof previousPage.forceRefreshData === 'function') {
      await previousPage.forceRefreshData();
    }
  },

  async saveRecord() {
    const { dateKey, form, editingId, saving } = this.data;
    if (saving) return;
    if (!form.time) {
      wx.showToast({ title: '请选择时间', icon: 'none' });
      return;
    }
    const volumeMl = Number(form.volume);
    if (!Number.isFinite(volumeMl) || volumeMl <= 0) {
      wx.showToast({ title: '请输入有效水量', icon: 'none' });
      return;
    }

    try {
      this.setData({ saving: true });
      wx.showLoading({ title: '保存中...' });
      const payload = {
        date: dateKey,
        timeString: form.time,
        volumeMl,
        notes: form.notes || ''
      };
      const result = editingId
        ? await WaterRecordModel.update(editingId, payload)
        : await WaterRecordModel.create(payload);
      wx.hideLoading();
      if (!result.success) {
        wx.showToast({ title: result.message || '保存失败', icon: 'none' });
        return;
      }
      const isCreate = !editingId;
      this.setData({
        sheetVisible: false,
        editingId: '',
        form: createForm()
      });
      this.setCanvasVisible(true);
      // 等 canvas 重建后再播落水动效
      this.scheduleEffect(() => {
        if (isCreate) {
          this.playSaveCelebration();
        }
      }, 80);
      await this.refreshRecords({ celebrate: true });
      await this.refreshPreviousPage();
      wx.showToast({ title: isCreate ? '喝水打卡成功' : '已更新', icon: 'success' });
    } catch (error) {
      console.error('保存喝水记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
