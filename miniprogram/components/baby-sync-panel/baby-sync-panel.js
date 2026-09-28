// 宝宝数据同步面板：来源宝宝选择 + 数据类型 + 冲突策略 + 执行同步。
// 复用于三处场景：
// 1. 「我的 → 同步数据」弹层（targetBabyUid=当前宝宝，显示「立即同步」按钮）
// 2. 宝宝信息编辑页（同上）
// 3. 添加宝宝页（只收集选择，保存成功后由页面调 runImportForTarget 执行）
// 底层 importBabyData 幂等，重复执行不会产生重复数据。
Component({
  properties: {
    // 同步目标宝宝；为空表示目标尚未创建（添加宝宝场景）
    targetBabyUid: { type: String, value: '' },
    // 文案中的目标称呼，如「当前宝宝」「新宝宝」
    targetLabel: { type: String, value: '当前宝宝' },
    // 是否显示「立即同步」按钮（添加宝宝场景由页面保存后统一执行，不显示）
    showRunButton: { type: Boolean, value: false },
    // 是否显示区块标题（弹层场景自带标题，可关闭）
    showTitle: { type: Boolean, value: true },
    // 扁平模式：去掉外层卡片包裹（用于底部弹层等已有容器的场景，避免层层嵌套）
    plain: { type: Boolean, value: false },
    // 没有来源宝宝时是否显示空态提示（弹层场景需要；表单场景整体隐藏）
    showEmptyHint: { type: Boolean, value: false },
    // 预选来源宝宝（库管理页「有更新」横幅跳入时传入）
    presetSourceUid: { type: String, value: '' }
  },

  data: {
    sources: [],
    sourceNames: [],
    sourceIndex: 0,
    loading: true, // 来源宝宝列表加载中（弹层场景显示 loading 态，避免先闪空态）
    types: { foods: true, recipes: true, powders: true, categories: true },
    // 可同步的数据类型说明（key 对应 types 字段）。
    // 母乳成分参数（nutrition）有系统默认值、极少修改，不在面板展示；
    // 底层 importBabyData 仍支持，需要时可代码开启。
    typeOptions: [
      { key: 'foods', icon: '🍎', name: '食物库', desc: '自定义食物及其营养参数，记录辅食时可直接选用' },
      { key: 'recipes', icon: '🥣', name: '食谱', desc: '成品菜配方与原料配比，按食用克数记录营养' },
      { key: 'powders', icon: '🍼', name: '奶粉档案', desc: '我的奶粉与冲配比例，配奶计算时使用' },
      { key: 'categories', icon: '🗂️', name: '食物分类', desc: '自定义食物分类，食物库按分类归档整理' }
    ],
    // 冲突策略：skip=只补充新数据（默认）；overwrite=已有条目覆盖为来源宝宝的版本
    strategy: 'skip',
    strategyOptions: [
      { key: 'skip', name: '只补充新数据', tag: '推荐', desc: '已有同名数据保持不变，仅复制当前宝宝没有的数据' },
      { key: 'overwrite', name: '覆盖为来源宝宝的版本', desc: '已有同名数据更新为来源宝宝的内容；当前宝宝多出来的数据不会删除' }
    ],
    importing: false
  },

  lifetimes: {
    attached() {
      this.loadSources();
    }
  },

  observers: {
    // 目标宝宝异步加载完成后，来源列表要重新排除目标；
    // 与上次加载使用的目标一致则跳过，避免列表闪 loading
    'targetBabyUid': function () {
      const target = this.data.targetBabyUid || '';
      if (target && target === this._loadedTarget) return;
      this.loadSources();
    },
    'presetSourceUid': function () {
      this.applyPresetSource();
    }
  },

  methods: {
    async loadSources() {
      this.setData({ loading: true });
      try {
        const app = getApp();
        if (app && app.openidReady && typeof app.openidReady.then === 'function') {
          await app.openidReady;
        }
        const { listAccessibleBabies } = require('../../utils/babyAccount');
        // 编辑/弹层场景（showRunButton）目标是当前宝宝，必须从来源里排除；
        // targetBabyUid 属性可能因页面异步加载尚未传入，兜底取全局当前宝宝。
        // 添加宝宝场景（!showRunButton）目标尚未创建，来源为全部可访问宝宝，不排除。
        const target = !this.data.showRunButton
          ? ''
          : (this.data.targetBabyUid
            || (app && app.globalData && app.globalData.babyUid)
            || wx.getStorageSync('baby_uid')
            || '');
        const sources = (await listAccessibleBabies())
          .filter((baby) => baby.babyUid && baby.babyUid !== target);
        this._loadedTarget = target;
        this.setData({
          sources,
          sourceNames: sources.map((baby) => (
            baby.role === 'participant' ? `${baby.name}（参与）` : baby.name
          )),
          loading: false
        });
        this.applyPresetSource();
      } catch (error) {
        console.warn('加载同步来源宝宝失败:', error);
        this.setData({ sources: [], sourceNames: [], sourceIndex: 0, loading: false });
      }
    },

    // 供页面在 onShow 等时机刷新来源列表
    refresh() {
      return this.loadSources();
    },

    applyPresetSource() {
      const preset = this.data.presetSourceUid;
      if (!preset || !this.data.sources.length) return;
      const index = this.data.sources.findIndex((baby) => baby.babyUid === preset);
      if (index >= 0) {
        this.setData({ sourceIndex: index });
      }
    },

    onSourceChange(e) {
      this.setData({ sourceIndex: Number(e.detail.value) || 0 });
    },

    onToggleType(e) {
      const { type } = e.currentTarget.dataset;
      if (!type || !(type in (this.data.types || {}))) return;
      this.setData({ [`types.${type}`]: !this.data.types[type] });
    },

    onStrategyChange(e) {
      const { strategy } = e.currentTarget.dataset;
      if (strategy !== 'skip' && strategy !== 'overwrite') return;
      this.setData({ strategy });
    },

    selectedTypes() {
      const types = this.data.types || {};
      return Object.keys(types).filter((key) => types[key]);
    },

    getSelection() {
      return {
        source: this.data.sources[this.data.sourceIndex] || null,
        types: { ...this.data.types },
        strategy: this.data.strategy
      };
    },

    showResultModal(title, content) {
      return new Promise((resolve) => {
        wx.showModal({
          title,
          content: content || '没有需要同步的数据',
          showCancel: false,
          confirmText: '知道了',
          success: resolve,
          fail: resolve
        });
      });
    },

    // 「立即同步」按钮：目标取 targetBabyUid 属性，兜底全局当前宝宝
    async runImport() {
      const app = getApp();
      const target = this.data.targetBabyUid
        || (app.globalData && app.globalData.babyUid)
        || wx.getStorageSync('baby_uid');
      if (!target) {
        wx.showToast({ title: '未找到当前宝宝', icon: 'none' });
        return false;
      }
      return this.runImportForTarget(target);
    },

    // 执行同步；添加宝宝场景由页面在保存成功后调用并传入新 babyUid。
    // 无来源宝宝时静默跳过（面板未展示，不算用户错误）。
    async runImportForTarget(targetBabyUid) {
      const { source, types, strategy } = this.getSelection();
      if (!source || !source.babyUid) return false;
      if (source.babyUid === targetBabyUid) {
        wx.showToast({ title: '来源宝宝与当前宝宝相同，请重新选择', icon: 'none' });
        return false;
      }
      if (!this.selectedTypes().length) {
        wx.showToast({ title: '请选择要同步的内容', icon: 'none' });
        return false;
      }
      if (this.data.importing) return false;
      this.setData({ importing: true });
      wx.showLoading({ title: '正在同步数据...', mask: true });
      try {
        const { importBabyData, formatImportSummary } = require('../../utils/babyDataImport');
        const summary = await importBabyData(source.babyUid, targetBabyUid, types, {
          conflictStrategy: strategy
        });
        wx.hideLoading();
        await this.showResultModal('数据同步完成', formatImportSummary(summary));
        this.triggerEvent('done', { summary });
        return true;
      } catch (error) {
        wx.hideLoading();
        console.error('数据同步失败:', error);
        await this.showResultModal(
          '数据同步未完成',
          `原因：${(error && error.message) || '未知错误'}。可稍后重新执行同步；已同步的数据不会重复。`
        );
        return false;
      } finally {
        this.setData({ importing: false });
      }
    }
  }
});
