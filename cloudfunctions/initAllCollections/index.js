// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('开始初始化数据库集合')
  
  // 需要创建的集合名称列表
  const collectionNames = [
    'baby_info',       // 宝宝基本信息（包含营养设置和药物设置）
    'baby_creators',   // 创建者信息
    'baby_participants', // 参与者信息
    'feeding_records'  // 喂养记录
  ]
  
  const results = {}
  
  // 尝试创建集合
  for (const name of collectionNames) {
    try {
      // 检查集合是否存在
      try {
        await db.collection(name).count()
        results[name] = {
          status: 'exists',
          message: '集合已存在'
        }
        console.log(`集合 ${name} 已存在`)
      } catch (e) {
        // 如果集合不存在，尝试创建
        if (e.errCode === -502005) {
          try {
            await db.createCollection(name)
            results[name] = {
              status: 'created',
              message: '创建成功'
            }
            console.log(`集合 ${name} 创建成功`)
          } catch (createError) {
            if (createError.errCode === -501001) {
              // 集合已存在，这是正常的
              results[name] = {
                status: 'exists',
                message: '集合已存在(创建时检测)'
              }
              console.log(`集合 ${name} 已存在 (创建时检测)`)
            } else {
              results[name] = {
                status: 'error',
                message: `创建失败: ${createError.errMsg || createError.message}`,
                error: createError
              }
              console.error(`创建集合失败: ${name}，错误信息: ${createError.errMsg || createError.message}`)
            }
          }
        } else {
          results[name] = {
            status: 'error',
            message: `检查失败: ${e.errMsg || e.message}`,
            error: e
          }
          console.error(`检查集合是否存在时出错: ${name}，错误信息: ${e.errMsg || e.message}`)
        }
      }
    } catch (error) {
      results[name] = {
        status: 'error',
        message: `未知错误: ${error.errMsg || error.message}`,
        error: error
      }
      console.error(`处理集合时出现意外错误: ${name}`, error)
    }
  }
  
  return {
    success: true,
    results: results
  }
}