// 营养设置页面
const app = getApp();
const NutritionModel = require('../../models/nutrition');

Page({
  data: {
    settings: null,
    isConfirmed: false,
    proteinSource: '母乳', // 默认值为母乳
    isBreastMilk: true, // 是否为母乳（用于控制UI显示）
    inputValues: {}, // 用于显示初始值
    isFromSetup: false,
  },

  onLoad: async function(options) {
    try {
      wx.showLoading({
        title: '加载中...'
      });

      // 检查是否是从设置流程进入
      const isFromSetup = options.fromSetup === 'true';
      this.setData({
        isFromSetup: isFromSetup
      });

      // 设置天然蛋白来源类型
      if (options.proteinSource) {
        const proteinSource = decodeURIComponent(options.proteinSource);
        const isBreastMilk = proteinSource === '母乳';
        
        this.setData({
          proteinSource: proteinSource,
          isBreastMilk: isBreastMilk
        });
      } else {
        // 如果没有传递蛋白质来源，尝试从宝宝信息获取
        await this.loadBabyProteinSource();
      }

      // 首先设置默认值，防止页面渲染问题
      const defaultSettings = {
        natural_protein_coefficient: 1.2,
        natural_milk_protein: this.data.isBreastMilk ? 1.1 : 2.1, // 根据来源设置不同的默认值
        special_milk_protein: 13.1,
        special_milk_ratio: {
          powder: 13.5,
          water: 90
        },
        formula_milk_ratio: {
          powder: 7,
          water: 100
        },
      };
      
      // 使用深拷贝确保默认值不会被引用修改
      this.setData({
        settings: JSON.parse(JSON.stringify(defaultSettings)),
        inputValues: JSON.parse(JSON.stringify(defaultSettings)) // 初始化输入值与默认设置相同
      });
      
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到宝宝信息',
          icon: 'none'
        });
        return;
      }

      // 获取营养设置
      try {
        const settings = await NutritionModel.getNutritionSettings(babyUid);
        
        if (settings) {
          // 使用深合并逻辑处理设置
          const mergedSettings = {
            ...defaultSettings,
            ...settings,
            // 确保嵌套对象正确合并
            special_milk_ratio: {
              ...defaultSettings.special_milk_ratio,
              ...(settings.special_milk_ratio || {})
            },
            formula_milk_ratio: {
              ...defaultSettings.formula_milk_ratio,
              ...(settings.formula_milk_ratio || {})
            }
          };
          
          // 检查所有字段是否有undefined值
          Object.keys(mergedSettings).forEach(key => {
            if (mergedSettings[key] === undefined) {
              mergedSettings[key] = defaultSettings[key];
            }
            
            // 检查嵌套对象
            if ((key === 'special_milk_ratio' || key === 'formula_milk_ratio') && 
                typeof mergedSettings[key] === 'object') {
              Object.keys(mergedSettings[key]).forEach(subKey => {
                if (mergedSettings[key][subKey] === undefined) {
                  mergedSettings[key][subKey] = defaultSettings[key][subKey];
                }
              });
            }
          });
          
          this.setData({ 
            settings: mergedSettings,
            inputValues: JSON.parse(JSON.stringify(mergedSettings)) // 初始化输入值与设置相同
          });
        }
      } catch (settingsError) {
        console.error('获取营养设置失败，使用默认值:', settingsError);
      }

      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('加载营养设置失败：', err);
      wx.showToast({
        title: '加载设置失败',
        icon: 'none'
      });
    }
  },

  // 处理表单提交
  formSubmit(e) {
    try {
      // 从表单获取所有输入值
      const formData = e.detail.value;
      const invalidFields = [];
      
      // 使用正则表达式验证是否为有效数字（允许小数）
      const numberRegex = /^[0-9]+(\.[0-9]+)?$/;
      
      // 验证并转换字段为数字类型
      for (const key in formData) {
        const value = formData[key].trim();
        
        // 空值检查
        if (value === '') {
          formData[key] = '';
          continue;
        }
        
        // 正则验证是否为有效数字
        if (!numberRegex.test(value)) {
          invalidFields.push(this.getFieldDisplayName(key));
        } else {
          formData[key] = parseFloat(value);
        }
      }
      
      // 如果有无效字段，显示错误提示
      if (invalidFields.length > 0) {
        wx.showModal({
          title: '输入错误',
          content: `以下字段必须输入有效数字：${invalidFields.join('、')}`,
          showCancel: false
        });
        return;
      }
      
      // 构建完整的设置对象
      const newSettings = {
        natural_protein_coefficient: formData.natural_protein_coefficient,
        natural_milk_protein: formData.natural_milk_protein,
        special_milk_protein: formData.special_milk_protein,
        special_milk_ratio: {
          powder: formData.special_milk_ratio_powder,
          water: formData.special_milk_ratio_water
        },
      };
      
      // 如果是普通奶粉，添加配方奶相关设置
      if (!this.data.isBreastMilk) {
        newSettings.formula_milk_ratio = {
          powder: formData.formula_milk_ratio_powder,
          water: formData.formula_milk_ratio_water
        };
      } else {
        // 如果是母乳，保留原始formula_milk_ratio设置（如果有的话）
        if (this.data.settings && this.data.settings.formula_milk_ratio) {
          newSettings.formula_milk_ratio = this.data.settings.formula_milk_ratio;
        } else {
          newSettings.formula_milk_ratio = {
            powder: 7,
            water: 100
          };
        }
      }
      
      // 保存设置
      this.saveSettings(newSettings);
    } catch (error) {
      console.error('处理表单提交出错:', error);
      wx.showToast({
        title: '表单处理失败',
        icon: 'none'
      });
    }
  },
  
  // 获取字段显示名称
  getFieldDisplayName(fieldName) {
    const fieldMap = {
      'natural_protein_coefficient': '天然蛋白摄入系数',
      'natural_milk_protein': '母乳/奶粉蛋白质浓度',
      'special_milk_protein': '特奶蛋白质浓度',
      'special_milk_ratio_powder': '特奶粉量',
      'special_milk_ratio_water': '特奶水量',
      'formula_milk_ratio_powder': '奶粉粉量',
      'formula_milk_ratio_water': '奶粉水量'
    };
    
    return fieldMap[fieldName] || fieldName;
  },
  
  // 保存设置到服务器
  async saveSettings(newSettings) {
    console.log(newSettings, '---new settings')
    try {
      // 显示加载中
      wx.showLoading({
        title: '保存中...',
        mask: true
      });
      
      // 使用宝宝UID关联设置
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到宝宝信息，无法保存',
          icon: 'none'
        });
        return;
      }
      
      // 更新本地设置，然后保存到服务器
      this.setData({ settings: newSettings }, async () => {
        try {
          // 保存设置到服务器
          const success = await NutritionModel.updateNutritionSettings(babyUid, this.data.settings);
          
          wx.hideLoading();
          
          if (success) {
            wx.showToast({
              title: '设置已保存',
              icon: 'success'
            });
            
            // 标记为已确认
            this.setData({ isConfirmed: true });
            
            // 延迟后根据来源进行跳转
            setTimeout(() => {
              if (this.data.isFromSetup) {
                // 如果是从设置流程进入，跳转到首页
                wx.switchTab({
                  url: '/pages/daily-feeding/index',
                  fail: (err) => {
                    console.error('跳转到首页失败:', err);
                    wx.navigateBack();
                  }
                });
              } else {
                // 否则返回上一页
                wx.navigateBack();
              }
            }, 1500);
          } else {
            wx.showToast({
              title: '保存失败',
              icon: 'none'
            });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({
            title: '保存失败，请重试',
            icon: 'none'
          });
        }
      });
    } catch (error) {
      console.error('保存营养设置失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    }
  },

  // 加载宝宝的蛋白质来源类型
  async loadBabyProteinSource() {
    try {
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) return;
      
      const db = wx.cloud.database();
      const res = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        const babyInfo = res.data[0];
        let proteinSource = '母乳';
        let isBreastMilk = true;
        
        if (babyInfo.proteinSourceType === 'formulaMilk') {
          proteinSource = '普通奶粉';
          isBreastMilk = false;
        }
        
        this.setData({
          proteinSource: proteinSource,
          isBreastMilk: isBreastMilk
        });
      }
    } catch (error) {
      console.error('加载宝宝蛋白质来源类型失败:', error);
    }
  },

  // 创建默认设置
  createDefaultSettings() {
    return {
      natural_protein_coefficient: 1.2,  // 天然蛋白系数 g/kg
      natural_milk_protein: 1.1,         // 母乳蛋白质含量 g/100ml
      special_milk_protein: 13.1,        // 特奶蛋白质含量 g/100g
      special_milk_ratio: {
        powder: 13.5,                    // 特奶粉量 g
        water: 90                        // 特奶水量 ml
      }
    };
  }
}); 