Page({
  data: {
    calculation_params: {
      breast_milk_protein: 1.1,        // 母乳蛋白质浓度 g/100ml
      special_milk_protein: 13.1,      // 特奶蛋白质浓度 g/100g
      special_milk_ratio: {
        powder: 13.5,                  // 特奶粉量 g
        water: 90                      // 特奶水量 ml
      },
      natural_protein_coefficient: 1.2  // 天然蛋白摄入系数 g/kg
    },
    hasChanges: false,
    settingsId: ''  // 用于存储设置文档的 _id
  },

  onLoad() {
    this.loadSettings();
  },

  // 从云数据库加载设置
  async loadSettings() {
    try {
      wx.showLoading({
        title: '加载中...'
      });

      const db = wx.cloud.database();
      // 查询 settings 集合中的所有记录
      const result = await db.collection('settings').get();
      
      if (result.data && result.data.length > 0) {
        // 如果有设置记录，使用第一条
        const settings = result.data[0];
        const { _id, _openid, ...params } = settings; // 排除系统字段
        this.setData({
          calculation_params: params,
          settingsId: settings._id
        });
      } else {
        // 如果没有设置记录，创建默认设置
        await this.createDefaultSettings();
      }

      wx.hideLoading();
    } catch (error) {
      console.error('加载设置失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '加载设置失败',
        icon: 'none'
      });
    }
  },

  // 创建默认设置
  async createDefaultSettings() {
    try {
      const db = wx.cloud.database();
      const result = await db.collection('settings').add({
        data: {
          breast_milk_protein: 1.1,        // 母乳蛋白质浓度 g/100ml
          special_milk_protein: 13.1,      // 特奶蛋白质浓度 g/100g
          special_milk_ratio: {
            powder: 13.5,                  // 特奶粉量 g
            water: 90                      // 特奶水量 ml
          },
          natural_protein_coefficient: 1.2  // 天然蛋白摄入系数 g/kg
        }
      });

      // 保存新创建的设置 ID
      this.setData({
        settingsId: result._id
      });
    } catch (error) {
      console.error('创建默认设置失败:', error);
      wx.showToast({
        title: '创建设置失败',
        icon: 'none'
      });
    }
  },

  // 更新参数（不立即保存）
  updateParams(e) {
    const { field } = e.currentTarget.dataset;
    const value = parseFloat(e.detail.value);
    
    if (isNaN(value)) return;

    const params = this.data.calculation_params;
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      params[parent][child] = value;
    } else {
      params[field] = value;
    }

    this.setData({
      calculation_params: params,
      hasChanges: true
    });
  },

  // 保存设置到云数据库
  async saveSettings() {
    if (!this.data.settingsId) {
      wx.showToast({
        title: '设置ID不存在',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({
        title: '保存中...'
      });

      const db = wx.cloud.database();
      const updateData = {
        breast_milk_protein: this.data.calculation_params.breast_milk_protein,
        special_milk_protein: this.data.calculation_params.special_milk_protein,
        special_milk_ratio: this.data.calculation_params.special_milk_ratio,
        natural_protein_coefficient: this.data.calculation_params.natural_protein_coefficient
      };

      await db.collection('settings').doc(this.data.settingsId).update({
        data: updateData
      });

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success',
        duration: 2000
      });
      
      this.setData({
        hasChanges: false
      });
    } catch (error) {
      console.error('保存设置失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  }
}); 