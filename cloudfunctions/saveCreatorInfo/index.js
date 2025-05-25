// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 确保集合存在
async function ensureCollectionExists(collectionName) {
  try {
    console.log(`检查集合是否存在: ${collectionName}`);
    
    // 检查集合是否存在
    try {
      await db.collection(collectionName).count();
      console.log(`集合已存在: ${collectionName}`);
      return true;
    } catch (error) {
      // 若集合不存在，则创建
      if (error.errCode === -502005) {
        try {
          await db.createCollection(collectionName);
          console.log(`创建集合成功: ${collectionName}`);
          return true;
        } catch (createError) {
          if (createError.errCode === -501001) {
            // 集合已存在，这是正常的
            console.log(`集合已存在(创建时检测): ${collectionName}`);
            return true;
          }
          console.error(`创建集合失败: ${collectionName}`, createError);
          return false;
        }
      } else {
        console.error(`检查集合时出错: ${collectionName}`, error);
        return false;
      }
    }
  } catch (err) {
    console.error(`确保集合存在过程出错: ${collectionName}`, err);
    return false;
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  try {
    // 获取请求参数
    const { phone, name } = event
    
    console.log(`保存创建者信息: phone=${phone}, name=${name}, openid=${openid}`);
    
    if (!phone) {
      return {
        success: false,
        code: 'MISSING_PHONE',
        message: '手机号不能为空'
      }
    }
    
    // 确保集合存在
    const collectionExists = await ensureCollectionExists('baby_creators');
    if (!collectionExists) {
      return {
        success: false,
        code: 'COLLECTION_ERROR',
        message: '数据库初始化失败，请稍后重试'
      };
    }
    
    // 检查手机号是否已被使用
    const existingCreator = await db.collection('baby_creators').where({
      phone: phone
    }).get()
    
    console.log(`检查已有创建者结果:`, existingCreator);
    
    if (existingCreator.data && existingCreator.data.length > 0) {
      // 检查是否是同一个openid
      if (existingCreator.data[0]._openid !== openid) {
        return {
          success: false,
          code: 'PHONE_ALREADY_USED',
          message: '该手机号已被其他创建者使用'
        }
      }
      
      // 更新现有记录
      console.log(`更新创建者记录: id=${existingCreator.data[0]._id}`);
      await db.collection('baby_creators').doc(existingCreator.data[0]._id).update({
        data: {
          phone: phone,
          name: name || existingCreator.data[0].name,
          updatedAt: db.serverDate()
        }
      })
    } else {
      // 创建新记录
      console.log(`添加新创建者记录`);
      const addResult = await db.collection('baby_creators').add({
        data: {
          _openid: openid,
          phone: phone,
          name: name || '',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      console.log(`添加结果:`, addResult);
    }
    
    // 再检查一次baby_info集合是否存在
    await ensureCollectionExists('baby_info');
    
    return {
      success: true,
      message: '创建者信息保存成功'
    }
  } catch (error) {
    console.error('保存创建者信息失败:', error)
    return {
      success: false,
      code: 'SERVER_ERROR',
      message: '服务器错误，请稍后重试',
      error: error
    }
  }
} 