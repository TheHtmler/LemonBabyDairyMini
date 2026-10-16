const { waitForAppInitialization } = require('../../utils/index');
const { currentContext, invalidateSearchForBaby } = require('../../utils/searchSession');
const { recognitionCapabilities, pendingConfirmation, recoverConfirmation } = require('../../utils/nutritionRecognition');
const FoodCategoryModel = require('../../models/foodCategory');
const { POWDER_CATEGORIES, POWDER_CATEGORY_META } = require('../../utils/formulaPowderUtils');
const FOOD_CATEGORIES = ['主食及谷薯', '蔬菜类', '水果类', '肉禽类', '水产类', '乳类及制品', '蛋类', '豆制品', '婴幼儿辅食', '零食', '饮品', '甜品', '油脂及调味品'];

Page({
  data: {
    babyUid: '', babyName: '', formSessionId: 0, available: false, loading: true,
    error: '', reasonCode: '', pending: null, recovering: false, capturing: false,
    saved: null, existing: null, categories: FOOD_CATEGORIES,
    powderCategories: [POWDER_CATEGORIES.REGULAR_FORMULA, POWDER_CATEGORIES.SPECIAL_FORMULA, POWDER_CATEGORIES.ENERGY_SUPPLEMENT]
      .map(value => ({ value, label: POWDER_CATEGORY_META[value].label })),
    proteinOptions: [
      { label: '天然蛋白（优质）', value: 'natural', quality: 'premium' },
      { label: '天然蛋白（普通）', value: 'natural', quality: 'regular' },
      { label: '特殊蛋白', value: 'special', quality: '' }
    ]
  },
  onLoad() { this._epoch = 0; this._captureEpoch = 0; this._unloaded = false; },
  onReady() { this._ready = true; this.startCameraOnce(); },
  async onShow() {
    const epoch = ++this._epoch;
    this.setData({ loading: true, error: '', reasonCode: '' });
    try {
      await waitForAppInitialization();
      if (epoch !== this._epoch || this._unloaded) return;
      const context = currentContext();
      const key = context.accountKey + ':' + context.babyUid;
      if (key !== this._contextKey) {
        this._contextKey = key; this._autoStarted = false; this._captureEpoch++;
        this.setData({ babyUid: context.babyUid, babyName: context.babyName,
          formSessionId: this.data.formSessionId + 1, saved: null, existing: null,
          available: false, capturing: false, categories: FOOD_CATEGORIES });
      }
      if (!context.accountKey || !context.babyUid) {
        this.setData({ loading: false, available: false, pending: null,
          reasonCode: 'FORBIDDEN', error: '请先选择宝宝，再识别资料' });
        return;
      }
      this.setData({ pending: pendingConfirmation(context.babyUid) });
      // 分类读取和识别能力分别处理，分类故障不阻断相机及识别服务。
      FoodCategoryModel.getCategories(context.babyUid).then(custom => {
        if (this.isCurrent(epoch, key)) this.setData({ categories: [...new Set([...FOOD_CATEGORIES,
          ...(Array.isArray(custom) ? custom : []).map(item => item.name).filter(Boolean)])] });
      }).catch(() => {});
      const config = await recognitionCapabilities({ babyUid: context.babyUid });
      if (!this.isCurrent(epoch, key)) return;
      this.setData({ available: config.available === true, loading: false,
        reasonCode: config.reasonCode || '', error: config.available ? '' : config.message || '识别服务暂时不可用，请重试' });
      this.startCameraOnce();
    } catch (error) {
      if (epoch !== this._epoch || this._unloaded) return;
      this.setData({ loading: false, available: false,
        reasonCode: error.code || 'SERVICE_UNAVAILABLE', error: error.message || '识别服务连接失败，请重试' });
    }
  },
  isCurrent(epoch, key) {
    const current = currentContext();
    return !this._unloaded && epoch === this._epoch && key === current.accountKey + ':' + current.babyUid;
  },
  onUnload() { this._unloaded = true; this._epoch++; this._captureEpoch++; this._ready = false; },
  retryAvailability() { if (!this.data.loading && !this.data.capturing) return this.onShow(); },
  startCameraOnce() {
    if (!this._ready || this._autoStarted || this.data.loading || !this.data.available || this.data.pending) return;
    this._autoStarted = true;
    return this.takePhoto();
  },
  takePhoto() { return this.start(['camera'], 1); },
  chooseAlbum() { return this.start(['album'], 3); },
  async start(sourceType, count) {
    if (!this.data.available || this.data.loading || this.data.pending || this.data.recovering || this.data.capturing) return;
    const component = this.selectComponent('#scanner');
    if (!component) { this.setData({ error: '识别界面尚未加载，请返回后重新进入' }); return; }
    if (component.isBusy()) return;
    this._autoStarted = true;
    const captureEpoch = ++this._captureEpoch;
    const key = this._contextKey;
    this.setData({ capturing: true, saved: null, existing: null, error: '' });
    try { await component.startRecognition({ sourceType, count, mode: 'auto' }); }
    finally {
      if (!this._unloaded && captureEpoch === this._captureEpoch && key === this._contextKey) this.setData({ capturing: false });
    }
  },
  onSaved(event) {
    if (event.detail.babyUid !== this.data.babyUid) return;
    this.setData({ saved: event.detail, pending: null, existing: null, error: '' });
  },
  onExisting(event) {
    if (event.detail.babyUid && event.detail.babyUid !== this.data.babyUid) return;
    this.setData({ existing: event.detail });
  },
  async recover() {
    const pending = this.data.pending;
    if (!pending || this.data.recovering) return;
    const epoch = this._epoch; const key = this._contextKey;
    this.setData({ recovering: true });
    try {
      const result = await recoverConfirmation(pending);
      if (result.state === 'saved') invalidateSearchForBaby(pending.babyUid);
      if (!this.isCurrent(epoch, key)) return;
      if (result.state === 'saved') this.setData({ pending: null, saved: result.savedResult, error: '' });
      else if (['failed', 'not_submitted'].includes(result.state)) this.setData({ pending: null, error: '上次资料未保存，可以重新识别' });
      else this.setData({ error: result.state === 'processing' ? '仍在保存，请稍后恢复状态' : '暂不能确认保存结果，请稍后恢复，避免重复添加' });
    } catch (error) { if (this.isCurrent(epoch, key)) this.setData({ error: error.message }); }
    finally { if (this.isCurrent(epoch, key)) this.setData({ recovering: false }); }
  },
  openManual(event) {
    const kind = event.currentTarget.dataset.kind;
    wx.navigateTo({ url: kind === 'powder' ? '/pkg-milk/powder-management/index' : '/pkg-milk/food-management/index' });
  },
  openLibrary() {
    const value = this.data.existing || this.data.saved || {};
    const powder = value.targetType === 'powder' || value.mode === 'powder_label' || value.powderId;
    const id = value.itemId || value.powderId || value.foodId || value.targetId || '';
    wx.navigateTo({ url: (powder ? '/pkg-milk/powder-management/index' : '/pkg-milk/food-management/index') + '?searchId=' + encodeURIComponent(id) });
  }
});
