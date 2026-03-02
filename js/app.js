// js/app.js

// ==================== 全局配置 ====================
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
    currentContract: null,
    // 统一的网格布局配置，确保所有图表左右对齐
  grid: {
        left: '8%',    // 统一左侧边距
        right: '8%',   // 统一右侧边距（为右侧Y轴预留空间）
        top: '15%',
        bottom: '10%'
    }
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

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    await initContractSelect();
    initEventListeners();
    initCharts();
    
    // 初始化图表联动
    setupChartLinkage();
    
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
        const response = await fetch(CONFIG.dataPath + 'manifest.json');
        if (!response.ok) throw new Error('未找到manifest.json');
        
        const files = await response.json();
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
    document.getElementById('contract-select').addEventListener('change', async (e) => {
        if (e.target.value) await loadChartData(e.target.value);
    });
    
    document.getElementById('update-btn').addEventListener('click', async () => {
        const select = document.getElementById('contract-select');
        if (select.value) await loadChartData(select.value);
    });
    
    document.getElementById('reset-btn').addEventListener('click', () => {
        document.getElementById('start-date').value = '';
        document.getElementById('end-date').value = '';
        const select = document.getElementById('contract-select');
        if (select.value) loadChartData(select.value);
    });
}

/**
 * 初始化图表实例
 */
function initCharts() {
    CONFIG.charts.kline    = echarts.init(document.getElementById('chart-kline'));
    CONFIG.charts.volume   = echarts.init(document.getElementById('chart-volume'));
    CONFIG.charts.oi       = echarts.init(document.getElementById('chart-oi'));
    CONFIG.charts.position = echarts.init(document.getElementById('chart-position'));
    CONFIG.charts.iv       = echarts.init(document.getElementById('chart-iv'));
    CONFIG.charts.cb       = echarts.init(document.getElementById('chart-cb'));

    window.addEventListener('resize', () => {
        Object.values(CONFIG.charts).forEach(chart => chart && chart.resize());
    });
}

/**
 * 设置图表联动 (关键修改：使用 connect 实现真正的坐标统一)
 */
function setupChartLinkage() {
    // 将所有图表实例组成一个组，实现联动
    echarts.connect(Object.values(CONFIG.charts));
}

/**
 * 加载图表数据
 */
async function loadChartData(filename) {
    showLoading();
    try {
        const response = await fetch(CONFIG.dataPath + filename);
        if (!response.ok) throw new Error('文件不存在');
        
        const text = await response.text();
        const rawData = CSVParser.parse(text);
        
        if (rawData.length === 0) throw new Error('数据为空');

        CONFIG.currentData = rawData;
        CONFIG.currentContract = filename;

        // 日期筛选逻辑 (略，保持原样)
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        let filteredData = rawData;
        if (startDate || endDate) {
            filteredData = rawData.filter(row => {
                const rowDate = row[''] || row['日期'] || row['date'];
                if (!rowDate) return true;
                let dateStr = typeof rowDate === 'number' ? rowDate.toString() : rowDate;
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

        updateDateRange(rawData);
        const chartData = processChartData(filteredData);

        drawKlineChart(chartData);
        drawVolumeChart(chartData);
        drawOIChart(chartData);
        drawPositionChart(chartData);
        drawIVChart(chartData);
        drawCBChart(chartData);

        hideOverlay();
        updateStatsPanel(chartData);

    } catch (error) {
        console.error('加载失败:', error);
        showError('加载数据失败: ' + error.message);
    }
}

/**
 * 处理图表数据 (关键修改：统一日期格式为 yymmdd)
 */
function processChartData(rawData) {
    const dates = [], ohlc = [], volumes = [], oi = [], oiChange = [];
    const homieNet = [], instNet = [], iv = [], ivPct = [], cb = [], ma20 = [];

    rawData.forEach(row => {
        // --- 日期格式化处理 ---
        let dateStr = row[''] || row['日期'] || row['date'];
        if (typeof dateStr === 'number') {
            dateStr = dateStr.toString();
        }
        // 去除可能的时间部分
        dateStr = dateStr.split(' ')[0];
        // 去除横杠
        dateStr = dateStr.replace(/-/g, '');
        
        // 转换为 yymmdd (例如: 230801)
        if (dateStr.length === 8) {
            dates.push(dateStr.substring(2));
        } else {
            dates.push(dateStr); // 异常格式原样保留
        }
        // ---------------------

        ohlc.push([
            row['开盘价'] || row['open'],
            row['收盘价'] || row['close'],
            row['最低价'] || row['low'],
            row['最高价'] || row['high']
        ]);

        ma20.push(row['ma20'] || row['MA20']);
        volumes.push(row['成交量'] || row['volume'] || row['vol']);
        oi.push(row['持仓量'] || row['oi']);
        oiChange.push((row['持仓量变幅'] || 0) * 100);

        homieNet.push((row['家人多头持仓量'] || 0) + (row['家人空头持仓量'] || 0));
        instNet.push((row['机构多头持仓量'] || 0) + (row['机构空头持仓量'] || 0));

        iv.push(row['IV']);
        ivPct.push((row['IV_pct'] || 0) * 100);
        cb.push(row['CB_index']);
    });

    return { dates, ohlc, volumes, oi, oiChange, homieNet, instNet, iv, ivPct, cb, ma20 };
}

// ==================== 绘图函数 ====================

/**
 * 绘制K线图 (主图)
 */
function drawKlineChart(data) {
    CONFIG.charts.kline.setOption({
        title: { text: '价格走势', left: 'center', textStyle: { fontSize: 16 } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { data: ['K线', 'MA20'], top: 30 },
        // 使用统一的网格配置
        grid: { left: CONFIG.grid.left, right: CONFIG.grid.right, top: 80, bottom: 50 },
        xAxis: {
            type: 'category',
            data: data.dates,
            // 仅在主图显示标签
            axisLabel: { 
                show: true,
                rotate: 45, // 旋转防止重叠
                fontSize: 10
            },
            axisTick: { alignWithLabel: true }
        },
        yAxis: { 
            type: 'value', 
            scale: true, 
            splitArea: { show: true },
            position: 'left'
        },
        dataZoom: [
            { type: 'inside', xAxisIndex: [0], start: 50, end: 100 },
            { type: 'slider', xAxisIndex: [0], start: 50, end: 100, height: 20, bottom: 10 }
        ],
        series: [
            {
                name: 'K线', type: 'candlestick', data: data.ohlc,
                itemStyle: { color: COLORS.up, color0: COLORS.down, borderColor: COLORS.up, borderColor0: COLORS.down }
            },
            {
                name: 'MA20', type: 'line', data: data.ma20,
                smooth: true, lineStyle: { width: 2, color: COLORS.ma20 }, symbol: 'none'
            }
        ]
    }, true);
}

/**
 * 绘制副图通用配置
 */
function getSubChartOptions(titleText, yAxisName) {
    return {
        title: { text: titleText, left: 'center', textStyle: { fontSize: 14 } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        // 关键：使用完全相同的网格配置，保证垂直对齐
        grid: { left: CONFIG.grid.left, right: CONFIG.grid.right, top: 50, bottom: 10 },
        xAxis: {
            type: 'category',
            data: [], // 数据由各函数填充
            // 关键：副图隐藏X轴标签
            axisLabel: { show: false },
            axisTick: { show: false },
            axisLine: { show: false }
        },
        yAxis: { 
            type: 'value', 
            name: yAxisName,
            splitArea: { show: true },
            position: 'left'
        }
    };
}

function drawVolumeChart(data) {
    const option = getSubChartOptions('成交量', '');
    option.series = [{
        name: '成交量', type: 'bar', data: data.volumes,
        itemStyle: { color: COLORS.volume }
    }];
    CONFIG.charts.volume.setOption(option, true);
}

function drawOIChart(data) {
    const option = getSubChartOptions('持仓量 & 变幅', '持仓量');
    // 因为有右轴，需要覆盖grid right
    option.grid.right = '12%'; // 微调右轴空间
    option.yAxis = [
        { type: 'value', name: '持仓量', position: 'left', splitArea: { show: true } },
        { type: 'value', name: '变幅(%)', position: 'right', axisLabel: { formatter: '{value}%' } }
    ];
    option.series = [
        { name: '持仓量', type: 'bar', data: data.oi, itemStyle: { color: COLORS.oi } },
        { name: '持仓量变幅', type: 'line', yAxisIndex: 1, data: data.oiChange,
          lineStyle: { color: COLORS.oiChange, width: 2 }, symbol: 'circle', symbolSize: 4 }
    ];
    option.legend = { data: ['持仓量', '持仓量变幅'], top: 25 };
    CONFIG.charts.oi.setOption(option, true);
}

function drawPositionChart(data) {
    const option = getSubChartOptions('家人 & 机构净持仓', '');
    option.series = [
        { name: '家人净持仓', type: 'line', data: data.homieNet, lineStyle: { color: COLORS.homie, width: 2 }, symbol: 'circle', symbolSize: 4 },
        { name: '机构净持仓', type: 'line', data: data.instNet, lineStyle: { color: COLORS.inst, width: 2 }, symbol: 'circle', symbolSize: 4 }
    ];
    option.legend = { data: ['家人净持仓', '机构净持仓'], top: 25 };
    CONFIG.charts.position.setOption(option, true);
}

function drawIVChart(data) {
    const option = getSubChartOptions('隐含波动率 (IV)', 'IV');
    option.grid.right = '12%';
    option.yAxis = [
        { type: 'value', name: 'IV', position: 'left', splitArea: { show: true } },
        { type: 'value', name: '分位数(%)', position: 'right', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }
    ];
    option.series = [
        { name: 'IV', type: 'line', data: data.iv, lineStyle: { color: COLORS.iv, width: 2 }, symbol: 'circle', symbolSize: 4 },
        { name: 'IV60日分位数', type: 'line', yAxisIndex: 1, data: data.ivPct,
          lineStyle: { color: COLORS.ivPct, width: 2, type: 'dashed' }, symbol: 'circle', symbolSize: 4 }
    ];
    option.legend = { data: ['IV', 'IV60日分位数'], top: 25 };
    CONFIG.charts.iv.setOption(option, true);
}

function drawCBChart(data) {
    const option = getSubChartOptions('期限结构分数', '');
    option.series = [{
        name: '期限结构', type: 'line', data: data.cb,
        lineStyle: { color: COLORS.cb, width: 2 }, symbol: 'circle', symbolSize: 4,
        markLine: { silent: true, data: [{ yAxis: 0 }], lineStyle: { color: '#999', type: 'dashed' } }
    }];
    CONFIG.charts.cb.setOption(option, true);
}

// ==================== 辅助函数 ====================

function updateStatsPanel(data) {
    const lastIdx = data.dates.length - 1;
    const prevIdx = lastIdx - 1;
    const lastClose = data.ohlc[lastIdx]?.[2] || 0;
    const prevClose = data.ohlc[prevIdx]?.[2] || lastClose;
    const change = lastClose - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;

    const stats = [
        { label: '最新收盘价', value: lastClose.toFixed(2), className: change >= 0 ? 'positive' : 'negative' },
        { label: '涨跌幅', value: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%', className: changePct >= 0 ? 'positive' : 'negative' },
        { label: '最新成交量', value: formatNumber(data.volumes[lastIdx]) },
        { label: '最新持仓量', value: formatNumber(data.oi[lastIdx]) },
        { label: '家人净持仓', value: formatNumber(data.homieNet[lastIdx]), className: data.homieNet[lastIdx] >= 0 ? 'positive' : 'negative' },
        { label: '机构净持仓', value: formatNumber(data.instNet[lastIdx]), className: data.instNet[lastIdx] >= 0 ? 'positive' : 'negative' },
        { label: 'IV', value: data.iv[lastIdx]?.toFixed(2) || '-' },
        { label: '期限结构', value: data.cb[lastIdx]?.toFixed(2) || '-', className: data.cb[lastIdx] >= 0 ? 'positive' : 'negative' }
    ];

    document.getElementById('stats-panel').innerHTML = stats.map(s => `
        <div class="stat-item">
            <div class="stat-label">${s.label}</div>
            <div class="stat-value ${s.className || ''}">${s.value}</div>
        </div>
    `).join('');
}

function updateDateRange(data) {
    if (data.length === 0) return;
    const toDateStr = val => {
        if (typeof val === 'number') val = val.toString();
        val = val.replace(/-/g, '');
        if (val.length === 8) return `${val.substr(0, 4)}-${val.substr(4, 2)}-${val.substr(6, 2)}`;
        return val;
    };
    const firstDateStr = toDateStr(data[0][''] || data[0]['日期'] || data[0]['date']);
    const lastDateStr = toDateStr(data[data.length - 1][''] || data[data.length - 1]['日期'] || data[data.length - 1]['date']);
    
    const startInput = document.getElementById('start-date');
    const endInput = document.getElementById('end-date');
    startInput.min = firstDateStr; startInput.max = lastDateStr;
    endInput.min = firstDateStr; endInput.max = lastDateStr;
}

function showLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) { el.style.color = '#667eea'; el.textContent = '加载中...'; el.style.display = 'block'; }
}

function showError(msg) {
    const el = document.getElementById('loading-overlay');
    if (el) { el.style.color = '#dc3545'; el.textContent = msg; el.style.display = 'block'; }
}

function hideOverlay() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
}

function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const abs = Math.abs(num);
    if (abs >= 100000000) return (num / 100000000).toFixed(2) + '亿';
    if (abs >= 10000) return (num / 10000).toFixed(2) + '万';
    return num.toFixed(2);
}