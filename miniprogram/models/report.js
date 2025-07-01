// 报告数据模型
class ReportModel {
  // 报告类型枚举
  static REPORT_TYPES = {
    BLOOD_MS: 'blood_ms',        // 血串联质谱
    URINE_MS: 'urine_ms',        // 尿串联质谱
    BLOOD_GAS: 'blood_gas',      // 血气
    BLOOD_AMMONIA: 'blood_ammonia' // 血氨
  };

  // 血串联质谱指标配置
  static BLOOD_MS_INDICATORS = [
    { key: 'iso_leu', name: '异亮氨酸/亮氨酸', unit: 'μmol/L', abbr: 'Iso/Leu' },
    { key: 'met', name: '蛋氨酸/甲硫氨酸', unit: 'μmol/L', abbr: 'Met' },
    { key: 'val', name: '缬氨酸', unit: 'μmol/L', abbr: 'Val' },
    { key: 'thr', name: '苏氨酸', unit: 'μmol/L', abbr: 'Thr' },
    { key: 'c0', name: '游离肉碱', unit: 'μmol/L', abbr: 'C0' },
    { key: 'c2', name: '乙酰基肉碱', unit: 'μmol/L', abbr: 'C2' },
    { key: 'c3', name: '丙酰基肉碱', unit: 'μmol/L', abbr: 'C3' },
    { key: 'c3_c0', name: 'C3/C0', unit: '', abbr: 'C3/C0', isRatio: true },
    { key: 'c3_c2', name: 'C3/C2', unit: '', abbr: 'C3/C2', isRatio: true }
  ];

  // 尿串联质谱指标配置
  static URINE_MS_INDICATORS = [
    { key: 'methylmalonic_acid', name: '甲基丙二酸', unit: 'mmol/mol Cr', abbr: 'MMA' },
    { key: 'hydroxypropionic_acid', name: '3-羟基丙酸', unit: 'mmol/mol Cr', abbr: '3-HPA' },
    { key: 'hydroxybutyric_acid', name: '3-羟基丁酸', unit: 'mmol/mol Cr', abbr: '3-HBA' },
    { key: 'methylcitric_acid', name: '甲基枸橼酸', unit: 'mmol/mol Cr', abbr: 'MCA' }
  ];

  // 血气指标配置（待补充）
  static BLOOD_GAS_INDICATORS = [
    { key: 'ph', name: 'pH值', unit: '', abbr: 'pH' },
    { key: 'pco2', name: '二氧化碳分压', unit: 'mmHg', abbr: 'PCO2' },
    { key: 'po2', name: '氧分压', unit: 'mmHg', abbr: 'PO2' },
    { key: 'hco3', name: '碳酸氢根', unit: 'mmol/L', abbr: 'HCO3-' },
    { key: 'be', name: '剩余碱', unit: 'mmol/L', abbr: 'BE' }
  ];

  // 血氨指标配置（待补充）
  static BLOOD_AMMONIA_INDICATORS = [
    { key: 'ammonia', name: '血氨', unit: 'μmol/L', abbr: 'NH3' }
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
      case this.REPORT_TYPES.BLOOD_AMMONIA:
        return this.BLOOD_AMMONIA_INDICATORS;
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

  // 判断是否为氨基酸指标
  static isAminoAcidIndicator(indicatorKey) {
    return this.AMINO_ACID_INDICATORS.includes(indicatorKey);
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
      [this.REPORT_TYPES.BLOOD_AMMONIA]: '血氨检测'
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
  static calculateRatio(numerator, denominator, precision = 2) {
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
      if (!data) {
        errors.push(`缺少指标：${indicator.name}`);
        return;
      }

      if (!data.value || data.value.trim() === '') {
        errors.push(`${indicator.name} 的值不能为空`);
      }

      if (!indicator.isRatio && (!data.minRange || !data.maxRange)) {
        errors.push(`${indicator.name} 需要设置参考范围`);
      }
    });

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