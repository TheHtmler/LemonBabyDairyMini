// 营养标准设置模型
const db = wx.cloud.database();
let nutritionStandardsCollection;

try {
  nutritionStandardsCollection = db.collection('nutrition_standards');
} catch (error) {
  console.error('初始化营养标准集合失败:', error);
}

const babyInfoCollection = db.collection('baby_info');

class NutritionModel {
  constructor() {
    this.collection = db.collection('baby_info');
  }

  /**
   * 获取营养标准列表，优先通过宝宝UID获取
   * @returns {Promise<Array>} 营养标准列表
   */
  async getNutritionStandards() {
    try {
      const openid = wx.getStorageSync('openid');
      
      // 首先尝试通过宝宝UID获取关联的营养标准设置
      const babyUid = wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取正确的营养标准列表');
        return [];
      }
      
      console.log('尝试通过宝宝UID获取营养标准设置:', babyUid);
      
      // 先检查宝宝信息中是否已包含营养标准设置
      try {
        const babyInfoResult = await this.collection.where({
          babyUid: babyUid
        }).get();
        
        if (babyInfoResult.data.length > 0) {
          const babyInfo = babyInfoResult.data[0];
          
          // 如果宝宝信息中包含营养标准设置，直接使用
          if (babyInfo.nutritionSettings && babyInfo.nutritionSettings.length > 0) {
            console.log('使用宝宝信息中的营养标准设置');
            return babyInfo.nutritionSettings;
          }
        }
      } catch (error) {
        console.warn('获取宝宝信息中的营养标准设置失败:', error);
        // 失败时继续后续查询尝试
      }
      
      // 如果宝宝信息中没有营养标准设置，尝试查询独立的营养标准设置集合
      try {
        // 检查营养标准集合是否初始化成功
        if (!nutritionStandardsCollection) {
          console.warn('营养标准集合未初始化，将返回空营养标准列表');
          return [];
        }
        
        const nutritionResult = await nutritionStandardsCollection.where({
          babyUid: babyUid
        }).get();
        
        if (nutritionResult.data && nutritionResult.data.length > 0) {
          return nutritionResult.data;
        } else {
          console.log('未找到与当前宝宝关联的营养标准记录');
          return [];
        }
      } catch (error) {
        // 检查是否是集合不存在错误
        if (error && error.errCode === -502005) {
          console.warn('营养标准集合不存在，将返回空营养标准列表');
          return [];
        }
        
        console.warn('通过宝宝UID查询营养标准失败:', error);
        return [];
      }
    } catch (error) {
      console.error('获取营养标准设置失败:', error);
      return [];
    }
  }
  
  /**
   * 创建默认营养标准设置
   * @returns {Promise<Array>} 营养标准列表
   */
  async createDefaultNutritionStandards() {
    try {
      console.warn('不再创建默认营养标准，返回空数组');
      return [];
    } catch (error) {
      console.error('处理营养标准设置失败:', error);
      return [];
    }
  }
  
  /**
   * 保存单个营养标准设置
   * @param {object} nutrition 营养标准设置对象
   * @returns {Promise<boolean>} 是否成功
   */
  async saveNutrition(nutrition) {
    try {
      const openid = wx.getStorageSync('openid');
      const babyUid = wx.getStorageSync('baby_uid');
      
      if (!openid) {
        console.warn('未找到用户openid，无法保存营养标准设置');
        return false;
      }
      
      console.log('正在保存营养标准设置，babyUid:', babyUid);
      
      // 优先更新baby_info中的营养标准设置
      if (babyUid) {
        try {
          // 查询宝宝信息
          const babyInfoResult = await this.collection.where({
            babyUid: babyUid
          }).get();
          
          if (babyInfoResult.data.length > 0) {
            const babyInfo = babyInfoResult.data[0];
            
            // 获取当前营养标准列表
            let currentNutrition = babyInfo.nutritionSettings || [];
            if (!Array.isArray(currentNutrition)) {
              currentNutrition = [];
            }
            
            // 检查是否需要更新现有营养标准或添加新营养标准
            const updatedNutrition = [...currentNutrition];
            const nutritionIndex = updatedNutrition.findIndex(n => 
              (n._id && n._id === nutrition._id) || 
              (n.name && n.name === nutrition.name)
            );
            
            if (nutritionIndex >= 0) {
              // 更新现有营养标准
              updatedNutrition[nutritionIndex] = {
                ...updatedNutrition[nutritionIndex],
                ...nutrition,
                updatedAt: new Date()
              };
            } else {
              // 添加新营养标准
              updatedNutrition.push({
                ...nutrition,
                createdAt: new Date(),
                updatedAt: new Date()
              });
            }
            
            // 更新宝宝信息中的营养标准设置
            await this.collection.doc(babyInfo._id).update({
              data: {
                nutritionSettings: updatedNutrition,
                updatedAt: db.serverDate()
              }
            });
            
            console.log('成功更新宝宝信息中的营养标准设置');
            
            // 营养标准集合不存在或初始化失败时，不尝试更新独立集合
            if (!nutritionStandardsCollection) {
              console.warn('营养标准集合未初始化，跳过独立集合更新');
              return true;
            }
            
            // 同时更新或创建独立集合中的记录（兼容性考虑）
            try {
              if (nutrition._id) {
                // 更新现有营养标准
                await nutritionStandardsCollection.doc(nutrition._id).update({
                  data: {
                    name: nutrition.name,
                    kcal100: nutrition.kcal100,
                    prot100: nutrition.prot100,
                    baseAmount: nutrition.baseAmount,
                    unit: nutrition.unit,
                    notes: nutrition.notes,
                    babyUid: babyUid,
                    updatedAt: db.serverDate()
                  }
                });
              } else {
                // 新增营养标准
                const result = await nutritionStandardsCollection.add({
                  data: {
                    name: nutrition.name,
                    kcal100: nutrition.kcal100,
                    prot100: nutrition.prot100,
                    baseAmount: nutrition.baseAmount,
                    unit: nutrition.unit,
                    notes: nutrition.notes,
                    babyUid: babyUid,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate()
                  }
                });
                
                nutrition._id = result._id;
              }
            } catch (error) {
              console.warn('更新营养标准独立集合失败，已忽略:', error);
              // 即使独立集合更新失败，也视为成功，因为已经更新了宝宝信息中的营养标准设置
            }
            
            return true;
          }
        } catch (error) {
          console.error('更新宝宝信息中的营养标准设置失败:', error);
          // 继续尝试更新独立的营养标准记录
        }
      }
      
      // 营养标准集合不存在或初始化失败时，返回失败
      if (!nutritionStandardsCollection) {
        console.warn('营养标准集合未初始化，无法保存营养标准设置');
        return false;
      }
      
      // 如果没有babyUid或更新宝宝信息失败，尝试只更新独立的营养标准记录
      try {
        if (nutrition._id) {
          // 更新现有营养标准
          await nutritionStandardsCollection.doc(nutrition._id).update({
            data: {
              name: nutrition.name,
              kcal100: nutrition.kcal100,
              prot100: nutrition.prot100,
              baseAmount: nutrition.baseAmount,
              unit: nutrition.unit,
              notes: nutrition.notes,
              babyUid: babyUid || nutrition.babyUid,
              updatedAt: db.serverDate()
            }
          });
        } else {
          // 新增营养标准
          const result = await nutritionStandardsCollection.add({
            data: {
              name: nutrition.name,
              kcal100: nutrition.kcal100,
              prot100: nutrition.prot100,
              baseAmount: nutrition.baseAmount,
              unit: nutrition.unit,
              notes: nutrition.notes,
              babyUid: babyUid,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
          
          nutrition._id = result._id;
        }
        
        return true;
      } catch (error) {
        console.error('保存营养标准失败:', error);
        return false;
      }
    } catch (error) {
      console.error('保存营养标准失败:', error);
      return false;
    }
  }
  
  /**
   * 删除营养标准设置
   * @param {string} nutritionId 营养标准ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteNutrition(nutritionId) {
    try {
      const openid = wx.getStorageSync('openid');
      const babyUid = wx.getStorageSync('baby_uid');
      
      if (!openid) {
        console.warn('未找到用户openid，无法删除营养标准设置');
        return false;
      }
      
      if (!nutritionId) {
        console.warn('未提供营养标准ID，无法删除');
        return false;
      }
      
      // 营养标准集合不存在或初始化失败时，跳过独立集合删除
      if (nutritionStandardsCollection) {
        try {
          // 从独立集合中删除
          await nutritionStandardsCollection.doc(nutritionId).remove();
        } catch (error) {
          console.warn('从独立集合删除营养标准失败，将继续处理:', error);
        }
      } else {
        console.warn('营养标准集合未初始化，跳过独立集合删除');
      }
      
      // 如果有宝宝UID，同时更新宝宝信息中的营养标准设置
      if (babyUid) {
        try {
          const babyInfoResult = await this.collection.where({
            babyUid: babyUid
          }).get();
          
          if (babyInfoResult.data.length > 0) {
            const babyInfo = babyInfoResult.data[0];
            
            // 获取当前营养标准列表并过滤掉要删除的营养标准
            let currentNutrition = babyInfo.nutritionSettings || [];
            if (!Array.isArray(currentNutrition)) {
              currentNutrition = [];
            }
            
            currentNutrition = currentNutrition.filter(nutrition => nutrition._id !== nutritionId);
            
            // 更新宝宝信息中的营养标准设置
            await this.collection.doc(babyInfo._id).update({
              data: {
                nutritionSettings: currentNutrition,
                updatedAt: db.serverDate()
              }
            });
            
            console.log('成功从宝宝信息中删除营养标准设置');
            return true;
          }
        } catch (error) {
          console.error('从宝宝信息中删除营养标准设置失败:', error);
        }
      }
      
      return false;
    } catch (error) {
      console.error('删除营养标准失败:', error);
      return false;
    }
  }
}

module.exports = new NutritionModel(); 