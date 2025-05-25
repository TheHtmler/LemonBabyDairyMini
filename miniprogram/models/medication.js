// 药物设置模型
const db = wx.cloud.database();
let medicationsCollection;

try {
  medicationsCollection = db.collection('medications');
} catch (error) {
  console.error('初始化药物集合失败:', error);
}

const babyInfoCollection = db.collection('baby_info');

class MedicationModel {
  constructor() {
    this.collection = db.collection('baby_info');
  }

  /**
   * 获取药物列表，优先通过宝宝UID获取
   * @returns {Promise<Array>} 药物列表
   */
  async getMedications() {
    try {
      const openid = wx.getStorageSync('openid');
      
      // 首先尝试通过宝宝UID获取关联的药物设置
      const babyUid = wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取正确的药物列表');
        return [];
      }
      
      console.log('尝试通过宝宝UID获取药物设置:', babyUid);
      
      // 先检查宝宝信息中是否已包含药物设置
      try {
        const babyInfoResult = await this.collection.where({
          babyUid: babyUid
        }).get();
        
        if (babyInfoResult.data.length > 0) {
          const babyInfo = babyInfoResult.data[0];
          
          // 如果宝宝信息中包含药物设置，直接使用
          if (babyInfo.medicationSettings && babyInfo.medicationSettings.length > 0) {
            console.log('使用宝宝信息中的药物设置');
            return babyInfo.medicationSettings;
          }
        }
      } catch (error) {
        console.warn('获取宝宝信息中的药物设置失败:', error);
        // 失败时继续后续查询尝试
      }
      
      // 如果宝宝信息中没有药物设置，尝试查询独立的药物设置集合
      try {
        // 检查药物集合是否初始化成功
        if (!medicationsCollection) {
          console.warn('药物集合未初始化，将返回空药物列表');
          return [];
        }
        
        const medsResult = await medicationsCollection.where({
          babyUid: babyUid
        }).get();
        
        if (medsResult.data && medsResult.data.length > 0) {
          return medsResult.data;
        } else {
          console.log('未找到与当前宝宝关联的药物记录');
          return [];
        }
      } catch (error) {
        // 检查是否是集合不存在错误
        if (error && error.errCode === -502005) {
          console.warn('药物集合不存在，将返回空药物列表');
          return [];
        }
        
        console.warn('通过宝宝UID查询药物失败:', error);
        return [];
      }
    } catch (error) {
      console.error('获取药物设置失败:', error);
      return [];
    }
  }
  
  /**
   * 创建默认药物设置
   * @returns {Promise<Array>} 药物列表
   */
  async createDefaultMedications() {
    try {
      console.warn('不再创建默认药物，返回空数组');
      return [];
    } catch (error) {
      console.error('处理药物设置失败:', error);
      return [];
    }
  }
  
  /**
   * 保存单个药物设置
   * @param {object} medication 药物设置对象
   * @returns {Promise<boolean>} 是否成功
   */
  async saveMedication(medication) {
    try {
      const openid = wx.getStorageSync('openid');
      const babyUid = wx.getStorageSync('baby_uid');
      
      if (!openid) {
        console.warn('未找到用户openid，无法保存药物设置');
        return false;
      }
      
      console.log('正在保存药物设置，babyUid:', babyUid);
      
      // 优先更新baby_info中的药物设置
      if (babyUid) {
        try {
          // 查询宝宝信息
          const babyInfoResult = await this.collection.where({
            babyUid: babyUid
          }).get();
          
          if (babyInfoResult.data.length > 0) {
            const babyInfo = babyInfoResult.data[0];
            
            // 获取当前药物列表
            let currentMeds = babyInfo.medicationSettings || [];
            if (!Array.isArray(currentMeds)) {
              currentMeds = [];
            }
            
            // 检查是否需要更新现有药物或添加新药物
            const updatedMeds = [...currentMeds];
            const medIndex = updatedMeds.findIndex(m => 
              (m._id && m._id === medication._id) || 
              (m.name && m.name === medication.name)
            );
            
            if (medIndex >= 0) {
              // 更新现有药物
              updatedMeds[medIndex] = {
                ...updatedMeds[medIndex],
                ...medication,
                updatedAt: new Date()
              };
            } else {
              // 添加新药物
              updatedMeds.push({
                ...medication,
                createdAt: new Date(),
                updatedAt: new Date()
              });
            }
            
            // 更新宝宝信息中的药物设置
            await this.collection.doc(babyInfo._id).update({
              data: {
                medicationSettings: updatedMeds,
                updatedAt: db.serverDate()
              }
            });
            
            console.log('成功更新宝宝信息中的药物设置');
            
            // 药物集合不存在或初始化失败时，不尝试更新独立集合
            if (!medicationsCollection) {
              console.warn('药物集合未初始化，跳过独立集合更新');
              return true;
            }
            
            // 同时更新或创建独立集合中的记录（兼容性考虑）
            try {
              if (medication._id) {
                // 更新现有药物
                await medicationsCollection.doc(medication._id).update({
                  data: {
                    name: medication.name,
                    dosage: medication.dosage,
                    unit: medication.unit,
                    frequency: medication.frequency,
                    notes: medication.notes,
                    babyUid: babyUid,
                    updatedAt: db.serverDate()
                  }
                });
              } else {
                // 新增药物
                const result = await medicationsCollection.add({
                  data: {
                    name: medication.name,
                    dosage: medication.dosage,
                    unit: medication.unit,
                    frequency: medication.frequency,
                    notes: medication.notes,
                    babyUid: babyUid,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate()
                  }
                });
                
                medication._id = result._id;
              }
            } catch (error) {
              console.warn('更新药物独立集合失败，已忽略:', error);
              // 即使独立集合更新失败，也视为成功，因为已经更新了宝宝信息中的药物设置
            }
            
            return true;
          }
        } catch (error) {
          console.error('更新宝宝信息中的药物设置失败:', error);
          // 继续尝试更新独立的药物记录
        }
      }
      
      // 药物集合不存在或初始化失败时，返回失败
      if (!medicationsCollection) {
        console.warn('药物集合未初始化，无法保存药物设置');
        return false;
      }
      
      // 如果没有babyUid或更新宝宝信息失败，尝试只更新独立的药物记录
      try {
        if (medication._id) {
          // 更新现有药物
          await medicationsCollection.doc(medication._id).update({
            data: {
              name: medication.name,
              dosage: medication.dosage,
              unit: medication.unit,
              frequency: medication.frequency,
              notes: medication.notes,
              babyUid: babyUid || medication.babyUid,
              updatedAt: db.serverDate()
            }
          });
        } else {
          // 新增药物
          const result = await medicationsCollection.add({
            data: {
              name: medication.name,
              dosage: medication.dosage,
              unit: medication.unit,
              frequency: medication.frequency,
              notes: medication.notes,
              babyUid: babyUid,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
          
          medication._id = result._id;
        }
        
        return true;
      } catch (error) {
        console.error('保存药物失败:', error);
        return false;
      }
    } catch (error) {
      console.error('保存药物失败:', error);
      return false;
    }
  }
  
  /**
   * 删除药物设置
   * @param {string} medicationId 药物ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteMedication(medicationId) {
    try {
      const openid = wx.getStorageSync('openid');
      const babyUid = wx.getStorageSync('baby_uid');
      
      if (!openid) {
        console.warn('未找到用户openid，无法删除药物设置');
        return false;
      }
      
      if (!medicationId) {
        console.warn('未提供药物ID，无法删除');
        return false;
      }
      
      // 药物集合不存在或初始化失败时，跳过独立集合删除
      if (medicationsCollection) {
        try {
          // 从独立集合中删除
          await medicationsCollection.doc(medicationId).remove();
        } catch (error) {
          console.warn('从独立集合删除药物失败，将继续处理:', error);
        }
      } else {
        console.warn('药物集合未初始化，跳过独立集合删除');
      }
      
      // 如果有宝宝UID，同时更新宝宝信息中的药物设置
      if (babyUid) {
        try {
          const babyInfoResult = await this.collection.where({
            babyUid: babyUid
          }).get();
          
          if (babyInfoResult.data.length > 0) {
            const babyInfo = babyInfoResult.data[0];
            
            // 获取当前药物列表并过滤掉要删除的药物
            let currentMeds = babyInfo.medicationSettings || [];
            if (!Array.isArray(currentMeds)) {
              currentMeds = [];
            }
            
            currentMeds = currentMeds.filter(med => med._id !== medicationId);
            
            // 更新宝宝信息中的药物设置
            await this.collection.doc(babyInfo._id).update({
              data: {
                medicationSettings: currentMeds,
                updatedAt: db.serverDate()
              }
            });
            
            console.log('成功从宝宝信息中删除药物设置');
            return true;
          }
        } catch (error) {
          console.error('从宝宝信息中删除药物设置失败:', error);
        }
      }
      
      return false;
    } catch (error) {
      console.error('删除药物失败:', error);
      return false;
    }
  }
  
  /**
   * 获取今日需要服用的药物
   * @param {Array} settings 药物设置列表
   * @returns {Array} 今日需要服用的药物列表
   */
  getTodayMedications(settings) {
    if (!settings) return [];

    const today = new Date();
    const dayOfWeek = today.getDay(); // 0-6，0表示周日
    const isEvenDay = today.getDate() % 2 === 0;

    return settings.filter(med => {
      switch (med.frequency) {
        case '每日一次':
          return true;
        case '每日两次':
          return true;
        case '隔天一次':
          return isEvenDay;
        case '两天打一次':
          return isEvenDay;
        default:
          return false;
      }
    });
  }
}

module.exports = new MedicationModel(); 