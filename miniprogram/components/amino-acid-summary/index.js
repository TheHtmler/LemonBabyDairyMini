const { getBabyUid } = require('../../utils/index');
const { collectIntakes, summarizeIntakes } = require('../../utils/aminoAcidIntake');
const { loadAminoAcidRecords } = require('../../utils/aminoAcidRecords');
const NutritionProfile = require('../../models/nutritionProfile');

function amountText(mg) {
  if (!Number.isFinite(mg)) return '暂无数据';
  if (mg > 0 && mg < 0.01) return '< 0.01 mg';
  return `${Number(mg.toFixed(2))} mg`;
}

function displayRow({ missing, contributions, ...row }) {
  return {
    ...row,
    missingCount: missing.length,
    valueText: row.status === 'empty' ? '—' : amountText(row.totalMg),
    contributions: contributions.map((item, index) => ({
      ...item,
      listKey: index,
      unit: item.unit === 'ml' ? 'mL' : item.unit,
      amount: amountText(item.mg),
      sourceLabel: [item.source.name, item.source.version, item.source.recordId].filter(Boolean).join(' · ')
    }))
  };
}

function pendingIntakes(rows) {
  const pending = new Map();
  rows.forEach(({ label, missing }) => missing.forEach(item => {
    if (!pending.has(item.intakeIndex)) {
      pending.set(item.intakeIndex, { ...item, labels: [], reasons: new Set() });
    }
    const entry = pending.get(item.intakeIndex);
    entry.labels.push(label);
    if (item.reason) entry.reasons.add(item.reason);
    if (item.recordId) {
      entry.recordId = item.recordId;
      entry.componentIndex = item.componentIndex;
    }
  }));
  return [...pending.values()].map(({ labels, reasons, quantity, unit, reason, ...item }) => ({
    ...item,
    quantityLabel: Number.isFinite(quantity) && unit ? `${quantity} ${unit === 'ml' ? 'mL' : unit}` : '',
    detail: [...reasons, ...(reasons.size && labels.length === rows.length ? []
      : [labels.length === rows.length ? '缺少氨基酸资料' : `缺少${labels.join('、')}`])].join('。')
  }));
}

Component({
  properties: {
    date: { type: String, value: '' },
    babyUid: { type: String, value: '' },
    refreshKey: { type: Number, value: 0 }
  },
  data: {
    open: false,
    busy: false,
    error: false,
    hasIntakes: false,
    hasReferences: false,
    pending: [],
    rows: [],
    expandedKey: ''
  },
  observers: {
    'date, babyUid, refreshKey'(date, babyUid) {
      if (this.data.open) {
        if (this._lastDate !== date || this._lastBabyUid !== babyUid) this.setData({ expandedKey: '' });
        this.loadDay();
      }
    }
  },
  lifetimes: {
    detached() {
      this._request = null;
    }
  },
  pageLifetimes: {
    show() {
      if (this._returnFromArchive && this.data.open) this.loadDay();
      this._returnFromArchive = false;
    }
  },
  methods: {
    toggle() {
      const open = !this.data.open;
      this.setData({ open, expandedKey: '' });
      if (open) this.loadDay();
      else this._request = null;
    },

    async loadDay() {
      const { date, babyUid } = this.properties;
      if (!this.data.open || !date || !babyUid || getBabyUid() !== babyUid) {
        this.setData({ busy: false, error: true, rows: [], pending: [], hasIntakes: false });
        return;
      }
      const request = {};
      this._request = request;
      this._lastDate = date;
      this._lastBabyUid = babyUid;
      this.setData({ busy: true, error: false, rows: [], pending: [], hasIntakes: false });
      const isCurrent = () =>
        this._request === request && this.properties.date === date && this.properties.babyUid === babyUid
        && getBabyUid() === babyUid && this.data.open;
      try {
        const [records, archive] = await Promise.all([
          loadAminoAcidRecords(babyUid, date),
          NutritionProfile.getAminoAcidArchive(babyUid)
        ]);
        if (!isCurrent()) return;
        const summary = summarizeIntakes(collectIntakes(records), archive, date);
        this.setData({
          busy: false,
          hasIntakes: summary.hasIntakes,
          hasReferences: summary.rows.some(row => row.estimated),
          rows: summary.rows.map(displayRow),
          pending: pendingIntakes(summary.rows)
        });
      } catch (error) {
        if (isCurrent()) this.setData({ busy: false, error: true });
      }
    },

    toggleDetails(event) {
      const { key } = event.currentTarget.dataset;
      this.setData({ expandedKey: this.data.expandedKey === key ? '' : key });
    },

    openFoodAminoAcids(event) {
      const { foodId } = event.currentTarget.dataset;
      const { babyUid } = this.properties;
      if (!foodId || getBabyUid() !== babyUid) return;
      this._returnFromArchive = true;
      wx.navigateTo({
        url: `/pkg-milk/amino-acid-archive/index?babyUid=${encodeURIComponent(babyUid)}&foodId=${encodeURIComponent(foodId)}`,
        fail: () => {
          this._returnFromArchive = false;
          wx.showToast({ title: '暂时无法打开食物资料', icon: 'none' });
        }
      });
    },

    supplementIntake(event) {
      const { recordId, componentIndex } = event.currentTarget.dataset;
      const { babyUid, date } = this.properties;
      if (!recordId || !date || !babyUid || getBabyUid() !== babyUid) return;
      const component = /^\d+$/.test(componentIndex) ? `&componentIndex=${componentIndex}` : '';
      this._returnFromArchive = true;
      wx.navigateTo({
        url: `/pkg-milk/amino-acid-archive/index?babyUid=${encodeURIComponent(babyUid)}&date=${encodeURIComponent(date)}&recordId=${encodeURIComponent(recordId)}${component}`,
        fail: () => {
          this._returnFromArchive = false;
          wx.showToast({ title: '暂时无法打开补录', icon: 'none' });
        }
      });
    },

    copySource(event) {
      const { url } = event.currentTarget.dataset;
      if (/^https?:\/\//i.test(url || '')) wx.setClipboardData({ data: url });
    }
  }
});
