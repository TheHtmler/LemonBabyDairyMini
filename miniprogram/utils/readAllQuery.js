// 使用原查询条件分页，避免客户端默认条数限制截断当天共享记录。
async function readAllQuery(query) {
  const data = [];
  const pageSize = 20;
  for (let offset = 0; ; offset += pageSize) {
    const result = await query.skip(offset).limit(pageSize).get();
    const batch = result.data || [];
    data.push(...batch);
    if (batch.length < pageSize) break;
  }
  // 刷新期间家庭成员可能新增记录，去除分页边界移动带来的重复项。
  const seen = new Set();
  return { data: data.filter((record) => {
    if (!record._id) return true;
    if (seen.has(record._id)) return false;
    seen.add(record._id);
    return true;
  }) };
}

module.exports = { readAllQuery };
