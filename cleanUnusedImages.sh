#!/bin/bash

# 设置要删除的未使用示例图片列表
UNUSED_IMAGES=(
  "miniprogram/images/cloud_backend.png"
  "miniprogram/images/cloud_backend_info.png"
  "miniprogram/images/cloud_dev.png"
  "miniprogram/images/function_deploy.png"
  "miniprogram/images/database_add.png"
  "miniprogram/images/list-database.png"
  "miniprogram/images/cloud_backend_login.png"
  "miniprogram/images/single_template.png"
  "miniprogram/images/avatar.png"
  "miniprogram/images/single_template_sample.png"
  "miniprogram/images/deploy_step1.png"
  "miniprogram/images/single_template_info.png"
  "miniprogram/images/create_env.png"
  "miniprogram/images/database.png"
  "miniprogram/images/deploy_step2.png"
  "miniprogram/images/list-init.png"
  "miniprogram/images/default-goods-image.png"
  "miniprogram/images/list-scf.png"
  "miniprogram/images/list-share.png"
  "miniprogram/images/scf-enter.png"
  "miniprogram/images/env-select.png"
  "miniprogram/images/icons/home.png"
  "miniprogram/images/icons/home-active.png"
  "miniprogram/images/icons/business.png"
  "miniprogram/images/icons/business-active.png"
  "miniprogram/images/icons/examples.png"
  "miniprogram/images/icons/examples-active.png"
  "miniprogram/images/icons/goods.png"
  "miniprogram/images/icons/goods-active.png"
  "miniprogram/images/icons/usercenter.png"
  "miniprogram/images/icons/usercenter-active.png"
)

echo "=== 开始清理未使用的图片资源 ==="

for img in "${UNUSED_IMAGES[@]}"
do
  if [ -f "$img" ]; then
    echo "删除: $img"
    rm "$img"
  else
    echo "文件不存在: $img"
  fi
done

echo "=== 清理完成 ===" 