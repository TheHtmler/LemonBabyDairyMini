// 云函数：诊断 + 清理 feeding_records 中混入其他宝宝的数据
// mode: "diagnose" (默认) - 分析数据污染情况
// mode: "dryRun" - 预览清理方案
// mode: "clean" - 执行清理
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const MAX_LIMIT = 100

async function getAllRecords(collection) {
  const countResult = await db.collection(collection).count()
  const total = countResult.total
  const batchTimes = Math.ceil(total / MAX_LIMIT)
  const tasks = []
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(db.collection(collection).skip(i * MAX_LIMIT).limit(MAX_LIMIT).get())
  }
  const results = await Promise.all(tasks)
  return results.reduce((acc, cur) => acc.concat(cur.data), [])
}

// 构建 babyUid -> 合法 openid 集合 的映射
async function buildBabyCaregiversMap() {
  const [creators, participants] = await Promise.all([
    getAllRecords('baby_creators'),
    getAllRecords('baby_participants')
  ])

  const map = {} // babyUid -> Set<openid>
  creators.forEach(c => {
    if (!c.babyUid || !c._openid) return
    if (!map[c.babyUid]) map[c.babyUid] = new Set()
    map[c.babyUid].add(c._openid)
  })
  participants.forEach(p => {
    if (!p.babyUid || !p._openid) return
    if (!map[p.babyUid]) map[p.babyUid] = new Set()
    map[p.babyUid].add(p._openid)
  })

  return map
}

// 判断一条 feeding 是否属于该文档的宝宝
function isFeedingOwned(f, docBabyUid) {
  return !f.babyUid || f.babyUid === docBabyUid
}

// 判断一条 intake 是否属于该文档的宝宝
// createdBy 必须是该宝宝的合法照护者
function isIntakeOwned(i, docBabyUid, caregiversMap) {
  const caregivers = caregiversMap[docBabyUid]
  if (!caregivers) return true // 查不到照护者信息，保守保留
  if (!i.createdBy) return true // 没有 createdBy，保守保留
  return caregivers.has(i.createdBy)
}

exports.main = async (event) => {
  const mode = event.mode || 'diagnose'
  const records = await getAllRecords('feeding_records')
  const caregiversMap = await buildBabyCaregiversMap()

  // ===== 诊断模式 =====
  if (mode === 'diagnose') {
    const issues = []
    for (const record of records) {
      const docBabyUid = record.babyUid
      if (!docBabyUid) continue

      const feedings = Array.isArray(record.feedings) ? record.feedings : []
      const intakes = Array.isArray(record.intakes) ? record.intakes : []
      const caregivers = caregiversMap[docBabyUid]
      const caregiversList = caregivers ? Array.from(caregivers) : []

      // 检查 feedings
      const foreignFeedings = feedings.filter(f => !isFeedingOwned(f, docBabyUid))
      // 检查 intakes
      const foreignIntakes = intakes.filter(i => !isIntakeOwned(i, docBabyUid, caregiversMap))

      if (foreignFeedings.length === 0 && foreignIntakes.length === 0) continue

      // 统计外来 intakes 的 createdBy
      const foreignIntakeCreators = {}
      foreignIntakes.forEach(i => {
        const creator = i.createdBy || '(空/null)'
        foreignIntakeCreators[creator] = (foreignIntakeCreators[creator] || 0) + 1
      })

      issues.push({
        _id: record._id,
        _openid: record._openid || '(未知)',
        docBabyUid,
        legitimateCaregivers: caregiversList,
        date: record.date,
        feedingTotal: feedings.length,
        feedingForeign: foreignFeedings.length,
        feedingKept: feedings.length - foreignFeedings.length,
        intakeTotal: intakes.length,
        intakeForeign: foreignIntakes.length,
        intakeKept: intakes.length - foreignIntakes.length,
        foreignIntakeCreators
      })
    }

    return {
      mode: 'diagnose',
      totalRecords: records.length,
      issuesFound: issues.length,
      details: issues
    }
  }

  // ===== dryRun / clean 模式 =====
  const isDryRun = mode !== 'clean'
  const issues = []
  const fixed = []

  for (const record of records) {
    const docBabyUid = record.babyUid
    if (!docBabyUid) continue

    let needsUpdate = false
    const changes = {}

    if (Array.isArray(record.feedings) && record.feedings.length > 0) {
      const cleanFeedings = record.feedings.filter(f => isFeedingOwned(f, docBabyUid))
      if (cleanFeedings.length !== record.feedings.length) {
        needsUpdate = true
        changes.feedings = {
          before: record.feedings.length,
          after: cleanFeedings.length,
          removed: record.feedings.length - cleanFeedings.length
        }
        changes._cleanFeedings = cleanFeedings
      }
    }

    if (Array.isArray(record.intakes) && record.intakes.length > 0) {
      const cleanIntakes = record.intakes.filter(i => isIntakeOwned(i, docBabyUid, caregiversMap))
      if (cleanIntakes.length !== record.intakes.length) {
        needsUpdate = true
        changes.intakes = {
          before: record.intakes.length,
          after: cleanIntakes.length,
          removed: record.intakes.length - cleanIntakes.length
        }
        changes._cleanIntakes = cleanIntakes
      }
    }

    if (needsUpdate) {
      issues.push({
        _id: record._id,
        babyUid: docBabyUid,
        date: record.date,
        changes
      })

      if (!isDryRun) {
        const updateData = { updatedAt: db.serverDate() }
        if (changes._cleanFeedings) updateData.feedings = changes._cleanFeedings
        if (changes._cleanIntakes) updateData.intakes = changes._cleanIntakes

        try {
          await db.collection('feeding_records').doc(record._id).update({ data: updateData })
          fixed.push(record._id)
        } catch (err) {
          console.error('修复失败:', record._id, err)
        }
      }
    }
  }

  const report = issues.map(item => {
    const { changes, ...rest } = item
    const { _cleanFeedings, _cleanIntakes, ...safeChanges } = changes
    return { ...rest, changes: safeChanges }
  })

  return {
    mode,
    totalRecords: records.length,
    issuesFound: report.length,
    fixedCount: fixed.length,
    details: report
  }
}
