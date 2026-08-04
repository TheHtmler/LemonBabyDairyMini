const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECIPE_WALL_IMAGE_MAX_BYTES,
  compressRecipeWallImage
} = require('../deferred/pkg-recipe-wall/utils/recipeWallImage');

test('compressRecipeWallImage keeps small images unchanged', async () => {
  const res = await compressRecipeWallImage('wxfile://small.jpg', {
    initialSize: 200 * 1024,
    compressImage: async () => {
      throw new Error('should not compress');
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.path, 'wxfile://small.jpg');
  assert.equal(res.size, 200 * 1024);
});

test('compressRecipeWallImage ladders quality until under 1MB', async () => {
  const sizes = {
    'wxfile://big.jpg': 3 * 1024 * 1024,
    'wxfile://q80.jpg': 1.5 * 1024 * 1024,
    'wxfile://q50.jpg': 800 * 1024
  };
  const res = await compressRecipeWallImage('wxfile://big.jpg', {
    initialSize: sizes['wxfile://big.jpg'],
    compressImage: async ({ quality }) => {
      if (quality >= 80) return { tempFilePath: 'wxfile://q80.jpg' };
      return { tempFilePath: 'wxfile://q50.jpg' };
    },
    getFileInfo: async (filePath) => ({ size: sizes[filePath] || 0 })
  });
  assert.equal(res.ok, true);
  assert.equal(res.path, 'wxfile://q50.jpg');
  assert.ok(res.size <= RECIPE_WALL_IMAGE_MAX_BYTES);
});

test('compressRecipeWallImage fails when still too large', async () => {
  const res = await compressRecipeWallImage('wxfile://huge.jpg', {
    initialSize: 5 * 1024 * 1024,
    qualities: [40, 20],
    compressImage: async () => ({ tempFilePath: 'wxfile://still-huge.jpg' }),
    getFileInfo: async () => ({ size: 2 * 1024 * 1024 })
  });
  assert.equal(res.ok, false);
  assert.match(res.message || '', /过大|换一张/);
});
