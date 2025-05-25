// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  try {
    // 先检查是否是创建者
    const creatorRes = await db.collection('baby_creators').where({
      _openid: openid
    }).get()
    
    if (creatorRes.data && creatorRes.data.length > 0) {
      return {
        success: true,
        permission: 'all',
        isOwner: true,
        babyUid: creatorRes.data[0].babyUid,
        creatorPhone: creatorRes.data[0].phone
      }
    }
    
    // 如果不是创建者，检查是否是参与者
    const participantRes = await db.collection('baby_participants').where({
      _openid: openid
    }).get()
    
    if (participantRes.data && participantRes.data.length > 0) {
      return {
        success: true,
        permission: 'view',
        isOwner: false,
        babyUid: participantRes.data[0].babyUid,
        creatorPhone: participantRes.data[0].creatorPhone
      }
    }
    
    // 既不是创建者也不是参与者
    return {
      success: false,
      permission: 'none',
      isOwner: false,
      message: '用户没有权限访问'
    }
  } catch (err) {
    console.error('检查权限失败:', err)
    return {
      success: false,
      message: '检查权限失败',
      error: err
    }
  }
} 