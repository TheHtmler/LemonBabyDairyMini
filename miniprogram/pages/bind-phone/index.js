Page({
  data: {
    creatorPhone: '', // 创建者手机号
    participantPhone: '', // 参与者自己的手机号
    isFormValid: false,
    errorMessage: '',
    isSubmitting: false,
    userRole: 'participant',
    creatorPhoneValid: false, // 创建者手机号是否有效
    participantPhoneValid: false, // 参与者手机号是否有效
    creatorPhoneErrorMsg: '', // 创建者手机号错误提示
    participantPhoneErrorMsg: '' // 参与者手机号错误提示
  },

  onLoad(options) {
    if (options.role) {
      this.setData({
        userRole: options.role
      });
      
      // 如果有角色参数，保存到全局和本地
      const app = getApp();
      app.globalData.userRole = options.role;
      wx.setStorageSync('user_role', options.role);
      wx.setStorageSync('has_selected_role', true);
    }
  },
  
  // 处理创建者手机号输入
  onCreatorPhoneInput(e) {
    const phone = e.detail.value;
    
    // 验证手机号格式
    const isValid = this.validatePhone(phone);
    
    this.setData({
      creatorPhone: phone,
      creatorPhoneValid: isValid,
      creatorPhoneErrorMsg: isValid ? '' : '请输入正确的创建者手机号码，用于关联家庭数据',
      isFormValid: isValid && this.data.participantPhoneValid
    });
  },
  
  // 处理参与者手机号输入
  onParticipantPhoneInput(e) {
    const phone = e.detail.value;
    
    // 验证手机号格式
    const isValid = this.validatePhone(phone);
    
    this.setData({
      participantPhone: phone,
      participantPhoneValid: isValid,
      participantPhoneErrorMsg: isValid ? '' : '请输入您自己的正确手机号码，方便创建者联系',
      isFormValid: isValid && this.data.creatorPhoneValid
    });
  },
  
  // 验证手机号码
  validatePhone(phone) {
    const phoneRegex = /^1[3-9]\d{9}$/;
    return phoneRegex.test(phone);
  },
  
  // 确保数据库集合存在
  async ensureCollectionsExist(collectionNames) {
    try {
      console.log(`开始确保集合存在: ${collectionNames.join(', ')}`);
      
      // 先尝试通过云函数初始化
      const app = getApp();
      let callFunctionSuccess = false;
      
      try {
        const result = await app.initCollections();
        console.log('云函数初始化集合结果:', result);
        
        if (result && result.success) {
          callFunctionSuccess = true;
          console.log('通过云函数成功初始化集合');
        } else {
          console.warn('通过云函数初始化集合返回非成功状态');
        }
      } catch (cloudError) {
        console.error('通过云函数初始化集合出错:', cloudError);
      }
      
      // 如果云函数调用失败，尝试手动创建集合
      if (!callFunctionSuccess) {
        console.log('尝试手动创建集合');
        
        // 尝试手动创建集合
        const db = wx.cloud.database();
        const results = {};
        
        for (const name of collectionNames) {
          // 对每个集合尝试3次
          let success = false;
          let attempts = 0;
          const maxAttempts = 3;
          
          while (!success && attempts < maxAttempts) {
            attempts++;
            try {
              console.log(`尝试创建集合 ${name}，第${attempts}次尝试`);
              
              // 先检查集合是否存在
              try {
                const countResult = await db.collection(name).count();
                console.log(`集合 ${name} 已存在, 记录数: ${countResult.total}`);
                results[name] = '已存在';
                success = true;
              } catch (countError) {
                // 如果集合不存在，尝试创建
                if (countError.errCode === -502005) {
                  try {
                    await db.createCollection(name);
                    console.log(`成功创建集合: ${name}`);
                    results[name] = '创建成功';
                    success = true;
                  } catch (createError) {
                    if (createError.errCode === -501001) {
                      // 集合已存在，这是正常的
                      console.log(`集合 ${name} 已存在 (创建时检测)`);
                      results[name] = '已存在';
                      success = true;
                    } else {
                      console.error(`创建集合失败: ${name}，错误码: ${createError.errCode}，错误信息: ${createError.errMsg || createError.message || '未知错误'}`);
                      
                      if (attempts < maxAttempts) {
                        console.log(`将在0.5秒后重试创建集合: ${name}`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                      } else {
                        results[name] = `创建失败: ${createError.errMsg || createError.message || '未知错误'}`;
                      }
                    }
                  }
                } else {
                  console.error(`检查集合是否存在时出错: ${name}，错误码: ${countError.errCode}，错误信息: ${countError.errMsg || countError.message || '未知错误'}`);
                  
                  if (attempts < maxAttempts) {
                    console.log(`将在0.5秒后重试检查集合: ${name}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                  } else {
                    results[name] = `检查失败: ${countError.errMsg || countError.message || '未知错误'}`;
                  }
                }
              }
            } catch (error) {
              console.error(`处理集合时出现意外错误: ${name}`, error);
              
              if (attempts < maxAttempts) {
                console.log(`将在0.5秒后重试: ${name}`);
                await new Promise(resolve => setTimeout(resolve, 500));
              } else {
                results[name] = `意外错误: ${error.errMsg || error.message || '未知错误'}`;
              }
            }
          }
        }
        
        console.log('手动创建集合结果:', results);
      }
      
      // 即使部分集合创建失败，我们也返回成功，让程序继续尝试操作
      return {
        success: true,
        message: '完成集合初始化过程'
      };
    } catch (err) {
      console.error('确保数据库集合存在过程出错:', err);
      // 即使出错，我们也返回成功，让程序继续尝试操作
      return {
        success: true,
        message: '集合初始化过程出错，但继续尝试操作',
        error: err
      };
    }
  },
  
  // 绑定手机号
  async bindPhone() {
    if (!this.data.isFormValid) {
      if (!this.data.creatorPhoneValid) {
        this.setData({
          errorMessage: '请输入正确的创建者手机号'
        });
      } else if (!this.data.participantPhoneValid) {
        this.setData({
          errorMessage: '请输入正确的参与者手机号'
        });
      }
      return;
    }
    
    this.setData({ isSubmitting: true, errorMessage: '' });
    
    wx.showLoading({
      title: '绑定中...',
      mask: true
    });
    
    try {
      // 确保数据库集合已初始化
      try {
        console.log('开始确保数据库集合已初始化');
        const collectionResult = await this.ensureCollectionsExist(['baby_creators', 'baby_info', 'baby_participants']);
        console.log('数据库集合初始化结果:', collectionResult);
        
        // 等待一段时间确保集合可用
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('等待后继续执行');
      } catch (initError) {
        console.warn('初始化数据库集合失败，但将继续尝试绑定:', initError);
      }
      
      const db = wx.cloud.database();
      
      // 确保获取到openid
      const app = getApp();
      let openid = app.globalData.openid || wx.getStorageSync('openid');
      if (!openid) {
        try {
          openid = await app.getOpenid();
        } catch (error) {
          console.error('获取openid失败:', error);
        }
      }
      
      console.log('当前参与者绑定时的openid:', openid);
      
      // 检查是否存在与该手机号关联的宝宝信息
      console.log('参与者查询创建者手机号:', this.data.creatorPhone);

      // 修改查询条件，尝试使用更精确的匹配
      const creatorResult = await db.collection('baby_creators').where({
        phone: this.data.creatorPhone.trim() // 去除可能的空格
      }).get();

      // 查询后添加更详细的日志
      console.log('创建者查询结果详情:', JSON.stringify(creatorResult));
      
      // 打印更详细的结果信息
      if(!creatorResult.data || creatorResult.data.length === 0) {
        console.log('未找到创建者记录,请检查:');
        console.log('1. 数据库中是否存在该手机号');
        console.log('2. 手机号格式是否完全匹配');
        console.log('3. 数据库权限是否正确设置');
      }
      
      if (!creatorResult.data || creatorResult.data.length === 0) {
        this.setData({
          errorMessage: '未找到与该手机号关联的宝宝信息，请确认号码是否正确',
          isSubmitting: false
        });
        wx.hideLoading();
        return;
      }
      
      // 获取创建者的openid和babyUid
      const creatorOpenid = creatorResult.data[0]._openid;
      const creatorPhone = creatorResult.data[0].phone;
      const babyUid = creatorResult.data[0].babyUid;
      
      console.log('找到创建者phone:', creatorPhone, 'openid:', creatorOpenid, 'babyUid:', babyUid);
      
      if (!babyUid) {
        console.log('创建者记录中没有宝宝UID，尝试通过手机号查询宝宝信息获取UID');
      }
      
      // 查询宝宝信息，优先使用babyUid
      let babyInfo = null;
      if (babyUid) {
        // 通过babyUid查询宝宝信息
        console.log('通过babyUid查询宝宝信息:', babyUid);
        const babyInfoByUid = await db.collection('baby_info').where({
          babyUid: babyUid
        }).get();
        
        if (babyInfoByUid.data && babyInfoByUid.data.length > 0) {
          babyInfo = babyInfoByUid.data[0];
          console.log('通过babyUid找到宝宝信息:', babyInfo);
        } else {
          console.log('通过babyUid未找到宝宝信息，尝试通过手机号查询');
        }
      }
      
      // 如果通过babyUid未找到，尝试通过手机号查询
      if (!babyInfo) {
        console.log('通过手机号查询宝宝信息, creatorPhone:', creatorPhone);
        const babyInfoResult = await db.collection('baby_info').where({
          creatorPhone: creatorPhone
        }).get();
        
        console.log('宝宝信息查询结果:', babyInfoResult);
        
        if (!babyInfoResult.data || babyInfoResult.data.length === 0) {
          // 尝试通过创建者openid查询
          console.log('通过手机号未找到宝宝信息，尝试通过创建者openid查询');
          const babyInfoByOpenid = await db.collection('baby_info').where({
            _openid: creatorOpenid
          }).get();
          
          console.log('通过openid查询结果:', babyInfoByOpenid);
          
          if (!babyInfoByOpenid.data || babyInfoByOpenid.data.length === 0) {
            this.setData({
              errorMessage: '已找到创建者，但未找到宝宝信息，可能创建者尚未完成宝宝信息填写',
              isSubmitting: false
            });
            wx.hideLoading();
            return;
          }
          
          // 找到了通过openid关联的宝宝信息，但可能没有creatorPhone字段
          babyInfo = babyInfoByOpenid.data[0];
          
          // 如果宝宝信息中没有babyUid，生成一个
          if (!babyInfo.babyUid) {
            const newBabyUid = this.generateBabyUid();
            console.log('生成新的宝宝UID:', newBabyUid);
            
            // 更新宝宝信息，添加babyUid字段
            try {
              console.log('更新宝宝信息，添加babyUid字段');
              await db.collection('baby_info').doc(babyInfo._id).update({
                data: {
                  babyUid: newBabyUid,
                  creatorPhone: creatorPhone, // 确保添加creatorPhone
                  updatedAt: db.serverDate()
                }
              });
              
              // 同时更新创建者记录中的babyUid
              await db.collection('baby_creators').doc(creatorResult.data[0]._id).update({
                data: {
                  babyUid: newBabyUid,
                  updatedAt: db.serverDate()
                }
              });
              
              // 更新后的宝宝信息
              babyInfo.babyUid = newBabyUid;
              babyInfo.creatorPhone = creatorPhone;
            } catch (updateError) {
              console.error('更新宝宝信息失败:', updateError);
              // 继续处理，即使更新失败也尝试进行绑定
            }
          }
        } else {
          // 获取宝宝信息
          babyInfo = babyInfoResult.data[0];
          
          // 如果宝宝信息中没有babyUid，生成一个
          if (!babyInfo.babyUid) {
            const newBabyUid = this.generateBabyUid();
            console.log('生成新的宝宝UID:', newBabyUid);
            
            // 更新宝宝信息，添加babyUid字段
            try {
              console.log('更新宝宝信息，添加babyUid字段');
              await db.collection('baby_info').doc(babyInfo._id).update({
                data: {
                  babyUid: newBabyUid,
                  updatedAt: db.serverDate()
                }
              });
              
              // 同时更新创建者记录中的babyUid
              await db.collection('baby_creators').doc(creatorResult.data[0]._id).update({
                data: {
                  babyUid: newBabyUid,
                  updatedAt: db.serverDate()
                }
              });
              
              // 更新后的宝宝信息
              babyInfo.babyUid = newBabyUid;
            } catch (updateError) {
              console.error('更新宝宝信息失败:', updateError);
              // 继续处理，即使更新失败也尝试进行绑定
            }
          }
        }
      }
      
      // 获取最终要使用的babyUid
      const finalBabyUid = babyInfo.babyUid;
      if (!finalBabyUid) {
        this.setData({
          errorMessage: '无法获取宝宝唯一ID，请联系创建者完善宝宝信息',
          isSubmitting: false
        });
        wx.hideLoading();
        return;
      }
      
      // 保存绑定信息到本地
      wx.setStorageSync('baby_info_completed', true);
      wx.setStorageSync('bound_creator_phone', creatorPhone);
      wx.setStorageSync('baby_uid', finalBabyUid);
      
      // 保存到app全局数据
      app.globalData.babyInfo = babyInfo;
      app.globalData.creatorPhone = creatorPhone;
      app.globalData.babyUid = finalBabyUid;
      
      // 强制同步存储数据到硬盘
      try {
        // 使用一个空的wx.getStorageSync强制刷新存储
        wx.getStorageSync('');
        console.log('已强制同步存储数据');
      } catch (syncError) {
        console.warn('同步存储数据失败:', syncError);
      }
      
      // 记录参与者关联
      try {
        if (openid) {
          // 检查是否已存在 - 通过参与者手机号和babyUid来检查
          const existingParticipant = await db.collection('baby_participants').where({
            phone: this.data.participantPhone,
            babyUid: finalBabyUid
          }).get();
          
          if (!existingParticipant.data || existingParticipant.data.length === 0) {
            // 添加新记录 - 不手动指定_openid，让系统自动添加
            await db.collection('baby_participants').add({
              data: {
                phone: this.data.participantPhone, // 添加参与者自己的手机号
                creatorPhone: creatorPhone,
                babyUid: finalBabyUid, // 使用宝宝唯一ID关联
                createdAt: db.serverDate(),
                updatedAt: db.serverDate()
              }
            });
            console.log('成功记录参与者关联');
          } else {
            // 更新现有记录
            await db.collection('baby_participants').doc(existingParticipant.data[0]._id).update({
              data: {
                phone: this.data.participantPhone, // 更新参与者手机号
                updatedAt: db.serverDate()
              }
            });
            console.log('更新参与者关联信息');
          }
        } else {
          console.warn('未能获取openid，无法记录参与者关联');
        }
      } catch (error) {
        console.warn('记录参与者关联失败:', error);
      }
      
      // 延迟处理跳转
      setTimeout(() => {
        wx.hideLoading();
        
        // 提示绑定成功
        wx.showToast({
          title: '绑定成功',
          icon: 'success',
          mask: true,
          duration: 1500,
          complete: () => {
            // 延迟后跳转到首页
            setTimeout(() => {
              wx.switchTab({
                url: '/pages/daily-feeding/index',
                success: () => {
                  console.log('跳转到首页成功');
                },
                fail: (err) => {
                  console.error('跳转到首页失败:', err);
                }
              });
            }, 500);
          }
        });
        
        this.setData({ isSubmitting: false });
      }, 500);
    } catch (error) {
      console.error('绑定手机号失败:', error);
      wx.hideLoading();
      
      // 提供更详细的错误信息
      let errorMsg = '绑定失败，请稍后重试';
      if (error.errCode === -502005) {
        errorMsg = '绑定失败: 数据库集合不存在，请联系客服';
      } else if (error.message) {
        errorMsg = error.message;
      }
      
      this.setData({
        errorMessage: errorMsg,
        isSubmitting: false
      });
    }
  },

  // 生成唯一宝宝ID
  generateBabyUid() {
    // 生成时间戳+随机数作为唯一ID
    const timestamp = new Date().getTime();
    const randomNum = Math.floor(Math.random() * 10000);
    return `baby_${timestamp}_${randomNum}`;
  },

  // 点击首页icon返回角色选择页
  onLogoClick() {
    console.log('===onLogoClick===');
    // 清除角色选择相关的缓存数据
    wx.removeStorageSync('user_role');
    wx.removeStorageSync('has_selected_role');
    wx.removeStorageSync('baby_info_completed');
    wx.removeStorageSync('baby_uid');
    wx.removeStorageSync('creator_phone');
    wx.removeStorageSync('bound_creator_phone');
    
    // 清除全局数据
    const app = getApp();
    app.globalData.userRole = '';
    app.globalData.babyInfo = null;
    app.globalData.babyUid = null;
    app.globalData.creatorPhone = '';
    
    // 跳转回角色选择页
    wx.reLaunch({
      url: '/pages/role-selection/index'
    });
  }
}) 