const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const { OPENID, APPID } = cloud.getWXContext()
  const { encryptedData, iv } = event

  try {
    // 解密手机号
    const result = await cloud.getOpenData({
      list: [
        {
          encryptedData,
          iv,
          cloudID: event.cloudID
        }
      ]
    })

    return {
      success: true,
      phoneNumber: result.list[0].data.phoneNumber,
      openid: OPENID
    }
  } catch (err) {
    console.error('解密手机号失败', err)
    return {
      success: false,
      error: err
    }
  }
} 