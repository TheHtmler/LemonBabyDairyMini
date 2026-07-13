// 报告数据模型
class ReportModel {
  // 报告类型枚举
  static REPORT_TYPES = {
    BLOOD_MS: 'blood_ms',        // 血串联质谱
    URINE_MS: 'urine_ms',        // 尿串联质谱
    BLOOD_GAS: 'blood_gas',      // 血气
    BLOOD_CBC: 'blood_cbc',      // 血常规
    BLOOD_AMMONIA: 'blood_ammonia', // 血氨
    BLOOD_BIOCHEM: 'blood_biochem'  // 大生化
  };

  // 血串联质谱指标配置
  static BLOOD_MS_INDICATORS = [
    { key: 'arginine', name: '精氨酸', unit: '', abbr: 'Arg' },
    { key: 'iso_leu', name: '异亮氨酸/亮氨酸', unit: '', abbr: 'Iso/Leu' },
    { key: 'met', name: '蛋氨酸/甲硫氨酸', unit: '', abbr: 'Met' },
    { key: 'val', name: '缬氨酸', unit: '', abbr: 'Val' },
    { key: 'thr', name: '苏氨酸', unit: '', abbr: 'Thr', optional: true },
    { key: 'c0', name: '游离肉碱', unit: '', abbr: 'C0' },
    { key: 'c2', name: '乙酰基肉碱', unit: '', abbr: 'C2' },
    { key: 'c3', name: '丙酰基肉碱', unit: '', abbr: 'C3' },
    { key: 'c3_c0', name: 'C3/C0', unit: '', abbr: 'C3/C0', isRatio: true, allowRangeInput: true },
    { key: 'c3_c2', name: 'C3/C2', unit: '', abbr: 'C3/C2', isRatio: true, allowRangeInput: true }
  ];

  // 尿串联质谱指标配置
  static URINE_MS_INDICATORS = [
    { key: 'methylmalonic_acid', name: '甲基丙二酸', unit: '', abbr: 'MMA' },
    { key: 'hydroxypropionic_acid', name: '3-羟基丙酸', unit: '', abbr: '3-HPA' },
    { key: 'hydroxybutyric_acid', name: '3-羟基丁酸', unit: '', abbr: '3-HBA' },
    { key: 'methylcitric_acid_1', name: '甲基枸橼酸(1)', unit: '', abbr: 'MCA(1)' },
    { key: 'methylcitric_acid_2', name: '甲基枸橼酸(2)', unit: '', abbr: 'MCA(2)', optional: true },
    { key: 'lactate', name: '乳酸', unit: '', abbr: 'Lac' }
  ];

  // 血气指标：仅 pH / HCO3- / BE(B) 必填，其余按报告单上有则填
  static BLOOD_GAS_INDICATORS = [
    { key: 'ph', name: 'pH值', unit: '', abbr: 'pH' },
    { key: 'hco3', name: '标准碳酸氢根', unit: '', abbr: 'HCO3std' },
    { key: 'be', name: '剩余碱 BE(B)', unit: '', abbr: 'BE(B)' },
    { key: 'pco2', name: '二氧化碳分压', unit: '', abbr: 'pCO2', optional: true },
    { key: 'po2', name: '氧分压', unit: '', abbr: 'pO2', optional: true },
    { key: 'beecf', name: '细胞外液剩余碱', unit: '', abbr: 'BEecf', optional: true },
    { key: 'lactate', name: '乳酸', unit: '', abbr: 'Lac', optional: true },
    { key: 'glucose', name: '葡萄糖', unit: '', abbr: 'Glu', optional: true },
    { key: 'sodium', name: '钠', unit: '', abbr: 'Na+', optional: true },
    { key: 'potassium', name: '钾', unit: '', abbr: 'K+', optional: true },
    { key: 'chloride', name: '氯', unit: '', abbr: 'Cl-', optional: true },
    { key: 'calcium', name: '离子钙', unit: '', abbr: 'Ca++', optional: true },
    { key: 'hct', name: '红细胞压积', unit: '', abbr: 'Hct', optional: true },
    { key: 'cthb', name: '总血红蛋白', unit: '', abbr: 'ctHb', optional: true }
  ];

  // 血常规：仅血红蛋白、血小板必填
  static BLOOD_CBC_INDICATORS = [
    { key: 'hgb', name: '血红蛋白', unit: '', abbr: 'HGB' },
    { key: 'plt', name: '血小板', unit: '', abbr: 'PLT' },
    { key: 'wbc', name: '白细胞', unit: '', abbr: 'WBC', optional: true },
    { key: 'neut_abs', name: '中性粒细胞绝对值', unit: '', abbr: 'NEUT#', optional: true },
    { key: 'neut_pct', name: '中性粒细胞百分比', unit: '', abbr: 'NEUT%', optional: true },
    { key: 'hct', name: '红细胞压积', unit: '', abbr: 'Hct', optional: true },
    { key: 'lym_pct', name: '淋巴细胞百分比', unit: '', abbr: 'LYM%', optional: true },
    { key: 'mcv', name: '平均红细胞体积', unit: '', abbr: 'MCV', optional: true }
  ];

  // 血氨指标配置（待补充）
  static BLOOD_AMMONIA_INDICATORS = [
    { key: 'ammonia', name: '血氨', unit: '', abbr: 'NH3' }
  ];

  // 大生化指标配置：全部可选，至少填写一项
  static BLOOD_BIOCHEM_INDICATORS = [
    { key: 'tp', name: '总蛋白', unit: 'g/L', abbr: 'TP', optional: true },
    { key: 'alb', name: '白蛋白', unit: 'g/L', abbr: 'ALB', optional: true },
    { key: 'alt', name: '丙氨酸氨基转移酶', unit: 'U/L', abbr: 'ALT', optional: true },
    { key: 'ast', name: '天门冬氨酸氨基转移酶', unit: 'U/L', abbr: 'AST', optional: true },
    { key: 'alp', name: '碱性磷酸酶', unit: 'U/L', abbr: 'ALP', optional: true },
    { key: 'ggt', name: '谷氨酰转肽酶', unit: 'U/L', abbr: 'GGT', optional: true },
    { key: 'dbil', name: '直接胆红素', unit: 'μmol/L', abbr: 'DBil', optional: true },
    { key: 'tbil', name: '总胆红素', unit: 'μmol/L', abbr: 'TBil', optional: true },
    { key: 'crea', name: '肌酐', unit: 'μmol/L', abbr: 'CREA', optional: true },
    { key: 'tba', name: '总胆汁酸', unit: 'μmol/L', abbr: 'TBA', optional: true },
    { key: 'ua', name: '尿酸', unit: 'μmol/L', abbr: 'UA', optional: true },
    { key: 'tc', name: '总胆固醇', unit: 'mmol/L', abbr: 'TC', optional: true },
    { key: 'tg', name: '甘油三酯', unit: 'mmol/L', abbr: 'TG', optional: true },
    { key: 'ldl', name: '低密度脂蛋白', unit: 'mmol/L', abbr: 'LDL', optional: true },
    { key: 'hdl', name: '高密度脂蛋白', unit: 'mmol/L', abbr: 'HDL', optional: true },
    { key: 'glu', name: '空腹血糖', unit: 'mmol/L', abbr: 'Glu', optional: true },
    { key: 'bun', name: '尿素氮', unit: 'mmol/L', abbr: 'BUN', optional: true },
    { key: 'egfr', name: '肾小球滤过率', unit: 'ml/min', abbr: 'eGFR', optional: true },
    { key: 'cysc', name: '胱抑素C', unit: 'mg/L', abbr: 'CysC', optional: true },
    { key: 'na', name: '钠', unit: 'mmol/L', abbr: 'Na', optional: true },
    { key: 'k', name: '钾', unit: 'mmol/L', abbr: 'K', optional: true },
    { key: 'mg', name: '镁', unit: 'mmol/L', abbr: 'Mg', optional: true },
    { key: 'ca', name: '钙', unit: 'mmol/L', abbr: 'Ca', optional: true },
    { key: 'cl', name: '氯', unit: 'mmol/L', abbr: 'Cl', optional: true },
    { key: 'ck', name: '肌酸激酶', unit: 'U/L', abbr: 'CK', optional: true },
    { key: 'ck_mb', name: '肌酸激酶同工酶', unit: 'U/L', abbr: 'CK-MB', optional: true },
    { key: 'ctni', name: '肌钙蛋白', unit: 'ng/mL', abbr: 'cTnI', optional: true },
    { key: 'co2', name: '二氧化碳', unit: 'mmol/L', abbr: 'CO₂', optional: true }
  ];

  // 获取指标配置
  static getIndicators(reportType) {
    switch (reportType) {
      case this.REPORT_TYPES.BLOOD_MS:
        return this.BLOOD_MS_INDICATORS;
      case this.REPORT_TYPES.URINE_MS:
        return this.URINE_MS_INDICATORS;
      case this.REPORT_TYPES.BLOOD_GAS:
        return this.BLOOD_GAS_INDICATORS;
      case this.REPORT_TYPES.BLOOD_CBC:
        return this.BLOOD_CBC_INDICATORS;
      case this.REPORT_TYPES.BLOOD_AMMONIA:
        return this.BLOOD_AMMONIA_INDICATORS;
      case this.REPORT_TYPES.BLOOD_BIOCHEM:
        return this.BLOOD_BIOCHEM_INDICATORS;
      default:
        return [];
    }
  }

  // 计算指标状态（正常/偏高/偏低）
  static calculateIndicatorStatus(value, minRange, maxRange) {
    const numValue = parseFloat(value);
    const numMin = parseFloat(minRange);
    const numMax = parseFloat(maxRange);

    if (isNaN(numValue) || isNaN(numMin) || isNaN(numMax)) {
      return 'unknown';
    }

    if (numValue < numMin) {
      return 'low';
    } else if (numValue > numMax) {
      return 'high';
    } else {
      return 'normal';
    }
  }

  // 计算最优参考范围（针对氨基酸指标）
  static calculateOptimalRange(minRange, maxRange) {
    const numMin = parseFloat(minRange);
    const numMax = parseFloat(maxRange);
    
    if (isNaN(numMin) || isNaN(numMax)) {
      return null;
    }

    const optimalMax = numMin + (numMax - numMin) * 0.25;
    return {
      min: numMin,
      max: parseFloat(optimalMax.toFixed(2))
    };
  }

  // 氨基酸指标列表（用于计算最优范围）
  static AMINO_ACID_INDICATORS = ['iso_leu', 'met', 'val', 'thr'];

  // 展示时优先使用简写的指标
  static ABBR_DISPLAY_INDICATORS = ['c0', 'c2', 'c3'];

  // 判断是否为氨基酸指标
  static isAminoAcidIndicator(indicatorKey) {
    return this.AMINO_ACID_INDICATORS.includes(indicatorKey);
  }

  // 获取指标展示名
  static getIndicatorDisplayName(indicatorConfig = {}) {
    if (!indicatorConfig) return '';
    if (this.ABBR_DISPLAY_INDICATORS.includes(indicatorConfig.key)) {
      return indicatorConfig.abbr || indicatorConfig.name || indicatorConfig.key;
    }
    return indicatorConfig.name || indicatorConfig.abbr || indicatorConfig.key;
  }

  // 生成报告数据结构
  static createReportData(babyUid, reportDate, reportType, indicators) {
    return {
      babyUid: babyUid,
      reportId: this.generateReportId(),
      reportDate: reportDate,
      reportType: reportType,
      indicators: indicators,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  // 生成报告ID
  static generateReportId() {
    return 'RPT' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
  }

  // 获取报告类型中文名称
  static getReportTypeName(reportType) {
    const typeNames = {
      [this.REPORT_TYPES.BLOOD_MS]: '血串联质谱',
      [this.REPORT_TYPES.URINE_MS]: '尿串联质谱',
      [this.REPORT_TYPES.BLOOD_GAS]: '血气分析',
      [this.REPORT_TYPES.BLOOD_CBC]: '血常规',
      [this.REPORT_TYPES.BLOOD_AMMONIA]: '血氨检测',
      [this.REPORT_TYPES.BLOOD_BIOCHEM]: '大生化'
    };
    return typeNames[reportType] || '未知报告';
  }

  // 获取指标状态的显示文本和颜色
  static getStatusDisplay(status) {
    const statusMap = {
      normal: { text: '正常', color: '#4CAF50', icon: '✓' },
      high: { text: '偏高', color: '#F44336', icon: '↑' },
      low: { text: '偏低', color: '#FF9800', icon: '↓' },
      unknown: { text: '未知', color: '#999', icon: '?' }
    };
    return statusMap[status] || statusMap.unknown;
  }

  // 计算比值指标（如C3/C0, C3/C2）
  static calculateRatio(numerator, denominator, precision = 3) {
    const num = parseFloat(numerator);
    const den = parseFloat(denominator);
    
    if (isNaN(num) || isNaN(den) || den === 0) {
      return null;
    }
    
    return parseFloat((num / den).toFixed(precision));
  }

  // 验证报告数据完整性
  static validateReportData(reportType, indicators) {
    const requiredIndicators = this.getIndicators(reportType);
    const errors = [];

    requiredIndicators.forEach(indicator => {
      const data = indicators[indicator.key];
      
      // 如果是可选指标且没有数据，跳过验证
      if (indicator.optional && (!data || (!data.value || data.value.trim() === ''))) {
        return;
      }
      
      if (!data) {
        errors.push(`缺少指标：${indicator.name}`);
        return;
      }

      if (!data.value || data.value.trim() === '') {
        errors.push(`${indicator.name} 的值不能为空`);
      }

      if (!indicator.isRatio || indicator.allowRangeInput) {
        const missingRange = !data.minRange || !data.maxRange;
        if (missingRange && !indicator.optional) {
          errors.push(`${indicator.name} 需要设置参考范围`);
        }
      }
    });

    if (reportType === this.REPORT_TYPES.BLOOD_BIOCHEM) {
      const hasAnyValue = requiredIndicators.some((indicator) => {
        const data = indicators[indicator.key];
        return data && data.value && String(data.value).trim() !== '';
      });
      if (!hasAnyValue) {
        errors.push('请至少填写一项大生化指标');
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  // 格式化日期
  static formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 格式化日期时间
  static formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // 获取报告摘要信息
  static getReportSummary(reportData) {
    if (!reportData || !reportData.indicators) {
      return { normalCount: 0, abnormalCount: 0, totalCount: 0 };
    }

    const indicators = Object.values(reportData.indicators);
    const totalCount = indicators.length;
    let normalCount = 0;
    let abnormalCount = 0;

    indicators.forEach(indicator => {
      if (indicator.status === 'normal') {
        normalCount++;
      } else if (indicator.status === 'high' || indicator.status === 'low') {
        abnormalCount++;
      }
    });

    return {
      normalCount,
      abnormalCount,
      totalCount,
      normalRate: totalCount > 0 ? Math.round((normalCount / totalCount) * 100) : 0
    };
  }
}

module.exports = ReportModel; 
