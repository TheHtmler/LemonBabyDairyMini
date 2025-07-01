// 邀请码相关功能模型
class InvitationModel {
  constructor() {
    this.INVITE_CODE_LENGTH = 8;
    this.INVITE_CODE_EXPIRY_DAYS = 30;
  }

  /**
   * 生成8位数字邀请码
   */
  generateInviteCode() {
    // 生成8位随机数字
    let code = '';
    for (let i = 0; i < this.INVITE_CODE_LENGTH; i++) {
      code += Math.floor(Math.random() * 10);
    }
    return code;
  }

  /**
   * 计算邀请码过期时间
   */
  getInviteCodeExpiry() {
    const now = new Date();
    const expiry = new Date(now.getTime() + this.INVITE_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    return expiry;
  }

  /**
   * 检查邀请码是否过期
   */
  isInviteCodeExpired(expiryDate) {
    if (!expiryDate) return true;
    const now = new Date();
    const expiry = new Date(expiryDate);
    return now > expiry;
  }

  /**
   * 验证邀请码格式
   */
  validateInviteCodeFormat(code) {
    if (!code) return false;
    // 检查是否为8位数字
    const regex = /^\d{8}$/;
    return regex.test(code);
  }

  /**
   * 通过邀请码查找宝宝信息
   */
  async findBabyByInviteCode(inviteCode) {
    try {
      const db = wx.cloud.database();
      const result = await db.collection('baby_info').where({
        inviteCode: inviteCode
      }).get();

      if (result.data && result.data.length > 0) {
        const babyInfo = result.data[0];
        
        // 检查邀请码是否过期
        if (this.isInviteCodeExpired(babyInfo.inviteCodeExpiry)) {
          return {
            success: false,
            error: 'INVITE_CODE_EXPIRED',
            message: '邀请码已过期，请联系创建者获取新的邀请码'
          };
        }

        return {
          success: true,
          babyInfo: babyInfo
        };
      } else {
        return {
          success: false,
          error: 'INVITE_CODE_NOT_FOUND',
          message: '邀请码不存在，请检查输入是否正确'
        };
      }
    } catch (error) {
      console.error('查找邀请码失败:', error);
      return {
        success: false,
        error: 'DATABASE_ERROR',
        message: '查询失败，请检查网络后重试'
      };
    }
  }

  /**
   * 刷新邀请码
   */
  async refreshInviteCode(babyUid, creatorOpenid) {
    try {
      const db = wx.cloud.database();
      const newInviteCode = this.generateInviteCode();
      const newExpiry = this.getInviteCodeExpiry();

      // 检查新邀请码是否已存在
      const existingResult = await db.collection('baby_info').where({
        inviteCode: newInviteCode
      }).get();

      // 如果存在重复，重新生成
      if (existingResult.data && existingResult.data.length > 0) {
        return this.refreshInviteCode(babyUid, creatorOpenid);
      }

      // 更新宝宝信息中的邀请码
      const updateResult = await db.collection('baby_info').where({
        babyUid: babyUid,
        _openid: creatorOpenid
      }).update({
        data: {
          inviteCode: newInviteCode,
          inviteCodeExpiry: newExpiry,
          updatedAt: db.serverDate()
        }
      });

      if (updateResult.stats.updated > 0) {
        return {
          success: true,
          inviteCode: newInviteCode,
          expiry: newExpiry
        };
      } else {
        return {
          success: false,
          error: 'UPDATE_FAILED',
          message: '更新邀请码失败'
        };
      }
    } catch (error) {
      console.error('刷新邀请码失败:', error);
      return {
        success: false,
        error: 'DATABASE_ERROR',
        message: '刷新邀请码失败，请重试'
      };
    }
  }

  /**
   * 添加参与者
   */
  async addParticipant(babyUid, participantOpenid) {
    try {
      const db = wx.cloud.database();
      
      // 检查参与者是否已经加入
      const existingResult = await db.collection('baby_participants').where({
        babyUid: babyUid,
        _openid: participantOpenid
      }).get();

      if (existingResult.data && existingResult.data.length > 0) {
        return {
          success: true,
          message: '您已经是该宝宝的记录者'
        };
      }

      // 添加新参与者（_openid会自动添加）
      const addResult = await db.collection('baby_participants').add({
        data: {
          babyUid: babyUid,
          joinedAt: db.serverDate(),
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });

      return {
        success: true,
        message: '成功加入宝宝记录',
        participantId: addResult._id
      };
    } catch (error) {
      console.error('添加参与者失败:', error);
      return {
        success: false,
        error: 'DATABASE_ERROR',
        message: '加入失败，请重试'
      };
    }
  }

  /**
   * 获取邀请码分享信息
   */
  getShareInfo(inviteCode, babyName) {
    return {
      title: `邀请您一起记录${babyName || '宝宝'}的成长`,
      path: `/pages/role-selection/index?inviteCode=${inviteCode}`,
      imageUrl: '/images/LemonLogo.png'
    };
  }
}

module.exports = new InvitationModel(); 