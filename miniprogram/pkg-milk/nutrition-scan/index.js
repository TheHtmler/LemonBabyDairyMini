const { waitForAppInitialization } = require('../../utils/index');
const { currentContext, invalidateSearchForBaby } = require('../../utils/searchSession');
const { recognitionCapabilities, pendingConfirmation, recoverConfirmation,
  chooseRecognitionImages, prepareRecognitionImages } = require('../../utils/nutritionRecognition');
const { measureCaptureRegion, cropCaptureImage } = require('./captureImage');
const FoodCategoryModel = require('../../models/foodCategory');
const { POWDER_CATEGORIES, POWDER_CATEGORY_META } = require('../../utils/formulaPowderUtils');
const FOOD_CATEGORIES = ['主食及谷薯', '蔬菜类', '水果类', '肉禽类', '水产类', '乳类及制品', '蛋类', '豆制品', '婴幼儿辅食', '零食', '饮品', '甜品', '油脂及调味品'];

Page({
  data: {
    babyUid: '', babyName: '', formSessionId: 0, available: false, loading: true, loadingSlow: false,
    error: '', reasonCode: '', pending: null, recovering: false, capturing: false,
    saved: null, existing: null, recognitionKind: 'food', categories: FOOD_CATEGORIES,
    cameraActive: false, cameraReady: false, cameraError: '', cameraPermissionDenied: false,
    cameraGeneration: 0, recognitionOpen: false, navTop: 24, navHeight: 44, navRight: 100,
    packageCapture: false, photoSlots: [{ label: '① 营养成分表', path: '' }, { label: '② 包装正面', path: '' }], activePhotoSlot: 0, packageReady: false,
    powderCategories: [POWDER_CATEGORIES.REGULAR_FORMULA, POWDER_CATEGORIES.SPECIAL_FORMULA, POWDER_CATEGORIES.ENERGY_SUPPLEMENT]
      .map(value => ({ value, label: POWDER_CATEGORY_META[value].label })),
    proteinOptions: [
      { label: '天然蛋白（优质）', value: 'natural', quality: 'premium' },
      { label: '天然蛋白（普通）', value: 'natural', quality: 'regular' },
      { label: '特殊蛋白', value: 'special', quality: '' }
    ]
  },
  onLoad(options = {}) {
    this._epoch = 0; this._captureEpoch = 0; this._unloaded = false;
    this._pageVisible = false; this._cameraSuspended = false; this._layoutVersion = 0;
    this.setData({ fromSearch: options.from === 'search', recognitionKind: options.kind === 'powder' ? 'powder' : 'food', packageCapture: options.kind === 'powder' });
    this.updateNavigationLayout();
  },
  updateNavigationLayout() {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const menuAvailable = menu && menu.width > 0 && menu.height > 0 && menu.top > 0;
    const navHeight = menuAvailable ? Math.max(44, menu.height) : 44;
    // 按微信胶囊的中心对齐，同时保留至少 44px 的返回点击区。
    this.setData({ navTop: menuAvailable ? menu.top + (menu.height - navHeight) / 2 : (windowInfo.statusBarHeight || 0) + 4,
      navHeight,
      navRight: menuAvailable ? windowInfo.windowWidth - menu.left + 12 : 100 });
  },
  onResize() { this._layoutVersion++; this.updateNavigationLayout(); },
  async onShow() {
    this._pageVisible = true;
    const epoch = ++this._epoch;
    clearTimeout(this._availabilityTimer);
    this.setData({ loading: true, loadingSlow: false, error: '', reasonCode: '' });
    this._availabilityTimer = setTimeout(() => {
      if (!this._unloaded && epoch === this._epoch && this.data.loading) this.setData({ loadingSlow: true });
    }, 1200);
    this.syncCamera();
    try {
      await waitForAppInitialization();
      if (epoch !== this._epoch || this._unloaded) return;
      const context = currentContext();
      const key = context.accountKey + ':' + context.babyUid;
      if (key !== this._contextKey) {
        this._contextKey = key; this._captureEpoch++;
        this._cameraSuspended = false;
        this.resetPhotoSlots();
        this.setData({ babyUid: context.babyUid, babyName: context.babyName,
          formSessionId: this.data.formSessionId + 1, saved: null, existing: null,
          available: false, capturing: false, recognitionOpen: false, categories: FOOD_CATEGORIES });
      }
      if (!context.accountKey || !context.babyUid) {
        this.setData({ loading: false, available: false, pending: null,
          reasonCode: 'FORBIDDEN', error: '请先选择宝宝，再识别资料' });
        return;
      }
      this.setData({ pending: pendingConfirmation(context.babyUid) });
      this.syncCamera();
      // 分类读取和识别能力分别处理，分类故障不阻断相机及识别服务。
      FoodCategoryModel.getCategories(context.babyUid).then(custom => {
        if (this.isCurrent(epoch, key)) this.setData({ categories: [...new Set([...FOOD_CATEGORIES,
          ...(Array.isArray(custom) ? custom : []).map(item => item.name).filter(Boolean)])] });
      }).catch(() => {});
      const config = await this.getAvailability(key, context.babyUid);
      if (!this.isCurrent(epoch, key)) return;
      this.setData({ available: config.available === true, loading: false,
        reasonCode: config.reasonCode || '', error: config.available ? '' : config.message || '识别服务暂时不可用，请重试' });
    } catch (error) {
      if (epoch !== this._epoch || this._unloaded) return;
      this.setData({ loading: false, available: false,
        reasonCode: error.code || 'SERVICE_UNAVAILABLE', error: error.message || '暂时无法识别，请重试' });
    } finally {
      if (epoch === this._epoch && !this._unloaded) {
        clearTimeout(this._availabilityTimer); this.setData({ loadingSlow: false }); this.syncCamera();
      }
    }
  },
  async getAvailability(key, babyUid) {
    // 从相册或权限设置返回时复用短期预检；正式识别仍由云端逐次验证权限与额度。
    const cached = this._availability;
    if (cached && cached.key === key && cached.result.available && Date.now() - cached.at < 60000) return cached.result;
    if (this._availabilityRequest && this._availabilityRequest.key === key) return this._availabilityRequest.promise;
    const request = { key };
    request.promise = recognitionCapabilities({ babyUid }).then(result => {
      if (!this._unloaded && key === this._contextKey) this._availability = { key, result, at: Date.now() };
      return result;
    }).finally(() => { if (this._availabilityRequest === request) this._availabilityRequest = null; });
    this._availabilityRequest = request;
    return request.promise;
  },
  isCurrent(epoch, key) {
    const current = currentContext();
    return !this._unloaded && epoch === this._epoch && key === current.accountKey + ':' + current.babyUid;
  },
  onHide() {
    this._pageVisible = false;
    if (this._cancelPhoto) this._cancelPhoto();
    this.syncCamera();
  },
  onUnload() {
    this._unloaded = true; this._pageVisible = false; this._epoch++; this._captureEpoch++; this._cameraContext = null;
    clearTimeout(this._availabilityTimer); this._availability = null;
    if (this._cancelPhoto) this._cancelPhoto();
  },
  syncCamera() {
    if (this._unloaded) return;
    const cameraActive = !!(this._pageVisible && !this._cameraSuspended && !this.data.recognitionOpen &&
      !this.data.pending && !this.data.saved && !this.data.existing && !this.data.cameraError && (this.data.loading || this.data.available));
    if (cameraActive === this.data.cameraActive) return;
    this._cameraContext = null;
    this.setData({ cameraActive, cameraReady: false, cameraGeneration: this.data.cameraGeneration + 1 });
  },
  onCameraReady(event) {
    if (!this.isCurrentCamera(event)) return;
    this._cameraContext = wx.createCameraContext();
    this.setData({ cameraReady: true });
  },
  isCurrentCamera(event) {
    return !this._unloaded && this._pageVisible && this.data.cameraActive &&
      Number(event.currentTarget.dataset.generation) === this.data.cameraGeneration;
  },
  onCameraError(event) {
    if (!this.isCurrentCamera(event)) return;
    const generation = this.data.cameraGeneration;
    this.setData({ cameraReady: false, cameraError: '无法打开相机，请检查微信的相机权限，或从相册选择。' });
    wx.getSetting({ success: result => {
      if (this._unloaded || generation + 1 !== this.data.cameraGeneration || !this.data.cameraError) return;
      const denied = result.authSetting['scope.camera'] === false;
      this.setData({ cameraPermissionDenied: denied,
        cameraError: denied ? '允许使用相机后即可拍摄，也可以直接从相册选择。' : this.data.cameraError });
    } });
    this.syncCamera();
  },
  onCameraStopped(event) {
    if (!this.isCurrentCamera(event) || this._cameraSuspended) return;
    this.setData({ cameraReady: false, cameraError: '相机已暂停，点击重新开启后继续拍摄。' });
    this.syncCamera();
  },
  resumeCamera() {
    if (this.data.capturing || this.data.recognitionOpen) return;
    if (this.data.cameraPermissionDenied) {
      wx.openSetting({ success: result => {
        if (!this._unloaded && result.authSetting['scope.camera']) {
          this.setData({ cameraError: '', cameraPermissionDenied: false }); this.syncCamera();
        }
      } });
      return;
    }
    this.setData({ cameraError: '', cameraPermissionDenied: false }); this.syncCamera();
  },
  onRecognitionVisibility(event) {
    const open = event.detail.open === true;
    const patch = { recognitionOpen: open };
    if (!open && this.data.recognitionOpen) {
      // 关闭核对层即结束本次前台操作，不等待已失效的云请求返回。
      this._captureEpoch++; this._cameraSuspended = false; patch.capturing = false;
    }
    this.setData(patch, () => this.syncCamera());
  },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/daily-feeding/index' }) }); },
  showPhotoHelp() {
    if (this.data.capturing) return;
    wx.showModal({ title: this.data.recognitionKind === 'powder' ? '拍摄奶粉' : '拍摄食物',
      content: this.data.packageCapture ? '先拍完整营养成分表，再拍同一商品的正面。点选图片位置可重拍，拍齐后点击识别。' : '食物实物拍清全貌即可。包装食品可选择“双面拍”，分别拍营养表与正面。', showCancel: false, confirmText: '知道了' });
  },
  retryAvailability() {
    if (!this.data.loading && !this.data.capturing) { this._availability = null; return this.onShow(); }
  },
  selectRecognitionKind(event) {
    const kind = event.currentTarget.dataset.kind;
    if (!['powder', 'food'].includes(kind) || kind === this.data.recognitionKind ||
        this.data.capturing || this.data.recovering || this.data.pending) return;
    const component = this.selectComponent('#scanner');
    if (component && component.isBusy()) return;
    this.resetPhotoSlots();
    this.setData({ recognitionKind: kind, packageCapture: kind === 'powder' });
  },
  resetPhotoSlots() {
    this.setData({ photoSlots: [{ label: '① 营养成分表', path: '' }, { label: '② 包装正面', path: '' }], activePhotoSlot: 0, packageReady: false });
  },
  togglePackageCapture() {
    if (this.data.capturing || this.data.recognitionOpen || this.data.recognitionKind === 'powder') return;
    this.resetPhotoSlots();
    this.setData({ packageCapture: !this.data.packageCapture, error: '' });
  },
  selectPhotoSlot(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.data.capturing || this.data.recognitionOpen || ![0, 1].includes(index)) return;
    // 先拍营养表；已有图片的位置可选中后重拍或从相册替换。
    if (index === 1 && !this.data.photoSlots[0].path) return;
    this.setData({ activePhotoSlot: index, packageReady: false, error: '' });
  },
  takePhoto() { return this.data.packageCapture && this.data.packageReady ? this.recognizePackage() : this.start('camera'); },
  chooseAlbum() { return this.start('album'); },
  async recognizePackage() {
    if (!this.data.packageReady || this.data.capturing || !this.data.available || this.data.loading || this.data.pending) return;
    const component = this.selectComponent('#scanner');
    if (!component || component.isBusy()) return;
    const epoch = ++this._captureEpoch; const key = this._contextKey;
    const slots = this.data.photoSlots;
    this._cameraSuspended = true; this.setData({ capturing: true, error: '' }); this.syncCamera();
    try {
      await component.startRecognition({ paths: slots.map(slot => slot.path), previewFrame: slots[0].previewFrame || null,
        coverImageIndex: 1, mode: 'auto', recognitionKind: this.data.recognitionKind });
    } finally {
      if (this.isCurrentCapture(epoch, key)) {
        this._cameraSuspended = false; this.setData({ capturing: false }); this.syncCamera();
      }
    }
  },
  capturePhoto() {
    const camera = this._cameraContext;
    return new Promise((resolve, reject) => {
      let timer; let finished = false;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (this._cancelPhoto === cancel) this._cancelPhoto = null;
        callback(value);
      };
      const cancel = () => finish(reject, { errMsg: 'takePhoto:fail cancel' });
      this._cancelPhoto = cancel;
      timer = setTimeout(() => finish(reject, new Error('拍照超时，请重试或从相册选择')), 8000);
      try { camera.takePhoto({ quality: 'high', success: result => finish(resolve, result), fail: error => finish(reject, error) }); }
      catch (error) { finish(reject, error); }
    });
  },
  isCurrentCapture(epoch, key) {
    const context = currentContext();
    return !this._unloaded && epoch === this._captureEpoch && key === this._contextKey &&
      key === context.accountKey + ':' + context.babyUid;
  },
  async start(source) {
    if (!this.data.available || this.data.loading || this.data.pending || this.data.recovering || this.data.capturing) return;
    if (source === 'camera' && (!this.data.cameraReady || !this._cameraContext)) return;
    const component = this.selectComponent('#scanner');
    if (!component) { this.setData({ error: '识别界面尚未加载，请返回后重新进入' }); return; }
    if (component.isBusy()) return;
    const captureEpoch = ++this._captureEpoch;
    const key = this._contextKey;
    const recognitionKind = this.data.recognitionKind;
    const layoutVersion = this._layoutVersion;
    this.setData({ capturing: true, saved: null, existing: null, error: '' });
    try {
      let paths; let previewFrame = null;
      if (source === 'camera') {
        const region = await measureCaptureRegion(this);
        if (!this.isCurrentCapture(captureEpoch, key)) return;
        const photo = await this.capturePhoto();
        if (!this.isCurrentCapture(captureEpoch, key)) return;
        if (layoutVersion !== this._layoutVersion) throw new Error('画面尺寸已变化，请重新拍摄');
        // 取得照片后释放原生相机，避免相机层遮挡识别核对弹窗。
        this._cameraSuspended = true; this.syncCamera();
        const cropped = await cropCaptureImage(photo.tempImagePath, region);
        if (!this.isCurrentCapture(captureEpoch, key)) return;
        paths = await prepareRecognitionImages([cropped]);
        previewFrame = region.previewFrame;
      } else {
        this._cameraSuspended = true; this.syncCamera();
        paths = await chooseRecognitionImages({ sourceType: ['album'] });
      }
      if (!this.isCurrentCapture(captureEpoch, key)) return;
      if (this.data.packageCapture) {
        const index = this.data.activePhotoSlot;
        const slots = this.data.photoSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, path: paths[0], previewFrame } : slot);
        const next = slots.findIndex(slot => !slot.path);
        this.setData({ photoSlots: slots, activePhotoSlot: next < 0 ? index : next, packageReady: next < 0 });
      } else {
        // 双面或单张均由模型自动判断食品类别，不再事后要求用户选择。
        await component.startRecognition({ paths, previewFrame, coverImageIndex: 0, mode: 'auto', recognitionKind });
      }
    } catch (error) {
      if (this.isCurrentCapture(captureEpoch, key) && !/cancel/i.test(error.errMsg || error.message || '')) {
        const message = error.message || (source === 'camera' ? '拍照失败，请重试或从相册选择' : '无法选择图片，请重试');
        this.setData({ error: message });
      }
    } finally {
      if (this.isCurrentCapture(captureEpoch, key)) {
        this._cameraSuspended = false;
        this.setData({ capturing: false, packageReady: this.data.packageCapture && this.data.photoSlots.every(slot => !!slot.path) });
        this.syncCamera();
      }
    }
  },
  onSaved(event) {
    if (event.detail.babyUid !== this.data.babyUid) return;
    this.setData({ saved: event.detail, pending: null, existing: null, error: '' });
    this.syncCamera();
  },
  onExisting(event) {
    if (event.detail.babyUid && event.detail.babyUid !== this.data.babyUid) return;
    this.setData({ existing: event.detail });
    this.syncCamera();
  },
  continueScan() {
    this.resetPhotoSlots();
    this.setData({ saved: null, existing: null, error: '', pending: pendingConfirmation(this.data.babyUid) });
    this.syncCamera();
  },
  async recover() {
    const pending = this.data.pending;
    if (!pending || this.data.recovering) return;
    const epoch = this._epoch; const key = this._contextKey;
    this.setData({ recovering: true });
    try {
      const result = await recoverConfirmation(pending);
      if (result.state === 'saved') invalidateSearchForBaby(pending.babyUid, { ...result.savedResult, accountKey: key.split(':')[0] });
      if (!this.isCurrent(epoch, key)) return;
      if (result.state === 'saved') this.setData({ pending: null, saved: result.savedResult, error: '' });
      else if (['failed', 'not_submitted'].includes(result.state)) this.setData({ pending: null, error: '上次资料未保存，可以重新识别' });
      else this.setData({ error: result.state === 'processing' ? '仍在保存，请稍后恢复状态' : '暂不能确认保存结果，请稍后恢复，避免重复添加' });
    } catch (error) { if (this.isCurrent(epoch, key)) this.setData({ error: error.message }); }
    finally { if (this.isCurrent(epoch, key)) { this.setData({ recovering: false }); this.syncCamera(); } }
  },
  openManual(event) {
    const kind = event.currentTarget.dataset.kind || this.data.recognitionKind;
    wx.navigateTo({ url: kind === 'powder' ? '/pkg-milk/powder-management/index' : '/pkg-milk/food-management/index' });
  },
  openLibrary() {
    if (!this.isCurrent(this._epoch, this._contextKey)) { wx.showToast({ title: '宝宝已切换，请重新打开资料', icon: 'none' }); return; }
    const value = this.data.existing || this.data.saved || {};
    const powder = value.targetType === 'powder' || value.mode === 'powder_label' || value.powderId;
    const id = value.itemId || value.powderId || value.foodId || value.targetId || '';
    wx.navigateTo({ url: (powder ? '/pkg-milk/powder-management/index' : '/pkg-milk/food-management/index') + '?searchId=' + encodeURIComponent(id) + '&searchScope=mine&searchBabyUid=' + encodeURIComponent(this.data.babyUid) });
  },
  returnToSearch() {
    if (this.data.fromSearch) wx.navigateBack();
    else wx.navigateTo({ url: '/pkg-milk/search/index' });
  }
});
