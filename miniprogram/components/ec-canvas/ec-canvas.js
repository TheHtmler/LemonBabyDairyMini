// components/ec-canvas/ec-canvas.js
// 简化的图表组件，用于绘制曲线图

Component({
  properties: {
    canvasId: {
      type: String,
      value: 'ec-canvas'
    },
    ec: {
      type: Object,
      value: {}
    },
    chartData: {
      type: Object,
      value: {}
    }
  },

  data: {
    isInit: false,
    tooltipVisible: false,
    tooltipX: 0,
    tooltipY: 0,
    tooltipData: {
      date: '',
      values: []
    },
    // 保存图表相关数据，用于交互
    chartInfo: null
  },

  lifetimes: {
    attached() {
      // 延迟初始化，确保页面已经完全加载
      setTimeout(() => {
        this.init();
      }, 300);
    }
  },

  observers: {
    'chartData': function(newData) {
      // 当图表数据更新时，重新绘制
      if (this.data.isInit && newData && newData.xData && newData.series) {
        this.drawChart(newData);
      }
    }
  },

  methods: {
    getSeriesName(series, index) {
      return series.name || `系列${index + 1}`;
    },

    isSeriesHidden(series, index) {
      const name = this.getSeriesName(series, index);
      return !!(this._hiddenSeries && this._hiddenSeries[name]);
    },

    toggleSeriesVisibility(name) {
      if (!this._hiddenSeries) this._hiddenSeries = {};
      this._hiddenSeries[name] = !this._hiddenSeries[name];
      if (this._lastChartData) {
        this.drawChart(this._lastChartData);
      }
    },

    clearLegendHitAreas() {
      this._legendAreas = [];
    },

    setLegendHitAreas(areas = []) {
      this._legendAreas = areas;
    },

    computeLegendLayout(series, colors, maxWidth, ctx, options = {}) {
      const font = options.legendFont || '10px sans-serif';
      const markerSize = options.legendMarkerSize || 12;
      const markerGap = options.legendMarkerGap || 6;
      const itemGap = options.legendItemGap || 12;
      const rowGap = options.legendRowGap || 6;
      const rowHeight = options.legendRowHeight || 16;
      const maxRows = options.legendMaxRows || 0;
      const ellipsis = options.legendEllipsis || '...';
      const truncateEnabled = options.legendTruncate !== false;
      ctx.font = font;

      const truncateText = (text, maxTextWidth) => {
        if (!maxTextWidth || maxTextWidth <= 0) return text;
        if (ctx.measureText(text).width <= maxTextWidth) return text;
        let trimmed = text;
        while (trimmed.length > 0 && ctx.measureText(trimmed + ellipsis).width > maxTextWidth) {
          trimmed = trimmed.slice(0, -1);
        }
        if (!trimmed) return text.slice(0, 1);
        return `${trimmed}${ellipsis}`;
      };

      if (maxRows === 1) {
        const items = [];
        let x = 0;
        if (truncateEnabled) {
          const maxItemWidth = Math.max(1, (maxWidth - itemGap * (series.length - 1)) / series.length);
          const maxTextWidth = Math.max(1, maxItemWidth - markerSize - markerGap);
          series.forEach((s, index) => {
            const name = this.getSeriesName(s, index);
            const label = truncateText(name, maxTextWidth);
            const textWidth = ctx.measureText(label).width;
            items.push({
              row: 0,
              x: index * (maxItemWidth + itemGap),
              width: markerSize + markerGap + textWidth,
              name,
              label,
              color: colors[index % colors.length],
              index
            });
          });
        } else {
          series.forEach((s, index) => {
            const name = this.getSeriesName(s, index);
            const label = name;
            const textWidth = ctx.measureText(label).width;
            const itemWidth = markerSize + markerGap + textWidth;
            items.push({
              row: 0,
              x,
              width: itemWidth,
              name,
              label,
              color: colors[index % colors.length],
              index
            });
            x += itemWidth + itemGap;
          });
        }
        return {
          rows: 1,
          totalHeight: rowHeight,
          items,
          rowHeight,
          rowGap,
          markerSize,
          markerGap,
          font
        };
      }

      let x = 0;
      let row = 0;
      const items = [];

      series.forEach((s, index) => {
        const name = this.getSeriesName(s, index);
        const textWidth = ctx.measureText(name).width;
        const itemWidth = markerSize + markerGap + textWidth;
        if (x > 0 && x + itemWidth > maxWidth) {
          row += 1;
          x = 0;
        }
        items.push({
          row,
          x,
          width: itemWidth,
          name,
          label: name,
          color: colors[index % colors.length],
          index
        });
        x += itemWidth + itemGap;
      });

      const rows = row + 1;
      const totalHeight = rows * rowHeight + (rows - 1) * rowGap;
      return {
        rows,
        totalHeight,
        items,
        rowHeight,
        rowGap,
        markerSize,
        markerGap,
        font
      };
    },

    isTouchOnLegend(touchX, touchY) {
      if (!this._legendAreas || this._legendAreas.length === 0) return null;
      return this._legendAreas.find(area =>
        touchX >= area.x &&
        touchX <= area.x + area.width &&
        touchY >= area.y &&
        touchY <= area.y + area.height
      );
    },
    init() {
      if (this.data.isInit) {
        return;
      }
      
      this.setData({ isInit: true });
      
      // 触发初始化事件，传递组件实例
      this.triggerEvent('init', {
        canvasId: this.data.canvasId,
        component: this
      });
      
      // 如果已经有数据，立即绘制
      if (this.data.chartData && this.data.chartData.xData) {
        this.drawChart(this.data.chartData);
      }
    },

    // 对外暴露的绘图方法
    drawChart(chartData) {
      if (!chartData || !chartData.xData || !chartData.series) {
        console.warn('图表数据不完整', chartData);
        return;
      }
      this._lastChartData = chartData;
      this.clearLegendHitAreas();
      
      // 根据图表类型选择绘制方法
      const options = chartData.options || {};
      if (options.chartType === 'stackedBar') {
        this.drawStackedBarChart(chartData, options);
      } else {
        this.drawLineChart(chartData, options);
      }
    },

    // 绘制折线图
    drawLineChart(data, options = {}) {
      const query = this.createSelectorQuery();
      query.select(`#${this.data.canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0]) {
            console.error('Canvas not found:', this.data.canvasId);
            return;
          }

          const canvas = res[0].node;
          if (!canvas) {
            console.error('Canvas node is null');
            return;
          }

          const ctx = canvas.getContext('2d');
          
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          const width = res[0].width;
          const height = res[0].height;
          
          console.log('绘制折线图:', this.data.canvasId, 'size:', width, 'x', height);
          
          // 清空画布
          ctx.clearRect(0, 0, width, height);
          
          // 绘制图表
          this._drawChart(ctx, width, height, data, options);
        });
    },

    // 绘制堆叠柱状图
    drawStackedBarChart(data, options = {}) {
      const query = this.createSelectorQuery();
      query.select(`#${this.data.canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0]) {
            console.error('Canvas not found:', this.data.canvasId);
            return;
          }

          const canvas = res[0].node;
          if (!canvas) {
            console.error('Canvas node is null');
            return;
          }

          const ctx = canvas.getContext('2d');
          
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          const width = res[0].width;
          const height = res[0].height;
          
          console.log('绘制堆叠柱状图:', this.data.canvasId, 'size:', width, 'x', height);
          
          // 清空画布
          ctx.clearRect(0, 0, width, height);
          
          // 绘制图表
          this._drawStackedBarChart(ctx, width, height, data, options);
        });
    },

    // 内部绘制方法
    _drawChart(ctx, width, height, data, options) {
      const xData = data.xData || [];
      const series = data.series || [];
      
      // 合并选项
      const opts = data.options || options || {};
      if (opts.layout === 'dualPanel') {
        this._drawDualPanelChart(ctx, width, height, data, opts);
        return;
      }
      const {
        colors = ['#FFB800', '#4CAF50', '#2196F3'],
        title = '',
        yAxisLabel = '',
        yAxisRightLabel = '',
        showGrid = true,
        showLegend = true,
        xAxisPosition = 'bottom',
        padding: customPadding
      } = opts;
      
      console.log('绘制数据:', { xDataLength: xData.length, seriesCount: series.length });

      // 计算绘图区域
      const basePadding = customPadding || { top: 40, right: 40, bottom: 60, left: 50 };
      let padding = { ...basePadding };
      const baseChartWidth = width - padding.left - padding.right;
      const xAxisLabelSpace = opts.xAxisLabelSpace ?? 18;
      const legendGap = opts.legendTopGap ?? 6;
      let legendLayout = null;

      if (showLegend && series.length > 0) {
        legendLayout = this.computeLegendLayout(series, colors, baseChartWidth, ctx, opts);
        const requiredBottom = xAxisLabelSpace + legendGap + legendLayout.totalHeight;
        if (padding.bottom < requiredBottom) {
          padding.bottom = requiredBottom;
        }
      } else if (padding.bottom < xAxisLabelSpace + 8) {
        padding.bottom = xAxisLabelSpace + 8;
      }

      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;

      // 绘制标题
      if (title) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#333';
        ctx.textAlign = 'left';
        ctx.fillText(title, padding.left, 20);
      }

      // 计算Y轴范围
      let maxValue = 0;
      let minValue = Infinity;
      let maxRightValue = 0;
      let minRightValue = Infinity;

      series.forEach((s, index) => {
        if (this.isSeriesHidden(s, index)) {
          return;
        }
        if (s.data && s.data.length > 0) {
          const validData = s.data.filter(v => !isNaN(v) && v !== null && v !== undefined && v !== 0);
          if (validData.length > 0) {
            const seriesMax = Math.max(...validData);
            const seriesMin = Math.min(...validData);
            if (s.yAxisIndex === 1) {
              if (seriesMax > maxRightValue) maxRightValue = seriesMax;
              if (seriesMin < minRightValue) minRightValue = seriesMin;
            } else {
              if (seriesMax > maxValue) maxValue = seriesMax;
              if (seriesMin < minValue) minValue = seriesMin;
            }
          }
        }
      });
      
      // 如果没有数据，设置默认值
      if (maxValue === 0) maxValue = 100;
      if (minValue === Infinity) minValue = 0;
      if (maxRightValue === 0) maxRightValue = maxValue;
      if (minRightValue === Infinity) minRightValue = minValue;
      
      // 使用自定义Y轴范围（如果提供）
      let yMax, yMin;
      if (opts.yAxisMax !== undefined) {
        yMax = opts.yAxisMax;
      } else {
        // 向上取整，确保有足够空间
        yMax = Math.ceil(maxValue * 1.25 / 10) * 10 || 100;
      }
      
      if (opts.yAxisMin !== undefined) {
        yMin = opts.yAxisMin;
      } else {
        // 从最小值向下取整开始，但不低于0
        yMin = Math.max(0, Math.floor(minValue / 10) * 10);
      }

      let yRightMax, yRightMin;
      if (opts.yAxisRightMax !== undefined) {
        yRightMax = opts.yAxisRightMax;
      } else {
        yRightMax = Math.ceil(maxRightValue * 1.25 / 10) * 10 || yMax;
      }

      if (opts.yAxisRightMin !== undefined) {
        yRightMin = opts.yAxisRightMin;
      } else {
        yRightMin = Math.max(0, Math.floor(minRightValue / 10) * 10);
      }
      
      const yRange = yMax - yMin;
      const yScale = chartHeight / yRange;
      const yRightRange = yRightMax - yRightMin;
      const yRightScale = chartHeight / yRightRange;
      
      console.log('图表Y轴范围:', yMin, '-', yMax, '数据范围:', minValue.toFixed(2), '-', maxValue.toFixed(2));
      console.log('图表右Y轴范围:', yRightMin, '-', yRightMax, '数据范围:', minRightValue.toFixed(2), '-', maxRightValue.toFixed(2));

      // 绘制网格
      if (showGrid) {
        ctx.strokeStyle = '#E0E0E0';
        ctx.lineWidth = 0.5;
        
        // 横向网格线
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
          const y = padding.top + (chartHeight / gridLines) * i;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + chartWidth, y);
          ctx.stroke();
        }
      }

      // 绘制Y轴标签
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'right';
      const gridLines = 5;
      for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartHeight / gridLines) * i;
        const value = yMax - (yRange / gridLines) * i;
        // 根据数值大小决定小数位数
        const displayValue = value < 10 ? value.toFixed(1) : Math.round(value);
        ctx.fillText(displayValue.toString(), padding.left - 10, y + 4);
      }

      // 左侧Y轴说明
      if (yAxisLabel) {
        ctx.textAlign = 'left';
        ctx.fillText(yAxisLabel, padding.left, padding.top - 10);
      }

      // 绘制右侧Y轴标签
      if (opts.yAxisRightMax !== undefined || yAxisRightLabel) {
        ctx.textAlign = 'left';
        for (let i = 0; i <= gridLines; i++) {
          const y = padding.top + (chartHeight / gridLines) * i;
          const value = yRightMax - (yRightRange / gridLines) * i;
          const displayValue = value < 10 ? value.toFixed(1) : Math.round(value);
          ctx.fillText(displayValue.toString(), padding.left + chartWidth + 10, y + 4);
        }
      }

      // 右侧Y轴说明
      if (yAxisRightLabel) {
        ctx.textAlign = 'right';
        ctx.fillText(yAxisRightLabel, padding.left + chartWidth, padding.top - 10);
      }

      // 绘制X轴标签
      ctx.textAlign = 'center';
      const xStep = xData.length > 1 ? chartWidth / (xData.length - 1) : chartWidth / 2;
      xData.forEach((label, index) => {
        const x = padding.left + xStep * index;
        const y = xAxisPosition === 'top' ? padding.top - 10 : padding.top + chartHeight + xAxisLabelSpace;
        
        // 根据数据点数量决定显示策略
        let shouldShow = true;
        if (xData.length > 10) {
          // 数据点多时，隔几个显示
          const step = Math.ceil(xData.length / 7);
          shouldShow = index % step === 0 || index === xData.length - 1;
        }
        
        if (shouldShow) {
          ctx.fillText(label || '', x, y);
        }
      });

      // 绘制数据线
      series.forEach((s, seriesIndex) => {
        if (this.isSeriesHidden(s, seriesIndex)) {
          return;
        }
        if (!s.data || s.data.length === 0) {
          return;
        }

        const color = colors[seriesIndex % colors.length];
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;

        // 绘制线条
        ctx.beginPath();
        let hasStarted = false;
        
        s.data.forEach((value, index) => {
          if (value === null || value === undefined || isNaN(value)) {
            return;
          }

          const x = padding.left + xStep * index;
          const isRightAxis = s.yAxisIndex === 1;
          const scale = isRightAxis ? yRightScale : yScale;
          const axisMin = isRightAxis ? yRightMin : yMin;
          // 确保Y坐标在图表范围内
          let y = padding.top + chartHeight - ((value - axisMin) * scale);
          y = Math.max(padding.top, Math.min(y, padding.top + chartHeight));

          if (!hasStarted) {
            ctx.moveTo(x, y);
            hasStarted = true;
          } else {
            ctx.lineTo(x, y);
          }
        });
        
        if (hasStarted) {
          ctx.stroke();
        }

        // 绘制数据点
        s.data.forEach((value, index) => {
          if (value === null || value === undefined || isNaN(value) || value === 0) {
            return;
          }

          const x = padding.left + xStep * index;
          const isRightAxis = s.yAxisIndex === 1;
          const scale = isRightAxis ? yRightScale : yScale;
          const axisMin = isRightAxis ? yRightMin : yMin;
          // 确保Y坐标在图表范围内
          let y = padding.top + chartHeight - ((value - axisMin) * scale);
          y = Math.max(padding.top, Math.min(y, padding.top + chartHeight));

          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      // 绘制图例
      if (showLegend && series.length > 0 && legendLayout) {
        const legendAreas = [];
        const legendTop = padding.top + chartHeight + xAxisLabelSpace + legendGap;
        const legendOffsetX = opts.legendOffsetX || 0;
        ctx.font = legendLayout.font;

        legendLayout.items.forEach((item) => {
          const name = item.name;
          const label = item.label || name;
          const hidden = this.isSeriesHidden(series[item.index], item.index);
          const x = padding.left + item.x + legendOffsetX;
          const y = legendTop + item.row * (legendLayout.rowHeight + legendLayout.rowGap) + legendLayout.rowHeight / 2;

          ctx.save();
          ctx.globalAlpha = hidden ? 0.35 : 1;
          ctx.fillStyle = item.color;
          ctx.fillRect(x, y - legendLayout.markerSize / 2, legendLayout.markerSize, legendLayout.markerSize);
          ctx.fillStyle = '#666';
          ctx.textAlign = 'left';
          ctx.fillText(label, x + legendLayout.markerSize + legendLayout.markerGap, y + 3);
          ctx.restore();

          legendAreas.push({
            x,
            y: y - legendLayout.rowHeight / 2,
            width: item.width + legendLayout.markerSize + legendLayout.markerGap,
            height: legendLayout.rowHeight,
            name
          });
        });

        this.setLegendHitAreas(legendAreas);
      }
      
      // 保存图表信息用于交互
      this.setData({
        chartInfo: {
          padding,
          chartWidth,
          chartHeight,
          xData,
          series,
          colors,
          xStep,
          yMin,
          yScale,
          yRightMin,
          yRightScale,
          layout: 'single',
          tooltipPlacement: opts.tooltipPlacement,
          tooltipWidth: opts.tooltipWidth,
          tooltipTopOffset: opts.tooltipTopOffset,
          width,
          height
        }
      });
    },

    _drawDualPanelChart(ctx, width, height, data, opts) {
      const xData = data.xData || [];
      const series = data.series || [];
      const {
        colors = ['#9BB7D4', '#3F88C5', '#1C3F66', '#7BBF6A'],
        title = '',
        showGrid = true,
        showLegend = true,
        padding: customPadding,
        panelGap = 24,
        plotHeightRatio,
        upperAxisPixelPerStep,
        lowerAxisPixelPerStep,
        rightAxisAlignMode = 'panel',
        upperAxisLabel = 'cm',
        lowerAxisLabel = 'kg',
        upperAxisRightLabel,
        lowerAxisRightLabel,
        upperAxisLeft,
        upperAxisRight,
        lowerAxisLeft,
        lowerAxisRight,
        showRightAxis = true,
        showTopAxis = true,
        showBottomAxis = true
      } = opts;

      const basePadding = customPadding || { top: 60, right: 50, bottom: 50, left: 50 };
      let padding = { ...basePadding };
      const xAxisLabelSpace = opts.xAxisLabelSpace ?? 18;
      const legendGap = opts.legendTopGap ?? 6;
      let legendLayout = null;

      if (showLegend && series.length > 0) {
        legendLayout = this.computeLegendLayout(
          series,
          colors,
          width - padding.left - padding.right,
          ctx,
          opts
        );
        const requiredBottom = xAxisLabelSpace + legendGap + legendLayout.totalHeight;
        if (padding.bottom < requiredBottom) {
          padding.bottom = requiredBottom;
        }
      } else if (padding.bottom < xAxisLabelSpace + 8) {
        padding.bottom = xAxisLabelSpace + 8;
      }

      const chartWidth = width - padding.left - padding.right;
      const availableHeight = height - padding.top - padding.bottom;
      let panelHeight = (availableHeight - panelGap) / 2;
      const panels = [
        {
          top: 0,
          height: panelHeight,
          label: upperAxisLabel,
          leftAxis: upperAxisLeft || {},
          rightAxis: upperAxisRight || {}
        },
        {
          top: 0,
          height: panelHeight,
          label: lowerAxisLabel,
          leftAxis: lowerAxisLeft || {},
          rightAxis: lowerAxisRight || {}
        }
      ];

      function panelHeightFromStep(panel, pixelPerStep) {
        if (!panel.leftAxis.step) return panel.height;
        const steps = panel.leftAxis.range / panel.leftAxis.step;
        return steps * pixelPerStep;
      }

      if (title) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#333';
        ctx.textAlign = 'left';
        ctx.fillText(title, padding.left, 20);
      }

      const seriesByPanel = [[], []];
      series.forEach((s) => {
        const index = s.panelIndex === 1 ? 1 : 0;
        seriesByPanel[index].push(s);
      });

      panels.forEach((panel, panelIndex) => {
        let maxValue = 0;
        let minValue = Infinity;
      seriesByPanel[panelIndex].forEach((s) => {
        const globalIndex = series.indexOf(s);
        if (this.isSeriesHidden(s, globalIndex)) return;
        if (!s.data || s.data.length === 0) return;
        const validData = s.data.filter(v => !isNaN(v) && v !== null && v !== undefined && v !== 0);
        if (validData.length === 0) return;
          const seriesMax = Math.max(...validData);
          const seriesMin = Math.min(...validData);
          if (seriesMax > maxValue) maxValue = seriesMax;
          if (seriesMin < minValue) minValue = seriesMin;
        });
        if (maxValue === 0) maxValue = 100;
        if (minValue === Infinity) minValue = 0;

        if (panel.leftAxis.min === undefined) {
          panel.leftAxis.min = Math.max(0, Math.floor(minValue / 5) * 5);
        }
        if (panel.leftAxis.max === undefined) {
          panel.leftAxis.max = Math.ceil(maxValue * 1.2 / 5) * 5 || maxValue;
        }
        if (panel.rightAxis.min === undefined) {
          panel.rightAxis.min = panel.leftAxis.min;
        }
        if (panel.rightAxis.max === undefined) {
          panel.rightAxis.max = panel.leftAxis.max;
        }

        panel.leftAxis.range = panel.leftAxis.max - panel.leftAxis.min;
        panel.rightAxis.range = panel.rightAxis.max - panel.rightAxis.min;
      });

      const stepHeightTop = upperAxisPixelPerStep
        ? (panelHeightFromStep(panels[0], upperAxisPixelPerStep))
        : null;
      const stepHeightBottom = lowerAxisPixelPerStep
        ? (panelHeightFromStep(panels[1], lowerAxisPixelPerStep))
        : null;

      if (stepHeightTop !== null || stepHeightBottom !== null) {
        const desiredHeights = [
          stepHeightTop !== null ? stepHeightTop : panelHeight,
          stepHeightBottom !== null ? stepHeightBottom : panelHeight
        ];
        const totalDesired = desiredHeights[0] + desiredHeights[1] + panelGap;
        let scaleFactor = 1;
        if (totalDesired > availableHeight) {
          scaleFactor = availableHeight / totalDesired;
        }
        panels[0].height = desiredHeights[0] * scaleFactor;
        panels[1].height = desiredHeights[1] * scaleFactor;
      } else if (plotHeightRatio) {
        const targetPlotHeight = Math.min(availableHeight, chartWidth * plotHeightRatio);
        panels[0].height = (targetPlotHeight - panelGap) / 2;
        panels[1].height = (targetPlotHeight - panelGap) / 2;
      } else {
        panels[0].height = panelHeight;
        panels[1].height = panelHeight;
      }

      const totalPlotHeight = panels[0].height + panels[1].height + panelGap;
      const plotTop = padding.top + (availableHeight - totalPlotHeight) / 2;
      panels[0].top = plotTop;
      panels[1].top = plotTop + panels[0].height + panelGap;

      panels.forEach((panel) => {
        panel.leftAxis.scale = panel.height / panel.leftAxis.range;
        panel.rightAxis.scale = panel.height / panel.rightAxis.range;
      });

      const xStep = xData.length > 1 ? chartWidth / (xData.length - 1) : chartWidth / 2;

      if (showGrid) {
        ctx.strokeStyle = '#E0E0E0';
        ctx.lineWidth = 0.5;
        const gridLines = 5;
        panels.forEach((panel) => {
          for (let i = 0; i <= gridLines; i++) {
            const y = panel.top + (panel.height / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
          }
        });
      }

      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#666';
      panels.forEach((panel, panelIndex) => {
        const leftTicks = [];
        const rightTicks = [];
        if (panel.leftAxis.step) {
          for (let v = panel.leftAxis.min; v <= panel.leftAxis.max + 0.0001; v += panel.leftAxis.step) {
            leftTicks.push(v);
          }
        } else {
          const gridLines = 5;
          for (let i = 0; i <= gridLines; i++) {
            leftTicks.push(panel.leftAxis.max - (panel.leftAxis.range / gridLines) * i);
          }
        }
        if (panel.rightAxis.step) {
          for (let v = panel.rightAxis.min; v <= panel.rightAxis.max + 0.0001; v += panel.rightAxis.step) {
            rightTicks.push(v);
          }
        } else {
          const gridLines = 5;
          for (let i = 0; i <= gridLines; i++) {
            rightTicks.push(panel.rightAxis.max - (panel.rightAxis.range / gridLines) * i);
          }
        }

        ctx.textAlign = 'right';
        leftTicks.forEach((value) => {
          const minLabel = panel.leftAxis.labelMin !== undefined ? panel.leftAxis.labelMin : -Infinity;
          const maxLabel = panel.leftAxis.labelMax !== undefined ? panel.leftAxis.labelMax : Infinity;
          const every = panel.leftAxis.labelEvery;
          const start = panel.leftAxis.labelStart || 0;
          const inRange = value >= minLabel && value <= maxLabel;
          const shouldLabel = every
            ? (inRange && Math.abs((value - start) % every) < 0.0001)
            : inRange;
          if (!shouldLabel) return;
          const y = panel.top + panel.height - ((value - panel.leftAxis.min) * panel.leftAxis.scale);
          const displayValue = value < 10 ? value.toFixed(1) : Math.round(value);
          ctx.fillText(displayValue.toString(), padding.left - 10, y + 4);
        });

        if (showRightAxis) {
          ctx.textAlign = 'left';
          rightTicks.forEach((value) => {
            const rounded = Math.round(value * 10) / 10;
            const minLabel = panel.rightAxis.labelMin !== undefined ? panel.rightAxis.labelMin : -Infinity;
            const maxLabel = panel.rightAxis.labelMax !== undefined ? panel.rightAxis.labelMax : Infinity;
            const every = panel.rightAxis.labelEvery;
            const start = panel.rightAxis.labelStart || 0;
            const inRange = rounded >= minLabel && rounded <= maxLabel;
            const shouldLabel = every
              ? (inRange && Math.abs((rounded - start) % every) < 0.0001)
              : inRange;
            if (!shouldLabel) return;
            const y = panel.top + panel.height - ((value - panel.rightAxis.min) * panel.rightAxis.scale);
            const displayValue = rounded < 10 ? rounded.toFixed(1) : Math.round(rounded);
            ctx.fillText(displayValue.toString(), padding.left + chartWidth + 10, y + 4);
          });
        }

        // Axis labels for each panel
        const leftLabel = panelIndex === 0 ? upperAxisLabel : lowerAxisLabel;
        const rightLabel = panelIndex === 0
          ? (upperAxisRightLabel || upperAxisLabel)
          : (lowerAxisRightLabel || lowerAxisLabel);
        if (leftLabel) {
          ctx.textAlign = 'left';
          ctx.fillText(leftLabel, padding.left, panel.top + 12);
        }
        if (showRightAxis && rightLabel) {
          ctx.textAlign = 'right';
          ctx.fillText(rightLabel, padding.left + chartWidth, panel.top + 12);
        }
      });

      ctx.textAlign = 'center';
      if (showTopAxis) {
        xData.forEach((label, index) => {
          const x = padding.left + xStep * index;
          const y = plotTop - 14;
          let shouldShow = true;
          if (xData.length > 10) {
            const step = Math.ceil(xData.length / 7);
            shouldShow = index % step === 0 || index === xData.length - 1;
          }
          if (shouldShow) {
            ctx.fillText(label || '', x, y);
          }
        });
      }
      if (showBottomAxis) {
        xData.forEach((label, index) => {
          const x = padding.left + xStep * index;
          const y = plotTop + panelHeight * 2 + panelGap + xAxisLabelSpace;
          let shouldShow = true;
          if (xData.length > 10) {
            const step = Math.ceil(xData.length / 7);
            shouldShow = index % step === 0 || index === xData.length - 1;
          }
          if (shouldShow) {
            ctx.fillText(label || '', x, y);
          }
        });
      }

      series.forEach((s, seriesIndex) => {
        if (this.isSeriesHidden(s, seriesIndex)) return;
        if (!s.data || s.data.length === 0) return;
        const panelIndex = s.panelIndex === 1 ? 1 : 0;
        const panel = panels[panelIndex];
        const useRightAxis = s.axisSide === 'right';
        const axis = useRightAxis ? panel.rightAxis : panel.leftAxis;
        const color = colors[seriesIndex % colors.length];
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        let hasStarted = false;
        s.data.forEach((value, index) => {
          if (value === null || value === undefined || isNaN(value)) return;
          const x = padding.left + xStep * index;
          let y = panel.top + panel.height - ((value - axis.min) * axis.scale);
          y = Math.max(panel.top, Math.min(y, panel.top + panel.height));
          if (!hasStarted) {
            ctx.moveTo(x, y);
            hasStarted = true;
          } else {
            ctx.lineTo(x, y);
          }
        });
        if (hasStarted) {
          ctx.stroke();
        }

        // Dual panel style uses clean curves without point markers.
      });

      if (showLegend && series.length > 0 && legendLayout) {
        const legendAreas = [];
        const legendTop = plotTop + panelHeight * 2 + panelGap + xAxisLabelSpace + legendGap;
        const legendOffsetX = opts.legendOffsetX || 0;
        ctx.font = legendLayout.font;
        legendLayout.items.forEach((item) => {
          const name = item.name;
          const label = item.label || name;
          const hidden = this.isSeriesHidden(series[item.index], item.index);
          const x = padding.left + item.x + legendOffsetX;
          const y = legendTop + item.row * (legendLayout.rowHeight + legendLayout.rowGap) + legendLayout.rowHeight / 2;
          ctx.save();
          ctx.globalAlpha = hidden ? 0.35 : 1;
          ctx.fillStyle = item.color;
          ctx.fillRect(x, y - legendLayout.markerSize / 2, legendLayout.markerSize, legendLayout.markerSize);
          ctx.fillStyle = '#666';
          ctx.textAlign = 'left';
          ctx.fillText(label, x + legendLayout.markerSize + legendLayout.markerGap, y + 3);
          ctx.restore();
          legendAreas.push({
            x,
            y: y - legendLayout.rowHeight / 2,
            width: item.width + legendLayout.markerSize + legendLayout.markerGap,
            height: legendLayout.rowHeight,
            name
          });
        });
        this.setLegendHitAreas(legendAreas);
      }

      this.setData({
        chartInfo: {
          padding,
          chartWidth,
          chartHeight: panelHeight * 2 + panelGap,
          xData,
          series,
          colors,
          xStep,
          panels,
          layout: 'dualPanel',
          tooltipPlacement: opts.tooltipPlacement,
          tooltipWidth: opts.tooltipWidth,
          tooltipTopOffset: opts.tooltipTopOffset,
          width,
          height
        }
      });
    },

    // 触摸开始
    onTouchStart(e) {
      this.handleTouch(e);
    },

    // 触摸移动
    onTouchMove(e) {
      this.handleTouch(e);
    },

    // 触摸结束
  onTouchEnd(e) {
      const touch = e.changedTouches && e.changedTouches[0];
      if (touch) {
        const query = this.createSelectorQuery();
        query.select(`#${this.data.canvasId}`)
          .boundingClientRect((rect) => {
            if (!rect) return;
            const touchX = touch.clientX - rect.left;
            const touchY = touch.clientY - rect.top;
            const legendHit = this.isTouchOnLegend(touchX, touchY);
            if (legendHit) {
              this.setData({ tooltipVisible: false });
              this.toggleSeriesVisibility(legendHit.name);
              return;
            }
            // 延迟隐藏tooltip，让用户能看清数据
            setTimeout(() => {
              this.setData({ tooltipVisible: false });
            }, 1000);
          })
          .exec();
        return;
      }

      setTimeout(() => {
        this.setData({ tooltipVisible: false });
      }, 1000);
    },

    // 处理触摸事件
    handleTouch(e) {
      const chartInfo = this.data.chartInfo;
      if (!chartInfo) return;

      const touch = e.touches[0];
      const {
        padding,
        chartWidth,
        chartHeight,
        xData,
        series,
        colors,
        xStep,
        yMin,
        yScale,
        layout,
        panels,
        tooltipPlacement,
        tooltipWidth = 180,
        tooltipTopOffset = 8
      } = chartInfo;
      
      // 计算触摸点在画布上的相对位置
      const query = this.createSelectorQuery();
      query.select(`#${this.data.canvasId}`)
        .boundingClientRect((rect) => {
          if (!rect) return;
          
          const touchX = touch.clientX - rect.left;
          const touchY = touch.clientY - rect.top;
          
          const legendHit = this.isTouchOnLegend(touchX, touchY);
          if (legendHit) {
            this.setData({ tooltipVisible: false });
            return;
          }

          // 检查是否在图表区域内
          if (touchX < padding.left || touchX > padding.left + chartWidth ||
              touchY < padding.top || touchY > padding.top + chartHeight) {
            this.setData({ tooltipVisible: false });
            return;
          }
          
          // 计算最近的数据点索引
          const relativeX = touchX - padding.left;
          const dataIndex = Math.round(relativeX / xStep);
          
          if (dataIndex < 0 || dataIndex >= xData.length) {
            return;
          }
          
          // 收集该数据点的所有系列值
          const values = [];
          let activePanelIndex = 0;
          if (layout === 'dualPanel' && Array.isArray(panels)) {
            const panelHit = panels.findIndex(panel =>
              touchY >= panel.top && touchY <= panel.top + panel.height
            );
            activePanelIndex = panelHit === -1 ? 0 : panelHit;
          }
          series.forEach((s, index) => {
            if (this.isSeriesHidden(s, index)) {
              return;
            }
            const panelIndex = s.panelIndex === 1 ? 1 : 0;
            if (layout === 'dualPanel' && panelIndex !== activePanelIndex) {
              return;
            }
            const value = s.data[dataIndex];
            if (value !== null && value !== undefined && !isNaN(value) && value !== 0) {
              values.push({
                name: this.getSeriesName(s, index),
                value: value,
                color: colors[index % colors.length]
              });
            }
          });
          
          if (values.length === 0) {
            this.setData({ tooltipVisible: false });
            return;
          }
          
          // 计算tooltip位置
          let tooltipX = touchX + 10;
          let tooltipY = touchY - 60;

          if (tooltipPlacement === 'top') {
            tooltipX = touchX - tooltipWidth / 2;
            tooltipY = padding.top + tooltipTopOffset;
          }
          
          // 防止超出边界
          if (tooltipX + tooltipWidth > rect.width) {
            tooltipX = rect.width - tooltipWidth - 6;
          }
          if (tooltipX < 6) {
            tooltipX = 6;
          }
          if (tooltipPlacement !== 'top' && tooltipY < 10) {
            tooltipY = touchY + 10;
          }
          if (tooltipPlacement === 'top' && tooltipY < 6) {
            tooltipY = 6;
          }
          
          // 显示tooltip
          this.setData({
            tooltipVisible: true,
            tooltipX: tooltipX,
            tooltipY: tooltipY,
            tooltipData: {
              date: xData[dataIndex],
              values: values
            }
          });
        })
        .exec();
    },

    // 绘制堆叠柱状图
    _drawStackedBarChart(ctx, width, height, data, options) {
      const xData = data.xData || [];
      const series = data.series || [];
      
      // 合并选项
      const opts = data.options || options || {};
      const {
        colors = ['#4CAF50', '#2196F3'],
        title = '',
        showGrid = true,
        showLegend = true
      } = opts;
      
      console.log('绘制堆叠柱状图:', { xDataLength: xData.length, seriesCount: series.length });

      // 计算绘图区域
      const basePadding = { top: 40, right: 20, bottom: 60, left: 50 };
      let padding = { ...basePadding };
      const baseChartWidth = width - padding.left - padding.right;
      const xAxisLabelSpace = opts.xAxisLabelSpace ?? 18;
      const legendGap = opts.legendTopGap ?? 6;
      let legendLayout = null;
      if (showLegend && series.length > 0) {
        legendLayout = this.computeLegendLayout(series, colors, baseChartWidth, ctx, opts);
        const requiredBottom = xAxisLabelSpace + legendGap + legendLayout.totalHeight;
        if (padding.bottom < requiredBottom) {
          padding.bottom = requiredBottom;
        }
      } else if (padding.bottom < xAxisLabelSpace + 8) {
        padding.bottom = xAxisLabelSpace + 8;
      }
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;

      // 绘制标题
      if (title) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#333';
        ctx.textAlign = 'left';
        ctx.fillText(title, padding.left, 20);
      }

      // 计算Y轴范围（堆叠总和）
      let maxValue = 0;
      xData.forEach((_, index) => {
        let stackSum = 0;
        series.forEach((s, seriesIndex) => {
          if (this.isSeriesHidden(s, seriesIndex)) {
            return;
          }
          if (s.data && s.data[index] !== null && s.data[index] !== undefined && !isNaN(s.data[index])) {
            stackSum += parseFloat(s.data[index]);
          }
        });
        if (stackSum > maxValue) maxValue = stackSum;
      });
      
      // 如果没有数据，设置默认最大值
      if (maxValue === 0) maxValue = 5;
      
      const yMax = Math.ceil(maxValue * 1.2 / 1) * 1 || 5;
      const yScale = chartHeight / yMax;

      // 绘制网格
      if (showGrid) {
        ctx.strokeStyle = '#E0E0E0';
        ctx.lineWidth = 0.5;
        
        // 横向网格线
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
          const y = padding.top + (chartHeight / gridLines) * i;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + chartWidth, y);
          ctx.stroke();
        }
      }

      // 绘制Y轴标签
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'right';
      const gridLines = 5;
      for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartHeight / gridLines) * i;
        const value = (yMax - (yMax / gridLines) * i).toFixed(1);
        ctx.fillText(value, padding.left - 10, y + 4);
      }

      // 计算柱子宽度
      const barWidth = Math.min(chartWidth / xData.length * 0.6, 30);
      const barGap = chartWidth / xData.length;

      // 绘制X轴标签
      ctx.textAlign = 'center';
      xData.forEach((label, index) => {
        const x = padding.left + barGap * index + barGap / 2;
        const y = padding.top + chartHeight + xAxisLabelSpace;
        
        // 根据数据点数量决定显示策略
        let shouldShow = true;
        if (xData.length > 10) {
          const step = Math.ceil(xData.length / 7);
          shouldShow = index % step === 0 || index === xData.length - 1;
        }
        
        if (shouldShow) {
          ctx.fillText(label || '', x, y);
        }
      });

      // 绘制堆叠柱状图
      xData.forEach((label, index) => {
        const x = padding.left + barGap * index + (barGap - barWidth) / 2;
        let stackY = padding.top + chartHeight; // 从底部开始堆叠
        
        // 从下往上绘制每个系列
        series.forEach((s, seriesIndex) => {
          if (this.isSeriesHidden(s, seriesIndex)) {
            return;
          }
          if (!s.data || !s.data[index]) return;
          
          const value = parseFloat(s.data[index]);
          if (isNaN(value) || value === 0) return;
          
          const barHeight = value * yScale;
          const color = colors[seriesIndex % colors.length];
          
          // 绘制柱子
          ctx.fillStyle = color;
          ctx.fillRect(x, stackY - barHeight, barWidth, barHeight);
          
          // 绘制柱子边框
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, stackY - barHeight, barWidth, barHeight);
          
          // 绘制数值标签（只在柱子高度足够时显示）
          if (barHeight > 15) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(value.toFixed(1), x + barWidth / 2, stackY - barHeight / 2 + 3);
          }
          
          stackY -= barHeight; // 向上堆叠
        });
      });

      // 绘制图例
      if (showLegend && series.length > 0 && legendLayout) {
        const legendAreas = [];
        const legendTop = padding.top + chartHeight + xAxisLabelSpace + legendGap;
        const legendOffsetX = opts.legendOffsetX || 0;
        ctx.font = legendLayout.font;

        legendLayout.items.forEach((item) => {
          const name = item.name;
          const label = item.label || name;
          const hidden = this.isSeriesHidden(series[item.index], item.index);
          const x = padding.left + item.x + legendOffsetX;
          const y = legendTop + item.row * (legendLayout.rowHeight + legendLayout.rowGap) + legendLayout.rowHeight / 2;

          ctx.save();
          ctx.globalAlpha = hidden ? 0.35 : 1;
          ctx.fillStyle = item.color;
          ctx.fillRect(x, y - legendLayout.markerSize / 2, legendLayout.markerSize, legendLayout.markerSize);
          ctx.fillStyle = '#666';
          ctx.textAlign = 'left';
          ctx.fillText(label, x + legendLayout.markerSize + legendLayout.markerGap, y + 3);
          ctx.restore();

          legendAreas.push({
            x,
            y: y - legendLayout.rowHeight / 2,
            width: item.width + legendLayout.markerSize + legendLayout.markerGap,
            height: legendLayout.rowHeight,
            name
          });
        });

        this.setLegendHitAreas(legendAreas);
      }
    }
  }
});
