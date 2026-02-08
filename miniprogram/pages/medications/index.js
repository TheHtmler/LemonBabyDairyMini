Page({
  data: {
    medications: [],
    showModal: false,
    editingMedication: null,
    tempMedication: {
      name: '',
      volume: ''
    },
    units: ['ml', 'mg', 'g', '片', '粒', '滴', '包', '袋', '支', '个'],
    concentrationUnits: ['mg', 'g', 'ml'],
    volumeUnits: ['ml', 'g'],
    formData: {
      name: '',
      dosage: '',
      unitIndex: 0,
      concentration: '',
      concentrationUnitIndex: 0,
      volumeUnitIndex: 0,
      frequencyTimes: '1', // 每个周期服用次数
      frequencyDays: '1', // 服用周期天数
      notes: ''
    },
    canEdit: false
  },

  async onLoad() {
    // 先默认允许编辑
    this.setData({
      canEdit: true
    });
    
    // 然后加载药物列表
    await this.loadMedications();
    
    // 检查用户角色
    await this.checkUserRole();
  },

  // 加载药物列表
  async loadMedications() {
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
      
      const res = await db.collection('medications').where(query).get();
      this.setData({ medications: res.data });
    } catch (error) {
      console.error('加载药物列表失败:', error);
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
    if (!this.data.canEdit) {
      wx.showToast({
        title: '暂无编辑权限',
        icon: 'none'
      })
      return
    }
    this.setData({
      showModal: true,
      editingMedication: null,
      tempMedication: {
        name: '',
        volume: ''
      },
      formData: {
        name: '',
        dosage: '',
        unitIndex: 0,
        concentration: '',
        concentrationUnitIndex: 0,
        volumeUnitIndex: 0,
        frequencyTimes: '1',
        frequencyDays: '1',
        notes: ''
      }
    });
  },

  // 显示编辑弹窗
  editMedication(e) {
    if (!this.data.canEdit) {
      wx.showToast({
        title: '暂无编辑权限',
        icon: 'none'
      })
      return
    }
    const { id } = e.currentTarget.dataset;
    const medication = this.data.medications.find(m => m._id === id);
    if (medication) {
      // 解析已有的频率配置
      const { frequencyTimes, frequencyDays } = this.parseFrequency(medication.frequency || '每1日1次');
      
      this.setData({
        showModal: true,
        editingMedication: medication,
        tempMedication: {
          name: medication.name,
          volume: medication.volume
        },
        formData: {
          name: medication.name,
          dosage: medication.dosage,
          unitIndex: this.data.units.indexOf(medication.unit) !== -1 ? this.data.units.indexOf(medication.unit) : 0,
          concentration: medication.concentration || '',
          concentrationUnitIndex: medication.concentrationUnit ? 
            this.data.concentrationUnits.indexOf(medication.concentrationUnit) : 0,
          volumeUnitIndex: medication.volumeUnit ? 
            this.data.volumeUnits.indexOf(medication.volumeUnit) : 0,
          frequencyTimes: frequencyTimes,
          frequencyDays: frequencyDays,
          notes: medication.notes || ''
        }
      });
    }
  },

  // 解析频率字符串为组件参数
  parseFrequency(frequency) {
    try {
      // 处理X日X次的情况
      const matches = frequency.match(/每(\d+)日(\d+)次/);
      if (matches && matches.length === 3) {
        return { frequencyTimes: matches[2], frequencyDays: matches[1] };
      } else if (frequency.includes('每日')) {
        const times = frequency.match(/每日(\d+)次/) ? frequency.match(/每日(\d+)次/)[1] : '1';
        return { frequencyTimes: times, frequencyDays: '1' };
      } else if (frequency.includes('每周')) {
        const times = frequency.match(/每周(\d+)次/) ? frequency.match(/每周(\d+)次/)[1] : '1';
        return { frequencyTimes: times, frequencyDays: '7' };
      } else if (frequency.includes('每月')) {
        const times = frequency.match(/每月(\d+)次/) ? frequency.match(/每月(\d+)次/)[1] : '1';
        return { frequencyTimes: times, frequencyDays: '30' };
      }
      
      // 默认值
      return { frequencyTimes: '1', frequencyDays: '1' };
    } catch (error) {
      console.error('解析频率失败:', error);
      return { frequencyTimes: '1', frequencyDays: '1' };
    }
  },

  // 隐藏弹窗
  hideModal() {
    this.setData({
      showModal: false,
      editingMedication: null,
      tempMedication: {
        name: '',
        volume: ''
      },
      formData: {
        name: '',
        dosage: '',
        unitIndex: 0,
        concentration: '',
        concentrationUnitIndex: 0,
        volumeUnitIndex: 0,
        frequencyTimes: '1',
        frequencyDays: '1',
        notes: ''
      }
    });
  },

  // 单位选择改变
  onUnitChange(e) {
    this.setData({
      'formData.unitIndex': parseInt(e.detail.value)
    });
  },

  // 浓度单位选择改变
  onConcentrationUnitChange(e) {
    this.setData({
      'formData.concentrationUnitIndex': parseInt(e.detail.value)
    });
  },

  // 体积单位选择改变
  onVolumeUnitChange(e) {
    this.setData({
      'formData.volumeUnitIndex': parseInt(e.detail.value)
    });
  },

  // 频率次数输入
  onFrequencyTimesInput(e) {
    this.setData({
      'formData.frequencyTimes': e.detail.value
    });
  },

  // 频率天数输入
  onFrequencyDaysInput(e) {
    this.setData({
      'formData.frequencyDays': e.detail.value
    });
  },

  // 保存药物
  async saveMedication() {
    if (!this.data.canEdit) {
      wx.showToast({
        title: '暂无编辑权限',
        icon: 'none'
      })
      return
    }
    const { formData, editingMedication, units, concentrationUnits, volumeUnits } = this.data;
    
    // 表单验证
    if (!formData.name.trim()) {
      wx.showToast({
        title: '请输入药物名称',
        icon: 'none'
      });
      return;
    }

    if (!formData.dosage) {
      wx.showToast({
        title: '请输入用量',
        icon: 'none'
      });
      return;
    }

    if (!formData.frequencyTimes || parseInt(formData.frequencyTimes) < 1) {
      wx.showToast({
        title: '请输入有效的服用次数',
        icon: 'none'
      });
      return;
    }

    if (!formData.frequencyDays || parseInt(formData.frequencyDays) < 1) {
      wx.showToast({
        title: '请输入有效的服用周期天数',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const db = wx.cloud.database();
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，药物记录可能无法正确关联');
      }
      
      // 根据频率天数和次数生成频率字符串
      let frequency;
      const times = parseInt(formData.frequencyTimes) || 1;
      const days = parseInt(formData.frequencyDays) || 1;
      
      if (days === 1) {
        frequency = `每日${times}次`;
      } else if (days === 7) {
        frequency = `每周${times}次`;
      } else if (days === 30) {
        frequency = `每月${times}次`;
      } else {
        frequency = `每${days}天${times}次`;
      }
      
      const medicationData = {
        name: formData.name,
        dosage: formData.dosage,
        unit: units[formData.unitIndex],
        concentration: formData.concentration,
        concentrationUnit: formData.concentration ? concentrationUnits[formData.concentrationUnitIndex] : '',
        volumeUnit: formData.concentration ? volumeUnits[formData.volumeUnitIndex] : '',
        frequency: frequency,
        frequencyTimes: formData.frequencyTimes,
        frequencyDays: formData.frequencyDays,
        notes: formData.notes,
        babyUid: babyUid, // 添加宝宝UID关联
        updatedAt: db.serverDate()
      };

      if (editingMedication) {
        // 更新现有药物
        await db.collection('medications').doc(editingMedication._id).update({
          data: medicationData
        });
      } else {
        // 添加新药物
        medicationData.createdAt = db.serverDate();
        await db.collection('medications').add({
          data: medicationData
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      this.hideModal();
      this.loadMedications();
    } catch (error) {
      console.error('保存药物失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 删除药物
  async deleteMedication(e) {
    if (!this.data.canEdit) {
      wx.showToast({
        title: '暂无删除权限',
        icon: 'none'
      })
      return
    }
    const { id } = e.currentTarget.dataset;
    
    try {
      await wx.showModal({
        title: '确认删除',
        content: '确定要删除这个药物吗？',
        confirmColor: '#FFB800'
      });

      wx.showLoading({ title: '删除中...' });
      const db = wx.cloud.database();
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 验证要删除的药物是否属于当前宝宝
      if (babyUid) {
        const medication = await db.collection('medications').doc(id).get();
        if (medication.data && medication.data.babyUid && medication.data.babyUid !== babyUid) {
          wx.hideLoading();
          wx.showToast({
            title: '无权删除此药物',
            icon: 'none'
          });
          return;
        }
      }
      
      await db.collection('medications').doc(id).remove();
      
      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
      
      this.loadMedications();
    } catch (error) {
      if (error.errMsg && error.errMsg.includes('showModal:fail cancel')) {
        return;
      }
      console.error('删除药物失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '删除失败',
        icon: 'error'
      });
    }
  },

  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value
    });
  },

  onVolumeInput(e) {
    this.setData({
      'tempMedication.volume': e.detail.value
    });
  },

  // 剂量输入
  onDosageInput(e) {
    this.setData({
      'formData.dosage': e.detail.value
    });
  },

  // 备注输入
  onNotesInput(e) {
    this.setData({
      'formData.notes': e.detail.value
    });
  },

  // 浓度输入
  onConcentrationInput(e) {
    this.setData({
      'formData.concentration': e.detail.value
    });
  },

  // 快速选择服用频率
  selectFrequency(e) {
    const { days, times } = e.currentTarget.dataset;
    this.setData({
      'formData.frequencyDays': days,
      'formData.frequencyTimes': times
    });
  },

  // 检查用户角色和权限
  async checkUserRole() {
    try {
      const app = getApp();
      
      // 检查是否是创建者
      const userRole = app.globalData.userRole || wx.getStorageSync('user_role');
      const isCreator = userRole === 'creator';
      
      // 如果是创建者，设置编辑权限为true
      if (isCreator) {
        console.log('用户是创建者，可以编辑药物');
        this.setData({
          canEdit: true
        });
        return;
      }
      
      // 如果不是创建者，尝试从app获取权限状态
      try {
        await app.checkPermission();
        const canEdit = app.globalData.permission || false;
        console.log('用户权限检查结果:', canEdit ? '可以编辑' : '不可编辑');
        this.setData({
          canEdit: canEdit
        });
      } catch (permError) {
        console.error('检查权限出错:', permError);
        this.setData({
          canEdit: false
        });
        
        wx.showToast({
          title: '权限检查失败，暂不可编辑',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (error) {
      console.error('检查用户角色失败:', error);
      // 检查失败时默认不允许编辑，提高安全性
      this.setData({
        canEdit: false
      });
      
      wx.showToast({
        title: '权限检查失败，请重新进入页面',
        icon: 'none',
        duration: 2000
      });
    }
  }
}); 
