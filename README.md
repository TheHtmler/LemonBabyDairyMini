# 柠檬宝宝喂养记录小程序 - 数据架构设计

## 数据模型与权限架构

我们对小程序的数据模型和权限架构进行了升级，引入了以下核心改进：

### 1. 引入唯一宝宝UID

- 每个宝宝信息创建时生成唯一标识`babyUid`
- 所有与宝宝相关的数据记录都与此UID关联
- 解决了多人协作记录数据时的关联问题

### 2. 用户角色模型

- **创建者**：可以创建宝宝信息，并拥有完全管理权限
- **参与者**：通过绑定创建者手机号访问宝宝数据，有记录数据的权限

### 3. 数据关联方式

- 创建者通过`creatorPhone`（作为唯一标识）与宝宝信息关联
- 参与者通过`babyUid`与宝宝数据关联
- 参与者需要填写自己的手机号，便于创建者联系

### 4. 集成式数据结构

- 将配奶设置和药物管理直接存储在宝宝信息中，确保数据一致性
- 为了兼容旧版本，同时保留独立的设置集合
- 修改任何设置时优先更新宝宝信息，确保数据的主来源唯一

### 5. 数据表结构

#### baby_info表 (主数据源)
- 存储宝宝的基本信息，以及配奶设置和药物管理
- 主要字段：
  - `babyUid`: 宝宝唯一标识
  - `name`: 宝宝昵称
  - `gender`: 性别
  - `birthday`: 出生日期
  - `weight`: 体重
  - `height`: 身高
  - `condition`: 疾病类型
  - `notes`: 备注
  - `creatorPhone`: 创建者手机号
  - `avatarUrl`: 宝宝头像
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间
  - `nutritionSettings`: 配奶设置对象，包含所有营养计算参数
  - `medicationSettings`: 药物管理数组，包含所有药物信息

#### baby_creators表
- 存储创建者信息
- 主要字段：
  - `_openid`: 创建者微信openid
  - `phone`: 创建者手机号
  - `babyUid`: 关联的宝宝UID
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间

#### baby_participants表
- 存储参与者信息
- 主要字段：
  - `_openid`: 参与者微信openid
  - `phone`: 参与者手机号
  - `creatorPhone`: 关联的创建者手机号
  - `babyUid`: 关联的宝宝UID
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间

#### feeding_records表
- 存储喂养记录数据
- 主要字段：
  - `date`: 记录日期
  - `babyUid`: 关联的宝宝UID
  - `weight`: 宝宝当日体重
  - `feedings`: 喂奶记录数组
  - `medications`: 药物记录对象
  
  - `userInfo`: 操作用户信息
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间

#### nutrition_settings表 (兼容性表)
- 仅用于兼容旧版本，新版数据主要存储在baby_info中
- 主要字段：
  - `_id`: 记录ID
  - `_openid`: 用户openid
  - `babyUid`: 关联的宝宝UID
  - `natural_protein_coefficient`: 天然蛋白系数
  - `natural_milk_protein`: 天然奶蛋白质含量
  - `special_milk_protein`: 特奶蛋白质含量
  - `special_milk_ratio`: 特奶配比
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间

#### medications表 (兼容性表)
- 仅用于兼容旧版本，新版数据主要存储在baby_info中
- 主要字段：
  - `_id`: 记录ID
  - `_openid`: 用户openid
  - `babyUid`: 关联的宝宝UID
  - `name`: 药物名称
  - `dosage`: 剂量
  - `unit`: 单位
  - `frequency`: 服用频率
  - `notes`: 备注
  - `createdAt`: 创建时间
  - `updatedAt`: 更新时间

## 数据流程

### 创建者流程

1. 创建者选择角色后填写基本信息和手机号
2. 系统生成唯一的`babyUid`和默认的配奶设置与药物管理
3. 保存宝宝信息到`baby_info`表，同时创建者信息存入`baby_creators`表
4. 创建者可以完整管理宝宝信息、配奶设置、药物管理和喂养记录

### 参与者流程

1. 参与者选择角色后，需要填写：
   - 创建者手机号（用于绑定宝宝数据）
   - 自己的手机号（方便创建者联系）
2. 系统查找该创建者关联的宝宝信息，获取`babyUid`
3. 参与者信息保存到`baby_participants`表
4. 参与者通过`babyUid`查询和记录宝宝的喂养数据，查看宝宝信息

### 数据查询和同步

- 所有喂养记录在`feeding_records`表中添加`babyUid`字段
- 查询数据时优先使用`babyUid`作为条件
- 如果找不到`babyUid`，则降级使用创建者手机号或openid
- 保存数据时始终带上`babyUid`以确保数据关联
- 修改设置时优先更新`baby_info`表中的设置字段，然后同步到兼容性表

## 优势

1. **数据集中管理**：配奶设置和药物管理存储在宝宝信息中，避免数据分散
2. **简化数据访问**：通过单一查询即可获取宝宝所有相关设置
3. **确保数据一致性**：避免多个表之间的数据不同步问题
4. **兼容旧版本**：保留独立的设置表，确保旧版本应用继续工作
5. **优化查询性能**：减少跨表查询，提高应用响应速度

## 技术实现

- 小程序云开发作为后端服务
- 云数据库存储所有数据
- 云存储保存宝宝头像等媒体资源
- 前端使用微信小程序原生框架

# 云开发 quickstart

这是云开发的快速启动指引，其中演示了如何上手使用云开发的三大基础能力：

- 数据库：一个既可在小程序前端操作，也能在云函数中读写的 JSON 文档型数据库
- 文件存储：在小程序前端直接上传/下载云端文件，在云开发控制台可视化管理
- 云函数：在云端运行的代码，微信私有协议天然鉴权，开发者只需编写业务逻辑代码

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
