// 用户信息集合模型
const db = wx.cloud.database();
const usersCollection = db.collection('users');

const UserModel = {
  /**
   * 根据openid获取用户信息
   * @param {string} openid 用户的openid
   * @returns {Promise<object>} 用户信息
   */
  async getUserByOpenId(openid) {
    try {
      const result = await usersCollection.where({
        _openid: openid
      }).get();
      
      return result.data.length > 0 ? result.data[0] : null;
    } catch (error) {
      console.error('获取用户信息失败:', error);
      throw error;
    }
  },
  
  /**
   * 创建或更新用户信息
   * @param {object} userInfo 用户信息对象
   * @returns {Promise<string>} 用户ID
   */
  async saveUser(userInfo) {
    try {
      const openid = wx.getStorageSync('openid');
      if (!openid) {
        throw new Error('未找到用户openid');
      }
      
      // 查询用户是否已存在
      const existingUser = await this.getUserByOpenId(openid);
      
      if (existingUser) {
        // 更新用户
        await usersCollection.doc(existingUser._id).update({
          data: {
            userInfo: userInfo,
            updatedAt: db.serverDate()
          }
        });
        return existingUser._id;
      } else {
        // 创建新用户
        const result = await usersCollection.add({
          data: {
            userInfo: userInfo,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate(),
            babyInfo: {
              dateOfBirth: null,
              initialWeight: null,
              gender: null
            },
            preferences: {
              theme: 'lemon',
              notificationsEnabled: true
            }
          }
        });
        return result._id;
      }
    } catch (error) {
      console.error('保存用户信息失败:', error);
      throw error;
    }
  },
  
  /**
   * 更新宝宝信息
   * @param {object} babyInfo 宝宝信息对象
   * @returns {Promise<boolean>} 是否成功
   */
  async updateBabyInfo(babyInfo) {
    try {
      const openid = wx.getStorageSync('openid');
      if (!openid) {
        throw new Error('未找到用户openid');
      }
      
      // 查询用户是否已存在
      const existingUser = await this.getUserByOpenId(openid);
      
      if (!existingUser) {
        throw new Error('用户不存在');
      }
      
      // 更新宝宝信息
      await usersCollection.doc(existingUser._id).update({
        data: {
          babyInfo: babyInfo,
          updatedAt: db.serverDate()
        }
      });
      
      return true;
    } catch (error) {
      console.error('更新宝宝信息失败:', error);
      throw error;
    }
  },
  
  /**
   * 更新用户偏好设置
   * @param {object} preferences 偏好设置对象
   * @returns {Promise<boolean>} 是否成功
   */
  async updatePreferences(preferences) {
    try {
      const openid = wx.getStorageSync('openid');
      if (!openid) {
        throw new Error('未找到用户openid');
      }
      
      // 查询用户是否已存在
      const existingUser = await this.getUserByOpenId(openid);
      
      if (!existingUser) {
        throw new Error('用户不存在');
      }
      
      // 更新偏好设置
      await usersCollection.doc(existingUser._id).update({
        data: {
          preferences: preferences,
          updatedAt: db.serverDate()
        }
      });
      
      return true;
    } catch (error) {
      console.error('更新偏好设置失败:', error);
      throw error;
    }
  }
};

module.exports = UserModel; 