const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const functionPath = path.join('cloudfunctions', 'recipeWallManager', 'index.js');

function matchesQuery(item, query = {}) {
  if (!query || typeof query !== 'object') return true;
  if (Array.isArray(query.$and)) {
    return query.$and.every((part) => matchesQuery(item, part));
  }
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) {
      return value.$in.includes(item[key]);
    }
    if (value && typeof value === 'object' && value.$regex) {
      return new RegExp(value.$regex, value.$options || '').test(String(item[key] || ''));
    }
    if (Array.isArray(item[key]) && typeof value === 'string') {
      return item[key].includes(value);
    }
    return item[key] === value;
  });
}

function createDbMock(seed = {}) {
  const writes = { updates: [], removes: [], adds: [] };
  const data = {
    recipe_wall_posts: (seed.posts || []).map((item) => ({ ...item })),
    recipe_wall_likes: (seed.likes || []).map((item) => ({ ...item }))
  };

  const db = {
    serverDate() {
      return '__server_date__';
    },
    command: {
      in(list) {
        return { $in: list };
      },
      and(list) {
        return { $and: list };
      }
    },
    RegExp({ regexp, options }) {
      return { $regex: regexp, $options: options || '' };
    },
    collection(name) {
      if (!data[name]) data[name] = [];
      return {
        where(query) {
          const filtered = () => (data[name] || []).filter((item) => matchesQuery(item, query));
          const chain = {
            orderBy() { return chain; },
            skip() { return chain; },
            limit() { return chain; },
            async get() {
              return { data: filtered() };
            },
            async count() {
              return { total: filtered().length };
            },
            async update({ data: updateData }) {
              const rows = data[name] || [];
              const matched = rows.filter((item) => matchesQuery(item, query));
              matched.forEach((item) => Object.assign(item, updateData));
              writes.updates.push({ collectionName: name, query, data: updateData });
              return { stats: { updated: matched.length } };
            },
            async remove() {
              const rows = data[name] || [];
              const kept = rows.filter((item) => !matchesQuery(item, query));
              data[name] = kept;
              writes.removes.push({ collectionName: name, query });
              return { stats: { removed: rows.length - kept.length } };
            }
          };
          return chain;
        },
        doc(id) {
          return {
            async get() {
              const row = (data[name] || []).find((item) => item._id === id);
              return { data: row ? { ...row } : null };
            },
            async update({ data: updateData }) {
              const row = (data[name] || []).find((item) => item._id === id);
              if (row) Object.assign(row, updateData);
              writes.updates.push({ collectionName: name, docId: id, data: updateData });
              return { stats: { updated: row ? 1 : 0 } };
            },
            async remove() {
              const rows = data[name] || [];
              const kept = rows.filter((item) => item._id !== id);
              data[name] = kept;
              writes.removes.push({ collectionName: name, docId: id });
              return { stats: { removed: rows.length - kept.length } };
            }
          };
        },
        orderBy() {
          return this;
        },
        skip() {
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          return { data: data[name] || [] };
        },
        async add({ data: addData }) {
          // 贴近真实云函数：不会自动注入调用方 _openid
          const row = {
            _id: `${name}-${data[name].length + 1}`,
            ...addData
          };
          data[name].push(row);
          writes.adds.push({ collectionName: name, data: addData });
          return { _id: row._id };
        }
      };
    }
  };

  return { db, writes, data };
}

function loadRecipeWallManager({
  openid = 'user-1',
  posts = [],
  likes = [],
  msgSecCheck,
  imgSecCheck
} = {}) {
  const { db, writes, data } = createDbMock({ posts, likes });
  db.__openid = openid;
  const security = {
    msgCalled: false,
    imgCalled: 0,
    deletedFiles: []
  };

  const resolved = require.resolve(path.resolve(__dirname, '..', functionPath));
  const previousLoad = Module._load;
  delete require.cache[resolved];
  const utilsResolved = require.resolve(path.resolve(__dirname, '..', 'cloudfunctions/recipeWallManager/recipeWallUtils.js'));
  delete require.cache[utilsResolved];

  Module._load = function mockWxServerSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test-env',
        init() {},
        database() {
          return db;
        },
        getWXContext() {
          return { OPENID: openid };
        },
        openapi: {
          security: {
            async msgSecCheck(payload) {
              security.msgCalled = true;
              if (typeof msgSecCheck === 'function') return msgSecCheck(payload);
              return { errCode: 0 };
            },
            async imgSecCheck(payload) {
              security.imgCalled += 1;
              if (typeof imgSecCheck === 'function') return imgSecCheck(payload);
              return { errCode: 0 };
            }
          }
        },
        async downloadFile() {
          return { fileContent: Buffer.from('img') };
        },
        async deleteFile({ fileList }) {
          security.deletedFiles.push(...(fileList || []));
          return { fileList: [] };
        }
      };
    }
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    const mod = require(resolved);
    return { main: mod.main, writes, data, security, db };
  } finally {
    Module._load = previousLoad;
  }
}

const validPublish = {
  action: 'publish',
  title: '南瓜泥',
  description: '软糯辅食',
  coverFileId: 'cloud://c.png',
  ingredients: [{ foodId: 'f1', foodName: '南瓜', quantity: 100, unit: 'g' }],
  steps: [{ text: '蒸熟捣碎' }],
  cookingMinutes: 15,
  difficulty: 'easy',
  totalNutrition: { calories: 80, protein: 1.2, carbs: 18, fat: 0.3 },
  babyName: '柠檬',
  authorDisplayName: '妈妈',
  babyUid: 'b1'
};

test('publish rejects when openid missing', async () => {
  const { main } = loadRecipeWallManager({ openid: '' });
  const res = await main(validPublish);
  assert.equal(res.ok, false);
  assert.match(res.message, /身份/);
});

test('publish rejects invalid payload without writing', async () => {
  const { main, writes } = loadRecipeWallManager({ openid: 'user-1' });
  const res = await main({ ...validPublish, coverFileId: '' });
  assert.equal(res.ok, false);
  assert.equal(writes.adds.length, 0);
});

test('publish rejects when text security fails', async () => {
  const { main, writes, security } = loadRecipeWallManager({
    openid: 'user-1',
    msgSecCheck: async () => ({ errCode: 87014 })
  });
  const res = await main(validPublish);
  assert.equal(res.ok, false);
  assert.equal(writes.adds.length, 0);
  assert.equal(security.msgCalled, true);
  assert.ok(security.deletedFiles.includes('cloud://c.png'));
});

test('publish writes published post when security passes', async () => {
  const { main, data } = loadRecipeWallManager({ openid: 'user-1' });
  const res = await main(validPublish);
  assert.equal(res.ok, true);
  assert.ok(res.postId);
  assert.equal(data.recipe_wall_posts[0].status, 'published');
  assert.equal(data.recipe_wall_posts[0].authorOpenid, 'user-1');
  assert.equal(data.recipe_wall_posts[0].babyName, '柠檬');
  assert.equal(data.recipe_wall_posts[0].authorDisplayName, '妈妈');
  assert.equal(data.recipe_wall_posts[0].likeCount, 0);
});

test('list does not return taken_down posts', async () => {
  const { main } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [
      {
        _id: 'p1',
        status: 'published',
        title: 'A',
        babyName: '柠檬',
        authorDisplayName: '妈妈',
        likeCount: 0,
        createdAt: 2
      },
      {
        _id: 'p2',
        status: 'taken_down',
        title: 'B',
        babyName: '柠檬',
        authorDisplayName: '妈妈',
        likeCount: 0,
        createdAt: 1
      }
    ]
  });
  const res = await main({ action: 'list' });
  assert.equal(res.ok, true);
  assert.equal(res.list.length, 1);
  assert.equal(res.list[0]._id, 'p1');
});

test('list supports keyword filter', async () => {
  const { main } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [
      {
        _id: 'p1',
        status: 'published',
        title: '南瓜泥',
        searchText: '南瓜泥 软糯辅食 南瓜',
        createdAt: 3
      },
      {
        _id: 'p2',
        status: 'published',
        title: '低蛋白米糊',
        searchText: '低蛋白米糊 大米',
        createdAt: 2
      }
    ]
  });

  const byKeyword = await main({ action: 'list', keyword: '米糊' });
  assert.equal(byKeyword.ok, true);
  assert.equal(byKeyword.list.length, 1);
  assert.equal(byKeyword.list[0]._id, 'p2');
});

test('list liked filter returns only liked published posts', async () => {
  const { main } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [
      { _id: 'p1', status: 'published', title: 'A', searchText: 'a', createdAt: 3 },
      { _id: 'p2', status: 'published', title: 'B', searchText: 'b', createdAt: 2 },
      { _id: 'p3', status: 'taken_down', title: 'C', searchText: 'c', createdAt: 1 }
    ],
    likes: [
      { _id: 'l1', userOpenid: 'user-1', postId: 'p2', createdAt: 20 },
      { _id: 'l2', userOpenid: 'user-1', postId: 'p3', createdAt: 10 },
      { _id: 'l3', userOpenid: 'user-1', postId: 'p1', createdAt: 5 }
    ]
  });

  const res = await main({ action: 'list', filter: 'liked' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.list.map((item) => item._id), ['p2', 'p1']);
  assert.equal(res.list.every((item) => item.liked), true);
});

test('list mine filter returns author posts including taken_down', async () => {
  const { main } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [
      {
        _id: 'p1',
        authorOpenid: 'user-1',
        status: 'published',
        title: '我的南瓜',
        searchText: '我的南瓜 南瓜',
        createdAt: 3
      },
      {
        _id: 'p2',
        authorOpenid: 'user-1',
        status: 'taken_down',
        title: '已下架米糊',
        searchText: '已下架米糊 米糊',
        createdAt: 2
      },
      {
        _id: 'p3',
        authorOpenid: 'other',
        status: 'published',
        title: '别人的菜',
        searchText: '别人的菜',
        createdAt: 1
      },
      {
        _id: 'p4',
        _openid: 'user-1',
        status: 'published',
        title: '仅_openid旧帖',
        searchText: '仅_openid旧帖',
        createdAt: 4
      }
    ]
  });

  const res = await main({ action: 'list', filter: 'mine' });
  assert.equal(res.ok, true);
  assert.equal(res.filter, 'mine');
  assert.deepEqual(res.list.map((item) => item._id), ['p4', 'p1', 'p2']);

  const byKeyword = await main({ action: 'list', filter: 'mine', keyword: '米糊' });
  assert.equal(byKeyword.ok, true);
  assert.deepEqual(byKeyword.list.map((item) => item._id), ['p2']);
});

test('toggleLike increments then decrements without going below zero', async () => {
  const { main, data } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'p1',
      status: 'published',
      likeCount: 0,
      _openid: 'author'
    }]
  });

  const liked = await main({ action: 'toggleLike', postId: 'p1' });
  assert.equal(liked.ok, true);
  assert.equal(liked.liked, true);
  assert.equal(liked.likeCount, 1);
  assert.equal(data.recipe_wall_likes.length, 1);
  assert.equal(data.recipe_wall_likes[0].userOpenid, 'user-1');

  const unliked = await main({ action: 'toggleLike', postId: 'p1' });
  assert.equal(unliked.ok, true);
  assert.equal(unliked.liked, false);
  assert.equal(unliked.likeCount, 0);
  assert.equal(data.recipe_wall_likes.length, 0);
});

test('toggleLike cleans orphan likes without user identity then toggles correctly', async () => {
  const { main, data } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'p1',
      status: 'published',
      likeCount: 3,
      _openid: 'author'
    }],
    likes: [
      { _id: 'orphan-1', postId: 'p1', createdAt: 1 },
      { _id: 'orphan-2', postId: 'p1', createdAt: 2 },
      { _id: 'orphan-3', postId: 'p1', createdAt: 3 }
    ]
  });

  const liked = await main({ action: 'toggleLike', postId: 'p1' });
  assert.equal(liked.ok, true);
  assert.equal(liked.liked, true);
  assert.equal(liked.likeCount, 1);
  assert.equal(data.recipe_wall_likes.length, 1);
  assert.equal(data.recipe_wall_likes[0].userOpenid, 'user-1');

  const unliked = await main({ action: 'toggleLike', postId: 'p1' });
  assert.equal(unliked.ok, true);
  assert.equal(unliked.liked, false);
  assert.equal(unliked.likeCount, 0);
  assert.equal(data.recipe_wall_likes.length, 0);
});

test('deleteOwn fails for non-owner', async () => {
  const { main } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{ _id: 'p1', _openid: 'other', status: 'published' }]
  });
  const res = await main({ action: 'deleteOwn', postId: 'p1' });
  assert.equal(res.ok, false);
});

test('takeDown requires developer and updates status', async () => {
  const denied = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{ _id: 'p1', status: 'published' }]
  });
  const deniedRes = await denied.main({ action: 'takeDown', postId: 'p1' });
  assert.equal(deniedRes.ok, false);

  const allowed = loadRecipeWallManager({
    openid: 'oYCao7fijm22dyl6C-tcYJo_G69A',
    posts: [{ _id: 'p1', status: 'published' }]
  });
  const okRes = await allowed.main({ action: 'takeDown', postId: 'p1' });
  assert.equal(okRes.ok, true);
  assert.equal(allowed.data.recipe_wall_posts[0].status, 'taken_down');
});

test('detail hides taken_down from non-owner but allows owner', async () => {
  const other = loadRecipeWallManager({
    openid: 'user-2',
    posts: [{
      _id: 'p1',
      _openid: 'user-1',
      status: 'taken_down',
      title: '隐藏'
    }]
  });
  const hidden = await other.main({ action: 'detail', postId: 'p1' });
  assert.equal(hidden.ok, false);
  assert.equal(hidden.code, 'UNAVAILABLE');

  const owner = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'p1',
      _openid: 'user-1',
      status: 'taken_down',
      title: '隐藏'
    }]
  });
  const visible = await owner.main({ action: 'detail', postId: 'p1' });
  assert.equal(visible.ok, true);
  assert.equal(visible.post.title, '隐藏');
});

test('saveDraft requires title and stores draft status', async () => {
  const { main, data } = loadRecipeWallManager({ openid: 'user-1' });
  const rejected = await main({ action: 'saveDraft', title: '' });
  assert.equal(rejected.ok, false);

  const saved = await main({ action: 'saveDraft', title: '草稿南瓜' });
  assert.equal(saved.ok, true);
  assert.ok(saved.postId);
  assert.equal(data.recipe_wall_posts[0].status, 'draft');
  assert.equal(data.recipe_wall_posts[0].authorOpenid, 'user-1');
  assert.equal(data.recipe_wall_posts[0].title, '草稿南瓜');
});

test('saveDraft updates existing draft and rejects published', async () => {
  const { main, data } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'd1',
      authorOpenid: 'user-1',
      status: 'draft',
      title: '旧标题',
      likeCount: 0
    }]
  });

  const updated = await main({ action: 'saveDraft', postId: 'd1', title: '新标题' });
  assert.equal(updated.ok, true);
  assert.equal(updated.postId, 'd1');
  assert.equal(data.recipe_wall_posts[0].title, '新标题');

  const publishedCtx = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'p1',
      authorOpenid: 'user-1',
      status: 'published',
      title: '已发',
      likeCount: 0
    }]
  });
  const denied = await publishedCtx.main({ action: 'saveDraft', postId: 'p1', title: '改回草稿' });
  assert.equal(denied.ok, false);
});

test('publish with draft postId promotes to published', async () => {
  const { main, data } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'd1',
      authorOpenid: 'user-1',
      status: 'draft',
      title: '旧',
      likeCount: 0
    }]
  });

  const res = await main({ ...validPublish, postId: 'd1' });
  assert.equal(res.ok, true);
  assert.equal(res.postId, 'd1');
  assert.equal(data.recipe_wall_posts.length, 1);
  assert.equal(data.recipe_wall_posts[0].status, 'published');
  assert.equal(data.recipe_wall_posts[0].title, '南瓜泥');
});

test('publish with published postId overlays content and keeps likes', async () => {
  const { main, data } = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'p1',
      authorOpenid: 'user-1',
      status: 'published',
      title: '旧标题',
      likeCount: 7
    }]
  });

  const res = await main({ ...validPublish, postId: 'p1', title: '新标题南瓜泥' });
  assert.equal(res.ok, true);
  assert.equal(res.postId, 'p1');
  assert.equal(data.recipe_wall_posts.length, 1);
  assert.equal(data.recipe_wall_posts[0].status, 'published');
  assert.equal(data.recipe_wall_posts[0].title, '新标题南瓜泥');
  assert.equal(data.recipe_wall_posts[0].likeCount, 7);
});

test('getOwn returns owner post and rejects others', async () => {
  const owner = loadRecipeWallManager({
    openid: 'user-1',
    posts: [{
      _id: 'd1',
      authorOpenid: 'user-1',
      status: 'draft',
      title: '我的草稿'
    }]
  });
  const ok = await owner.main({ action: 'getOwn', postId: 'd1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.post.title, '我的草稿');

  const other = loadRecipeWallManager({
    openid: 'user-2',
    posts: [{
      _id: 'd1',
      authorOpenid: 'user-1',
      status: 'draft',
      title: '我的草稿'
    }]
  });
  const denied = await other.main({ action: 'getOwn', postId: 'd1' });
  assert.equal(denied.ok, false);
});
