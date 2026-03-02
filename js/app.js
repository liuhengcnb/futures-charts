// 全局配置
const CONFIG = {
    dataPath: 'data/',
    charts: {
        kline: null,
        volume: null,
        oi: null,
        position: null,
        iv: null,
        cb: null
    },
    currentData: null,
    currentContract: null
};

// 颜色配置
const COLORS = {
    up: '#ef5350',      // 上涨红色
    down: '#26a69a',    // 下跌绿色
    ma20: '#ffa726',    // MA20橙色
    volume: '#78909c',  // 成交量灰色
    oi: '#42a5f5',      // 持仓量蓝色
    oiChange: '#ef5350', // 持仓量变幅红色
    homie: '#ec407a',   // 家人粉色
    inst: '#ab47bc',    // 机构紫色
    iv: '#42a5f5',      // IV蓝色
    ivPct: '#66bb6a',   // IV分位数绿色
    cb: '#8d6e63'       // 期限结构棕色
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initContractSelect();
    initEventListeners();
    initCharts();
    
    // 选择第一个品种
    const select = document.getElementById('contract-select');
    if (select.options.length > 0) {
        select.selectedIndex = 0;
        await loadChartData(select.value);
    }
});

/**
 * 初始化品种选择器
 */
async function initContractSelect() {
    const select = document.getElementById('contract-select');
    select.innerHTML = '<option value="">加载中...</option>';
    
    try {
        // 获取所有CSV文件列表
        const response = await fetch(CONFIG.dataPath + 'manifest.json');
        let files = [];
        
        if (response.ok) {
            files = await response.json();
        } else {
            // 如果没有manifest，尝试从根目录获取
            console.log('manifest.json not found');
            select.innerHTML = '<option value="">未找到数据文件</option>';
            return;
        }
        
        // 清空并添加选项
        select.innerHTML = '';
        files.forEach(file => {
            const option = document.createElement('option');
            option.value = file.filename;
            option.textContent = file.display_name;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('加载品种列表失败:', error);
        select.innerHTML = '<option value="">加载失败</option>';
    }
}

/**
 * 初始化事件监听器
 */
function initEventListeners() {
    // 品种选择变化
    document.getElementById('contract-select').addEventListener('change', async (e) => {
        if (e.target.value) {
            await loadChartData(e.target.value);
        }
    });
    
    // 更新图表按钮
    document.getElementById('update-btn').addEventListener('click', async () => {
        const select = document.getElementById('contract-select');
        if (select.value) {
            await loadChartData(select.value);
        }
    });
    
    // 重置日期按钮
    document.getElementById('reset-btn').addEventListener('click', () => {
        document.getElementById('start-date').value = '';
        document.getElementById('end-date').value = '';
        const select = document.getElementById('contract-select');
        if (select.value) {
            loadChartData(select.value);
        }
    });
}

/**
 * 初始化图表实例
 */
function initCharts() {
    CONFIG.charts.kline = echarts.init(document.getElementById('chart-kline'));
    CONFIG.charts.volume = echarts.init(document.getElementById('chart-volume'));
    CONFIG.charts.oi = echarts.init(document.getElementById('chart-oi'));
    CONFIG.charts.position = echarts.init(document.getElementById('chart-position'));
    CONFIG.charts.iv = echarts.init(document.getElementById('chart-iv'));
    CONFIG.charts.cb = echarts.init(document.getElementById('chart-cb'));
    
    // 响应窗口大小变化
    window.addEventListener('resize', () => {
        Object.values(CONFIG.charts).forEach(chart => {
            if (chart) chart.resize();
        });
    });
    
    // 图表联动
    setupChartLinkage();
}

/**
 * 设置图表联动
 */
function setupChartLinkage() {
    const charts = Object.values(CONFIG.charts);
    
    charts.forEach(chart => {
        chart.on('datazoom', (params) => {
            // 同步所有图表的缩放
            charts.forEach(otherChart => {
                if (otherChart !== chart) {
                    otherChart.dispatchAction({
                        type: 'dataZoom',
                        dataZoomIndex: params.dataZoomIndex,
                        start: params.start,
                        end: params.end
                    });
                }
            });
        });
    });
}

/**
 * 加载图表数据
 */
async function loadChartData(filename) {
    showLoading();
    
    try {
        // 加载CSV数据
        const response = await fetch(CONFIG.dataPath + filename);
        const text = await response.text();
        const rawData = CSVParser.parse(text);
        
        if (rawData.length === 0) {
            throw new Error('数据为空');
        }
        
        CONFIG.currentData = rawData;
        CONFIG.currentContract = filename;
        
        // 处理日期范围
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        let filteredData = rawData;
        
        if (startDate || endDate) {
            filteredData = rawData.filter(row => {
                const rowDate = row[''] || row['日期'] || row['date'];
                if (!rowDate) return true;
                
                let dateStr;
                if (typeof rowDate === 'number') {
                    dateStr = rowDate.toString();
                } else {
                    dateStr = rowDate;
                }
                
                // 格式化为 YYYY-MM-DD
                let formattedDate;
                if (dateStr.length === 8) {
                    formattedDate = `${dateStr.substr(0, 4)}-${dateStr.substr(4, 2)}-${dateStr.substr(6, 2)}`;
                } else {
                    formattedDate = dateStr.split(' ')[0];
                }
                
                if (startDate && formattedDate < startDate) return false;
                if (endDate && formattedDate > endDate) return false;
                return true;
            });
        }
        
        // 更新日期选择器范围
        updateDateRange(rawData);
        
        // 处理数据
        const chartData = processChartData(filteredData);
        
        // 绘制图表
        drawKlineChart(chartData);
        drawVolumeChart(chartData);
        drawOIChart(chartData);
        drawPositionChart(chartData);
        drawIVChart(chartData);
        drawCBChart(chartData);
        
        // 更新统计面板
        updateStatsPanel(chartData);
        
    } catch (error) {
        console.error('加载图表数据失败:', error);
        showError('加载数据失败: ' + error.message);
    }
}

/**
 * 处理图表数据
 */
function processChartData(rawData) {
    const dates = [];
    const ohlc = [];
    const volumes = [];
    const oi = [];
    const oiChange = [];
    const homieNet = [];
    const instNet = [];
    const iv = [];
    const ivPct = [];
    const cb = [];
    const ma20 = [];
    
    rawData.forEach(row => {
        // 日期
        let dateStr = row[''] || row['日期'] || row['date'];
        if (typeof dateStr === 'number') {
            dateStr = dateStr.toString();
            dateStr = `${dateStr.substr(0, 4)}-${dateStr.substr(4, 2)}-${dateStr.substr(6, 2)}`;
        } else if (dateStr) {
            dateStr = dateStr.split(' ')[0];
        }
        dates.push(dateStr);
        
        // OHLC
        ohlc.push([
            row['开盘价'] || row['open'],
            row['收盘价'] || row['close'],
            row['最低价'] || row['low'],
            row['最高价'] || row['high']
        ]);
        
        // MA20
        ma20.push(row['ma20'] || row['MA20']);
        
        // 成交量
        volumes.push(row['成交量'] || row['volume'] || row['vol']);
        
        // 持仓量和变幅
        oi.push(row['持仓量'] || row['oi']);
        oiChange.push((row['持仓量变幅'] || 0) * 100); // 转为百分比
        
        // 家人和机构净持仓
        const homieLong = row['家人多头持仓量'] || 0;
        const homieShort = row['家人空头持仓量'] || 0;
        homieNet.push(homieLong + homieShort);
        
        const instLong = row['机构多头持仓量'] || 0;
        const instShort = row['机构空头持仓量'] || 0;
        instNet.push(instLong + instShort);
        
        // IV
        iv.push(row['IV']);
        ivPct.push((row['IV_pct'] || 0) * 100); // 转为百分比
        
        // 期限结构
        cb.push(row['CB_index']);
    });
    
    return {
        dates,
        ohlc,
        volumes,
        oi,
        oiChange,
        homieNet,
        instNet,
        iv,
        ivPct,
        cb,
        ma20
    };
}

/**
 * 绘制K线图
 */
function drawKlineChart(data) {
    const option = {
        title: {
            text: '价格走势 (主图)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'bold' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: function(params) {
                let result = `<div style="font-weight:bold;margin-bottom:5px;">${params[0].axisValue}</div>`;
                params.forEach(param => {
                    if (param.seriesName === 'K线') {
                        const values = param.data;
                        result += `<div>开盘: ${values[1].toFixed(2)}</div>`;
                        result += `<div>收盘: <span style="color:${values[1] <= values[2] ? COLORS.up : COLORS.down}">${values[2].toFixed(2)}</span></div>`;
                        result += `<div>最低: ${values[3].toFixed(2)}</div>`;
                        result += `<div>最高: ${values[4].toFixed(2)}</div>`;
                    } else if (param.seriesName === 'MA20') {
                        result += `<div>MA20: ${param.data?.toFixed(2) || '-'}</div>`;
                    }
                });
                return result;
            }
        },
        legend: {
            data: ['K线', 'MA20'],
            top: 30
        },
        grid: {
            left: '10%',
            right: '5%',
            top: 80,
            bottom: 80
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            axisLabel: { rotate: 45 }
        },
        yAxis: {
            type: 'value',
            scale: true,
            splitArea: { show: true }
        },
        dataZoom: [
            { type: 'inside', start: 50, end: 100 },
            { type: 'slider', start: 50, end: 100, height: 30 }
        ],
        series: [
            {
                name: 'K线',
                type: 'candlestick',
                data: data.ohlc,
                itemStyle: {
                    color: COLORS.up,
                    color0: COLORS.down,
                    borderColor: COLORS.up,
                    borderColor0: COLORS.down
                }
            },
            {
                name: 'MA20',
                type: 'line',
                data: data.ma20,
                smooth: true,
                lineStyle: { width: 2, color: COLORS.ma20 },
                symbol: 'none'
            }
        ]
    };
    
    CONFIG.charts.kline.setOption(option, true);
}

/**
 * 绘制成交量图
 */
function drawVolumeChart(data) {
    const option = {
        title: {
            text: '成交量',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                return `<div style="font-weight:bold;">${params[0].axisValue}</div>
                        <div>成交量: ${formatNumber(params[0].data)}</div>`;
            }
        },
        grid: {
            left: '10%',
            right: '5%',
            top: 50,
            bottom: 30
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            axisLabel: { show: false }
        },
        yAxis: {
            type: 'value',
            splitArea: { show: true },
            axisLabel: {
                formatter: value => formatNumber(value)
            }
        },
        series: [{
            name: '成交量',
            type: 'bar',
            data: data.volumes,
            itemStyle: { color: COLORS.volume }
        }]
    };
    
    CONFIG.charts.volume.setOption(option, true);
}

/**
 * 绘制持仓量图
 */
function drawOIChart(data) {
    const option = {
        title: {
            text: '持仓量 & 持仓量变幅',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = `<div style="font-weight:bold;">${params[0].axisValue}</div>`;
                params.forEach(param => {
                    if (param.seriesName === '持仓量') {
                        result += `<div>持仓量: ${formatNumber(param.data)}</div>`;
                    } else if (param.seriesName === '持仓量变幅') {
                        result += `<div>变幅: ${param.data?.toFixed(2) || '-'}%</div>`;
                    }
                });
                return result;
            }
        },
        legend: {
            data: ['持仓量', '持仓量变幅'],
            top: 25
        },
        grid: {
            left: '10%',
            right: '15%',
            top: 60,
            bottom: 30
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            axisLabel: { show: false }
        },
        yAxis: [
            {
                type: 'value',
                name: '持仓量',
                position: 'left',
                splitArea: { show: true },
                axisLabel: {
                    formatter: value => formatNumber(value)
                }
            },
            {
                type: 'value',
                name: '变幅(%)',
                position: 'right',
                axisLabel: {
                    formatter: '{value}%'
                }
            }
        ],
        series: [
            {
                name: '持仓量',
                type: 'bar',
                data: data.oi,
                itemStyle: { color: COLORS.oi }
            },
            {
                name: '持仓量变幅',
                type: 'line',
                yAxisIndex: 1,
                data: data.oiChange,
                lineStyle: { color: COLORS.oiChange, width: 2 },
                symbol: 'circle',
                symbolSize: 4
            }
        ]
    };
    
    CONFIG.charts.oi.setOption(option, true);
}

/**
 * 绘制持仓分析图
 */
function drawPositionChart(data) {
    const option = {
        title: {
            text: '家人 & 机构净持仓',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = `<div style="font-weight:bold;">${params[0].axisValue}</div>`;
                params.forEach(param => {
                    result += `<div>${param.seriesName}: ${formatNumber(param.data)}</div>`;
                });
                return result;
            }
        },
        legend: {
            data: ['家人净持仓', '机构净持仓'],
            top: 25
        },
        grid: {
            left: '10%',
            right: '5%',
            top: 60,
            bottom: 30
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            axisLabel: { show: false }
        },
        yAxis: {
            type: 'value',
            splitArea: { show: true },
            axisLabel: {
                formatter: value => formatNumber(value)
            }
        },
        series: [
            {
                name: '家人净持仓',
                type: 'line',
                data: data.homieNet,
                lineStyle: { color: COLORS.homie, width: 2 },
                symbol: 'circle',
                symbolSize: 4,
                areaStyle: { 
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(236, 64, 122, 0.3)' },
                            { offset: 1, color: 'rgba(236, 64, 122, 0.05)' }
                        ]
                    }
                }
            },
            {
                name: '机构净持仓',
                type: 'line',
                data: data.instNet,
                lineStyle: { color: COLORS.inst, width: 2 },
                symbol: 'circle',
                symbolSize: 4,
                areaStyle: { 
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(171, 71, 188, 0.3)' },
                            { offset: 1, color: 'rgba(171, 71, 188, 0.05)' }
                        ]
                    }
                }
            }
        ]
    };
    
    CONFIG.charts.position.setOption(option, true);
}

/**
 * 绘制IV图
 */
function drawIVChart(data) {
    const option = {
        title: {
            text: '隐含波动率 (IV)',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = `<div style="font-weight:bold;">${params[0].axisValue}</div>`;
                params.forEach(param => {
                    if (param.seriesName === 'IV') {
                        result += `<div>IV: ${param.data?.toFixed(2) || '-'}</div>`;
                    } else if (param.seriesName === 'IV60日分位数') {
                        result += `<div>分位数: ${param.data?.toFixed(2) || '-'}%</div>`;
                    }
                });
                return result;
            }
        },
        legend: {
            data: ['IV', 'IV60日分位数'],
            top: 25
        },
        grid: {
            left: '10%',
            right: '15%',
            top: 60,
            bottom: 30
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            axisLabel: { show: false }
        },
        yAxis: [
            {
                type: 'value',
                name: 'IV',
                position: 'left',
                splitArea: { show: true }
            },
            {
                type: 'value',
                name: '分位数(%)',
                position: 'right',
                min: 0,
                max: 100,
                axisLabel: { formatter: '{value}%' }
            }
        ],
        series: [
            {
                name: 'IV',
                type: 'line',
                data: data.iv,
                lineStyle: { color: COLORS.iv, width: 2 },
                symbol: 'circle',
                symbolSize: 4
            },
            {
                name: 'IV60日分位数',
                type: 'line',
                yAxisIndex: 1,
                data: data.ivPct,
                lineStyle: { color: COLORS.ivPct, width: 2, type: 'dashed' },
                symbol: 'circle',
                symbolSize: 4
            }
        ]
    };
    
    CONFIG.charts.iv.setOption(option, true);
}

/**
 * 绘制期限结构图
 */
function drawCBChart(data) {
    const option = {
        title: {
            text: '期限结构分数',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                return `<div style="font-weight:bold;">${params[0].axisValue}</div>
                        <div>期限结构: ${params[0].data?.toFixed(2) || '-'}</div>`;
            }
        },
        grid: {
            left: '10%',
            right: '5%',
            top: 50,
            bottom: 30
        },
        xAxis: {
            type: 'category',
            data: data.dates,
            axisLabel: { show: false }
        },
        yAxis: {
            type: 'value',
            splitArea: { show: true }
        },
        series: [{
            name: '期限结构',
            type: 'line',
            data: data.cb,
            lineStyle: { color: COLORS.cb, width: 2 },
            symbol: 'circle',
            symbolSize: 4,
            areaStyle: { 
                color: {
                    type: 'linear',
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: 'rgba(141, 110, 99, 0.3)' },
                        { offset: 1, color: 'rgba(141, 110, 99, 0.05)' }
                    ]
                }
            },
            markLine: {
                silent: true,
                data: [{ yAxis: 0 }],
                lineStyle: { color: '#999', type: 'dashed' }
            }
        }]
    };
    
    CONFIG.charts.cb.setOption(option, true);
}

/**
 * 更新统计面板
 */
function updateStatsPanel(data) {
    const lastIdx = data.dates.length - 1;
    const prevIdx = lastIdx - 1;
    
    const lastClose = data.ohlc[lastIdx]?.[2] || 0;
    const prevClose = data.ohlc[prevIdx]?.[2] || lastClose;
    const change = lastClose - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;
    
    const stats = [
        {
            label: '最新收盘价',
            value: lastClose.toFixed(2),
            className: change >= 0 ? 'positive' : 'negative'
        },
        {
            label: '涨跌幅',
            value: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
            className: changePct >= 0 ? 'positive' : 'negative'
        },
        {
            label: '最新成交量',
            value: formatNumber(data.volumes[lastIdx])
        },
        {
            label: '最新持仓量',
            value: formatNumber(data.oi[lastIdx])
        },
        {
            label: '家人净持仓',
            value: formatNumber(data.homieNet[lastIdx]),
            className: data.homieNet[lastIdx] >= 0 ? 'positive' : 'negative'
        },
        {
            label: '机构净持仓',
            value: formatNumber(data.instNet[lastIdx]),
            className: data.instNet[lastIdx] >= 0 ? 'positive' : 'negative'
        },
        {
            label: 'IV',
            value: data.iv[lastIdx]?.toFixed(2) || '-'
        },
        {
            label: '期限结构',
            value: data.cb[lastIdx]?.toFixed(2) || '-',
            className: data.cb[lastIdx] >= 0 ? 'positive' : 'negative'
        }
    ];
    
    const panel = document.getElementById('stats-panel');
    panel.innerHTML = stats.map(stat => `
        <div class="stat-item">
            <div class="stat-label">${stat.label}</div>
            <div class="stat-value ${stat.className || ''}">${stat.value}</div>
        </div>
    `).join('');
}

/**
 * 更新日期范围
 */
function updateDateRange(data) {
    if (data.length === 0) return;
    
    const firstDate = data[0][''] || data[0]['日期'] || data[0]['date'];
    const lastDate = data[data.length - 1][''] || data[data.length - 1]['日期'] || data[data.length - 1]['date'];
    
    let firstDateStr, lastDateStr;
    
    if (typeof firstDate === 'number') {
        const str = firstDate.toString();
        firstDateStr = `${str.substr(0, 4)}-${str.substr(4, 2)}-${str.substr(6, 2)}`;
    } else {
        firstDateStr = firstDate?.split(' ')[0] || '';
    }
    
    if (typeof lastDate === 'number') {
        const str = lastDate.toString();
        lastDateStr = `${str.substr(0, 4)}-${str.substr(4, 2)}-${str.substr(6, 2)}`;
    } else {
        lastDateStr = lastDate?.split(' ')[0] || '';
    }
    
    const startInput = document.getElementById('start-date');
    const endInput = document.getElementById('end-date');
    
    startInput.min = firstDateStr;
    startInput.max = lastDateStr;
    endInput.min = firstDateStr;
    endInput.max = lastDateStr;
}

/**
 * 显示加载状态
 */
function showLoading() {
    const container = document.getElementById('charts-container');
    container.innerHTML = '<div class="loading">加载中...</div>';
}

/**
 * 显示错误信息
 */
function showError(message) {
    const container = document.getElementById('charts-container');
    container.innerHTML = `<div class="loading" style="color: #dc3545;">${message}</div>`;
}

/**
 * 格式化数字
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '-';
    
    const absNum = Math.abs(num);
    if (absNum >= 100000000) {
        return (num / 100000000).toFixed(2) + '亿';
    } else if (absNum >= 10000) {
        return (num / 10000).toFixed(2) + '万';
    } else {
        return num.toFixed(2);
    }
}