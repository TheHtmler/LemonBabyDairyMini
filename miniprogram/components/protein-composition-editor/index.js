const FoodModel = require('../../models/food');
const { currentContext } = require('../../utils/searchSession');
const { MAX_COMPONENTS, validateProteinComposition, compositionProteinPer100g } = require('../../utils/search-core/proteinComposition');
const { createEmptyProteinComponent, isEmptyProteinComponent } = require('../../utils/proteinCompositionForm');

Component({
  properties: {
    value: Object, babyUid: String, disabled: Boolean,
    nutritionBasis: Object, totalProtein: { type: null, value: '' }
  },
  data: {
    rows: [], libraryOpen: false, libraryLoading: false, libraryError: '', libraryKeyboardHeight: 0,
    libraryScope: 'mine', query: '', candidates: [], candidateCount: 0, candidateLimit: 20,
    canChooseFood: true, canAddRow: true,
    units: ['%', 'g'], error: '', preview: ''
  },
  observers: {
    value(value) {
      const key = JSON.stringify(value || null);
      if (key === this._valueKey) return;
      this._valueKey = key;
      this._validationRequested = false;
      this.closeLibrary();
      const source = Array.isArray(value?.premiumComponents) ? value.premiumComponents : [];
      this.updateRows(source.map(row => this.viewRow(row)));
      this.updatePreview();
    },
    'nutritionBasis,totalProtein'() { this.updatePreview(); },
    babyUid() { this._foods = []; this._libraryLoaded = false; this.closeLibrary(); this.setData({ candidates: [], candidateCount: 0 }); },
    disabled(value) { if (value) this.closeLibrary(); }
  },
  lifetimes: {
    attached() { if (!this.data.rows.length) { this.updateRows([]); this.updatePreview(); } },
    detached() { this._loadEpoch = (this._loadEpoch || 0) + 1; }
  },
  pageLifetimes: { hide() { this.closeLibrary(); } },
  methods: {
    viewRow(row = createEmptyProteinComponent()) {
      row = row || createEmptyProteinComponent();
      const unit = row.amount?.unit || '%';
      return { ...row, rowKey: String(this._rowSerial = (this._rowSerial || 0) + 1), name: row.name || '', proteinPer100g: row.proteinPer100g ?? '',
        amount: { value: row.amount?.value ?? '', unit, relation: row.amount?.relation || 'eq' },
        source: row.source || { type: 'manual', foodId: null },
        unitIndex: unit === 'g' ? 1 : 0 };
    },
    availableFoodRowIndex(rows = this.data.rows) {
      const blank = value => value == null || String(value).trim() === '';
      return rows.findIndex(row => blank(row.name) && blank(row.proteinPer100g));
    },
    updateRows(rows) {
      const next = rows.length ? rows : [this.viewRow()];
      this.setData({ rows: next, canAddRow: next.length < MAX_COMPONENTS,
        canChooseFood: next.length < MAX_COMPONENTS || this.availableFoodRowIndex(next) >= 0 });
    },
    composition() {
      return { basis: { quantity: 100, unit: 'g' }, premiumComponents: this.data.rows.map(row => ({
        name: row.name, amount: { ...row.amount }, proteinPer100g: row.proteinPer100g, source: { ...row.source }
      })) };
    },
    emitChange() {
      const value = this.composition(); this._valueKey = JSON.stringify(value);
      this.updatePreview(); this.triggerEvent('change', { value });
    },
    showValidationError(message) {
      this._validationRequested = true;
      this.setData({ error: message || '请填写优质蛋白成分', preview: '' });
    },
    updatePreview() {
      try {
        const composition = validateProteinComposition({ proteinSource: 'natural', proteinQuality: 'mixed',
          proteinComposition: this.composition(), nutritionBasis: this.properties.nutritionBasis,
          nutritionPerBasis: { protein: this.properties.totalProtein } });
        this.setData({ error: '', preview: '约' + compositionProteinPer100g(composition).toFixed(2) + 'g' });
      } catch (error) {
        const started = this.data.rows.some(row => !isEmptyProteinComponent(row));
        this.setData({ preview: '', error: this._validationRequested || started ? error.message : '' });
      }
    },
    addManual() {
      if (this.properties.disabled || !this.data.canAddRow) return;
      this.updateRows(this.data.rows.concat(this.viewRow())); this.emitChange();
    },
    removeRow(event) {
      if (this.properties.disabled) return;
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= this.data.rows.length) return;
      this._validationRequested = false;
      // 最后一行仅清空；更换行标识让原生输入框同步清除旧内容。
      this.updateRows(this.data.rows.length === 1 ? [this.viewRow()] : this.data.rows.filter((_, i) => i !== index));
      this.emitChange();
    },
    editRow(event) {
      if (this.properties.disabled) return;
      const { field } = event.currentTarget.dataset;
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= this.data.rows.length) return;
      const rows = this.data.rows.slice();
      const row = { ...rows[index], amount: { ...rows[index].amount }, source: { ...rows[index].source } };
      if (field === 'unit') {
        const selectedIndex = Number(event.detail.value);
        if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= this.data.units.length) return;
        row.amount.unit = this.data.units[selectedIndex];
        row.unitIndex = selectedIndex;
      } else {
        if (!['name', 'amount.value', 'proteinPer100g'].includes(field)) return;
        if (field === 'amount.value') row.amount.value = event.detail.value;
        else {
          row[field] = event.detail.value;
          row.source = { type: 'manual', foodId: null };
        }
      }
      // 数组统一整体更新；rows.0.name 会被小程序按对象路径解析，破坏行数组。
      rows[index] = row;
      this.updateRows(rows); this.emitChange();
    },
    async openLibrary() {
      if (this.properties.disabled || !this.data.canChooseFood) return;
      wx.hideKeyboard();
      this.setData({ libraryOpen: true, query: '', candidateLimit: 20, libraryError: '', libraryKeyboardHeight: 0 });
      if (this._libraryLoaded) { this.filterLibrary(); return; }
      await this.loadLibrary();
    },
    closeLibrary() {
      this._loadEpoch = (this._loadEpoch || 0) + 1;
      const wasOpen = this.data.libraryOpen;
      if (wasOpen || this.data.libraryLoading) this.setData({ libraryOpen: false, libraryLoading: false, libraryKeyboardHeight: 0 });
      if (wasOpen) wx.hideKeyboard();
    },
    onLibraryKeyboardHeight(event) {
      if (this.data.libraryOpen) this.setData({ libraryKeyboardHeight: Math.max(0, Number(event.detail.height) || 0) });
    },
    stopEvent() {},
    async loadLibrary() {
      if (this.properties.disabled || this.data.libraryLoading || !this.properties.babyUid) return;
      const epoch = this._loadEpoch = (this._loadEpoch || 0) + 1;
      const context = currentContext(); const babyUid = this.properties.babyUid;
      const active = () => epoch === this._loadEpoch && babyUid === this.properties.babyUid && context.accountKey === currentContext().accountKey && context.babyUid === currentContext().babyUid;
      this.setData({ libraryLoading: true, libraryError: '' });
      try {
        const foods = await FoodModel.getAvailableFoods(babyUid);
        if (!active()) return;
        this._foods = foods.filter(food => food.proteinSource === 'natural' && food.proteinQuality === 'premium')
          .map(food => {
            const basis = food.nutritionBasis || {}; const protein = food.nutritionPerBasis?.protein;
            if (basis.unit !== 'g' || !(Number(basis.quantity) > 0) || protein == null || !Number.isFinite(Number(protein)) || Number(protein) < 0) return null;
            const proteinPer100g = Number(protein) * 100 / Number(basis.quantity);
            if (proteinPer100g > 100) return null;
            return { id: food._id, name: food.name, scope: food.isSystem ? 'system' : 'mine',
              proteinPer100g, proteinText: proteinPer100g.toFixed(2),
              searchText: [food.name, food.category, food.aliasText].join(' ').toLowerCase() };
          }).filter(Boolean);
        this._libraryLoaded = true; this.filterLibrary();
      } catch (error) { if (active()) this.setData({ libraryError: error.message || '食物库加载失败，请重试' }); }
      finally { if (active()) this.setData({ libraryLoading: false }); }
    },
    changeScope(event) {
      if (this.properties.disabled) return;
      this.setData({ libraryScope: event.currentTarget.dataset.scope, candidateLimit: 20 }); this.filterLibrary();
    },
    searchLibrary(event) { if (!this.properties.disabled) { this.setData({ query: event.detail.value, candidateLimit: 20 }); this.filterLibrary(); } },
    moreCandidates() {
      if (this.properties.disabled || this.data.candidateLimit >= this.data.candidateCount) return;
      this.setData({ candidateLimit: this.data.candidateLimit + 20 }); this.filterLibrary();
    },
    filterLibrary() {
      const query = this.data.query.trim().toLowerCase();
      const foods = (this._foods || []).filter(food => food.scope === this.data.libraryScope && (!query || food.searchText.includes(query)));
      this.setData({ candidates: foods.slice(0, this.data.candidateLimit), candidateCount: foods.length });
    },
    selectFood(event) {
      if (this.properties.disabled || !this.data.canChooseFood) return;
      const food = this.data.candidates[Number(event.currentTarget.dataset.index)]; if (!food) return;
      const index = this.availableFoodRowIndex();
      const previous = index >= 0 ? this.data.rows[index] : null;
      const row = this.viewRow({ name: food.name, proteinPer100g: String(food.proteinPer100g),
        ...(previous ? { amount: { ...previous.amount } } : {}),
        source: { type: food.scope === 'system' ? 'system_food' : 'user_food', foodId: food.id } });
      const rows = this.data.rows.slice();
      if (previous) { row.rowKey = previous.rowKey; rows[index] = row; }
      else rows.push(row);
      this.updateRows(rows); this.closeLibrary(); this.emitChange();
    }
  }
});
