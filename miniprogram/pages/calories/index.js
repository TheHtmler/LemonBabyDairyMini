Page({
  data: {
    ageOptions: ['0–6月', '7–12月', '1–3岁'],
    // 对应 MMA 稳定期能量范围（kcal/kg·d）
    energyRange: ['72–109', '64–97', '66–99'],
    ageIndex: 1, // 默认 7–12月
    nutritionStandards: [],
    showModal: false,
    editingNutrition: null,
    formData: {
      name: '',
      kcal100: '',
      baseAmount: '100',
      unitIndex: 0,
      notes: ''
    },
    units: ['g', 'ml', '个', '份']
  },

  async onLoad() {
    // 加载营养标准列表
    await this.loadNutritionStandards();
  },

  // 加载营养标准列表
  async loadNutritionStandards() {
    try {
      wx.showLoading({ title: '加载中...' });
      const db = wx.cloud.database();
      
      // 获取当前宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 构建查询条件，根据babyUid过滤
      let query = {};
      if (babyUid) {
        query.babyUid = babyUid;
      }
      
      const res = await db.collection('nutrition_standards').where(query).get();
      this.setData({ nutritionStandards: res.data });
    } catch (error) {
      console.error('加载营养标准列表失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'error'
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 显示添加弹窗
  showAddModal() {
    this.setData({
      showModal: true,
      editingNutrition: null,
      formData: {
        name: '',
        kcal100: '',
        baseAmount: '100',
        unitIndex: 0,
        notes: ''
      }
    });
  },

  // 显示编辑弹窗
  editNutrition(e) {
    const { id } = e.currentTarget.dataset;
    const nutrition = this.data.nutritionStandards.find(n => n._id === id);
    if (nutrition) {
      this.setData({
        showModal: true,
        editingNutrition: nutrition,
        formData: {
          name: nutrition.name,
          kcal100: String((nutrition.kcal100 != null ? nutrition.kcal100 : (nutrition.items && nutrition.items[0] ? nutrition.items[0].value : '')) || ''),
          baseAmount: String(nutrition.baseAmount || '100'),
          unitIndex: Math.max(0, this.data.units.indexOf(nutrition.unit || (nutrition.items && nutrition.items[0] ? nutrition.items[0].unit : 'g') || 'g')),
          notes: nutrition.notes || ''
        }
      });
    }
  },

  // 隐藏弹窗
  hideModal() {
    this.setData({
      showModal: false,
      editingNutrition: null,
      formData: {
        name: '',
        kcal100: '',
        baseAmount: '100',
        unitIndex: 0,
        notes: ''
      }
    });
  },

  // 保存营养标准
  async saveNutrition() {
    const { formData, editingNutrition } = this.data;
    
    // 表单验证
    if (!formData.name.trim()) {
      wx.showToast({
        title: '请输入营养标准名称',
        icon: 'none'
      });
      return;
    }
    // 校验热量
    if (formData.kcal100 === '' || isNaN(Number(formData.kcal100))) {
      wx.showToast({ title: '请输入有效热量', icon: 'none' });
      return;
    }
    if (!formData.baseAmount || isNaN(Number(formData.baseAmount)) || Number(formData.baseAmount) <= 0) {
      wx.showToast({ title: '请输入有效基准重量', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const db = wx.cloud.database();
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，食物记录可能无法正确关联');
      }
      
      const nutritionData = {
        name: formData.name.trim(),
        kcal100: Number(formData.kcal100),
        baseAmount: Number(formData.baseAmount),
        unit: this.data.units[formData.unitIndex],
        notes: (formData.notes || '').trim(),
        babyUid: babyUid,
        updatedAt: db.serverDate()
      };

      if (editingNutrition) {
        // 更新现有营养标准
        await db.collection('nutrition_standards').doc(editingNutrition._id).update({
          data: nutritionData
        });
      } else {
        // 添加新营养标准
        nutritionData.createdAt = db.serverDate();
        await db.collection('nutrition_standards').add({
          data: nutritionData
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      this.hideModal();
      this.loadNutritionStandards();
    } catch (error) {
      console.error('保存营养标准失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 删除营养标准
  async deleteNutrition(e) {
    const { id } = e.currentTarget.dataset;
    
    try {
      await wx.showModal({
        title: '确认删除',
        content: '确定要删除这个营养标准吗？',
        confirmColor: '#FFB800'
      });

      wx.showLoading({ title: '删除中...' });
      const db = wx.cloud.database();
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 验证要删除的营养标准是否属于当前宝宝
      if (babyUid) {
        const nutrition = await db.collection('nutrition_standards').doc(id).get();
        if (nutrition.data && nutrition.data.babyUid && nutrition.data.babyUid !== babyUid) {
          wx.hideLoading();
          wx.showToast({
            title: '无权删除此营养标准',
            icon: 'none'
          });
          return;
        }
      }
      
      await db.collection('nutrition_standards').doc(id).remove();
      
      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
      
      this.loadNutritionStandards();
    } catch (error) {
      if (error.errMsg && error.errMsg.includes('showModal:fail cancel')) {
        return;
      }
      console.error('删除营养标准失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '删除失败',
        icon: 'error'
      });
    }
  },

  // 年龄段选择改变
  onAgeChange(e) {
    this.setData({ ageIndex: Number(e.detail.value) });
  },

  // 表单输入处理
  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value
    });
  },

  onKcalInput(e) {
    this.setData({ 'formData.kcal100': e.detail.value });
  },

  onBaseAmountInput(e) {
    this.setData({ 'formData.baseAmount': e.detail.value });
  },

  onUnitChange(e) {
    this.setData({ 'formData.unitIndex': parseInt(e.detail.value) });
  },

  onNotesInput(e) {
    this.setData({
      'formData.notes': e.detail.value
    });
  },


});