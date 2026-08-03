/**
 * 功能入口开关（发版常量，改完需重新提审/发版）
 *
 * 食谱墙：个人主体未开放 UGC/社交类目，提审期间隐藏入口。
 * 换企业主体并申请对应类目后，将 RECIPE_WALL_MENU_VISIBLE 改为 true 即可恢复。
 */
const RECIPE_WALL_MENU_VISIBLE = false;

module.exports = {
  RECIPE_WALL_MENU_VISIBLE
};
