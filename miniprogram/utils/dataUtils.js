/**
 * 通用数据处理工具函数
 * 用于数据转换、存储、同步等功能
 */

const dataUtils = {
  // 本地存储工具
  storage: {
    // 设置本地存储
    set(key, value) {
      try {
        wx.setStorageSync(key, value);
        return true;
      } catch (error) {
        console.error('设置本地存储失败:', error);
        return false;
      }
    },

    // 获取本地存储
    get(key, defaultValue = null) {
      try {
        const value = wx.getStorageSync(key);
        return value !== '' ? value : defaultValue;
      } catch (error) {
        console.error('获取本地存储失败:', error);
        return defaultValue;
      }
    },

    // 删除本地存储
    remove(key) {
      try {
        wx.removeStorageSync(key);
        return true;
      } catch (error) {
        console.error('删除本地存储失败:', error);
        return false;
      }
    },

    // 清空本地存储
    clear() {
      try {
        wx.clearStorageSync();
        return true;
      } catch (error) {
        console.error('清空本地存储失败:', error);
        return false;
      }
    }
  },

  // 数组处理工具
  array: {
    // 按指定字段排序
    sortBy(arr, field, order = 'asc') {
      return [...arr].sort((a, b) => {
        const aValue = a[field];
        const bValue = b[field];
        
        if (order === 'desc') {
          return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
        } else {
          return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
        }
      });
    },

    // 按时间排序（支持时间字符串和Date对象）
    sortByTime(arr, timeField, order = 'desc') {
      return [...arr].sort((a, b) => {
        let timeA = a[timeField];
        let timeB = b[timeField];
        
        // 如果是时间字符串 HH:MM，转换为分钟数比较
        if (typeof timeA === 'string' && timeA.includes(':')) {
          const [hoursA, minutesA] = timeA.split(':').map(Number);
          timeA = hoursA * 60 + minutesA;
        } else if (timeA instanceof Date) {
          timeA = timeA.getTime();
        }
        
        if (typeof timeB === 'string' && timeB.includes(':')) {
          const [hoursB, minutesB] = timeB.split(':').map(Number);
          timeB = hoursB * 60 + minutesB;
        } else if (timeB instanceof Date) {
          timeB = timeB.getTime();
        }
        
        return order === 'desc' ? timeB - timeA : timeA - timeB;
      });
    },

    // 数组分组
    groupBy(arr, field) {
      return arr.reduce((groups, item) => {
        const key = item[field];
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(item);
        return groups;
      }, {});
    },

    // 数组去重
    unique(arr, field = null) {
      if (field) {
        const seen = new Set();
        return arr.filter(item => {
          const key = item[field];
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      } else {
        return [...new Set(arr)];
      }
    }
  },

  // 对象处理工具
  object: {
    // 深拷贝
    deepClone(obj) {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }
      
      if (obj instanceof Date) {
        return new Date(obj.getTime());
      }
      
      if (obj instanceof Array) {
        return obj.map(item => this.deepClone(item));
      }
      
      const cloned = {};
      for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    },

    // 对象合并
    merge(target, ...sources) {
      sources.forEach(source => {
        if (source) {
          Object.keys(source).forEach(key => {
            if (source[key] !== undefined) {
              target[key] = source[key];
            }
          });
        }
      });
      return target;
    },

    // 获取嵌套属性值
    get(obj, path, defaultValue = undefined) {
      const keys = path.split('.');
      let result = obj;
      
      for (let key of keys) {
        if (result === null || result === undefined) {
          return defaultValue;
        }
        result = result[key];
      }
      
      return result !== undefined ? result : defaultValue;
    },

    // 设置嵌套属性值
    set(obj, path, value) {
      const keys = path.split('.');
      const lastKey = keys.pop();
      let current = obj;
      
      for (let key of keys) {
        if (!(key in current) || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key];
      }
      
      current[lastKey] = value;
      return obj;
    }
  },

  // 时间处理工具
  time: {
    // 获取今天的开始时间（00:00:00）
    getTodayStart() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today;
    },

    // 获取今天的结束时间（23:59:59）
    getTodayEnd() {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return today;
    },

    // 计算两个时间之间的分钟差
    getMinutesDiff(startTime, endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      return Math.floor((end - start) / (1000 * 60));
    },

    // 格式化持续时间
    formatDuration(minutes) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    },

    // 检查是否为同一天
    isSameDay(date1, date2) {
      const d1 = new Date(date1);
      const d2 = new Date(date2);
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate();
    }
  },

  // 数据转换工具
  convert: {
    // 字符串转数字
    toNumber(str, defaultValue = 0) {
      const num = parseFloat(str);
      return isNaN(num) ? defaultValue : num;
    },

    // 数字转字符串（保留指定小数位）
    toString(num, decimals = 0) {
      if (num === null || num === undefined || isNaN(num)) {
        return '0';
      }
      return Number(num).toFixed(decimals);
    },

    // 布尔值转换
    toBoolean(value) {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
      }
      return Boolean(value);
    }
  },

  // 数据验证工具
  validate: {
    // 验证必填字段
    required(value, fieldName = '字段') {
      if (value === null || value === undefined || value === '') {
        throw new Error(`${fieldName}不能为空`);
      }
      return true;
    },

    // 验证数字范围
    numberRange(value, min, max, fieldName = '数值') {
      const num = parseFloat(value);
      if (isNaN(num)) {
        throw new Error(`${fieldName}必须是有效数字`);
      }
      if (num < min || num > max) {
        throw new Error(`${fieldName}必须在${min}到${max}之间`);
      }
      return true;
    },

    // 验证数组长度
    arrayLength(arr, min, max, fieldName = '数组') {
      if (!Array.isArray(arr)) {
        throw new Error(`${fieldName}必须是数组`);
      }
      if (arr.length < min || arr.length > max) {
        throw new Error(`${fieldName}长度必须在${min}到${max}之间`);
      }
      return true;
    }
  },

  // 数据验证工具
  validation: {
    // 统一的数据验证方法
    validateData(data, rules) {
      for (const field in rules) {
        const value = data[field];
        const rule = rules[field];
        
        if (rule.required && (!value || value.toString().trim() === '')) {
          wx.showToast({
            title: rule.message || `请输入${field}`,
            icon: 'none'
          });
          return false;
        }
        
        if (rule.type === 'number' && value) {
          const num = parseFloat(value);
          if (isNaN(num) || (rule.min !== undefined && num < rule.min)) {
            wx.showToast({
              title: rule.message || `${field}格式不正确`,
              icon: 'none'
            });
            return false;
          }
        }
      }
      return true;
    },
    
    // ... existing code ...
    
    // 必填验证
    required(value, fieldName = '字段') {
      if (value === null || value === undefined || value === '') {
        throw new Error(`${fieldName}不能为空`);
      }
      return true;
    }
  }
};

module.exports = dataUtils; 