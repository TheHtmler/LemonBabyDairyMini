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
      const {
        colors = ['#FFB800', '#4CAF50', '#2196F3'],
        title = '',
        yAxisLabel = '',
        showGrid = true,
        showLegend = true
      } = opts;
      
      console.log('绘制数据:', { xDataLength: xData.length, seriesCount: series.length });

      // 计算绘图区域
      const padding = { top: 40, right: 20, bottom: 60, left: 50 };
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
      
      series.forEach(s => {
        if (s.data && s.data.length > 0) {
          const validData = s.data.filter(v => !isNaN(v) && v !== null && v !== undefined && v !== 0);
          if (validData.length > 0) {
            const seriesMax = Math.max(...validData);
            const seriesMin = Math.min(...validData);
            if (seriesMax > maxValue) maxValue = seriesMax;
            if (seriesMin < minValue) minValue = seriesMin;
          }
        }
      });
      
      // 如果没有数据，设置默认值
      if (maxValue === 0) maxValue = 100;
      if (minValue === Infinity) minValue = 0;
      
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
      
      const yRange = yMax - yMin;
      const yScale = chartHeight / yRange;
      
      console.log('图表Y轴范围:', yMin, '-', yMax, '数据范围:', minValue.toFixed(2), '-', maxValue.toFixed(2));

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

      // 绘制X轴标签
      ctx.textAlign = 'center';
      const xStep = xData.length > 1 ? chartWidth / (xData.length - 1) : chartWidth / 2;
      xData.forEach((label, index) => {
        const x = padding.left + xStep * index;
        const y = padding.top + chartHeight + 20;
        
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
          // 确保Y坐标在图表范围内
          let y = padding.top + chartHeight - ((value - yMin) * yScale);
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
          // 确保Y坐标在图表范围内
          let y = padding.top + chartHeight - ((value - yMin) * yScale);
          y = Math.max(padding.top, Math.min(y, padding.top + chartHeight));

          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      // 绘制图例
      if (showLegend && series.length > 0) {
        const legendY = height - 20;
        let legendX = padding.left;
        
        series.forEach((s, index) => {
          const color = colors[index % colors.length];
          
          // 绘制图例色块
          ctx.fillStyle = color;
          ctx.fillRect(legendX, legendY - 6, 12, 12);
          
          // 绘制图例文字
          ctx.fillStyle = '#666';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(s.name || `系列${index + 1}`, legendX + 16, legendY + 4);
          
          legendX += ctx.measureText(s.name || `系列${index + 1}`).width + 30;
        });
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
      // 延迟隐藏tooltip，让用户能看清数据
      setTimeout(() => {
        this.setData({ tooltipVisible: false });
      }, 1000);
    },

    // 处理触摸事件
    handleTouch(e) {
      const chartInfo = this.data.chartInfo;
      if (!chartInfo) return;

      const touch = e.touches[0];
      const { padding, chartWidth, chartHeight, xData, series, colors, xStep, yMin, yScale } = chartInfo;
      
      // 计算触摸点在画布上的相对位置
      const query = this.createSelectorQuery();
      query.select(`#${this.data.canvasId}`)
        .boundingClientRect((rect) => {
          if (!rect) return;
          
          const touchX = touch.clientX - rect.left;
          const touchY = touch.clientY - rect.top;
          
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
          series.forEach((s, index) => {
            const value = s.data[dataIndex];
            if (value !== null && value !== undefined && !isNaN(value) && value !== 0) {
              values.push({
                name: s.name || `系列${index + 1}`,
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
          
          // 防止超出边界
          if (tooltipX + 180 > rect.width) {
            tooltipX = touchX - 190;
          }
          if (tooltipY < 10) {
            tooltipY = touchY + 10;
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
      const padding = { top: 40, right: 20, bottom: 60, left: 50 };
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
        series.forEach(s => {
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
        const y = padding.top + chartHeight + 20;
        
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
      if (showLegend && series.length > 0) {
        const legendY = height - 20;
        let legendX = padding.left;
        
        series.forEach((s, index) => {
          const color = colors[index % colors.length];
          
          // 绘制图例色块
          ctx.fillStyle = color;
          ctx.fillRect(legendX, legendY - 6, 12, 12);
          
          // 绘制图例文字
          ctx.fillStyle = '#666';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(s.name || `系列${index + 1}`, legendX + 16, legendY + 4);
          
          legendX += ctx.measureText(s.name || `系列${index + 1}`).width + 30;
        });
      }
    }
  }
});

