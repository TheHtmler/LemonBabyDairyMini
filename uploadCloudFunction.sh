#!/bin/bash

# 云环境ID
envId="prod-7g5lap9xcf106dbf"

# 微信开发者工具CLI路径，根据实际安装路径调整
installPath="/Applications/wechat_devtools.app/Contents/MacOS/cli"
projectPath="/Users/randyhsu/Documents/Workspace/MyProjects/LemonBabyDairyMini"

# 上传所有云函数
echo "===== 开始上传云函数 ====="

# 获取所有云函数目录
cloud_functions=$(ls -d cloudfunctions/*/)

# 逐个上传云函数
for func_dir in $cloud_functions; do
  # 提取函数名称
  func_name=$(basename $func_dir)
  echo "正在上传云函数: $func_name"
  
  # 上传云函数
  ${installPath} cloud functions deploy --e ${envId} --n ${func_name} --r --project ${projectPath}
  
  echo "云函数 $func_name 上传完成"
  echo ""
done

echo "===== 所有云函数上传完成 ====="