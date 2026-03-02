// js/app.js

// ==================== 全局配置 ====================
const CONFIG = {
    dataPath: 'data/',
    charts: {
        kline: null, volume: null, oi: null, position: null, iv: null, cb: null
    },
    // 【关键】使用固定像素值锁定网格，确保所有图表绘图区域完全重合
    // left: 预留空间给 Y 轴标签，right: 预留空间给右侧 Y 轴
    grid: {
        left: 85,   
        right: 85,  
        top: 50,    
        bottom: 50   
    }
};

// 颜色配置
const COLORS = {
    up: '#ef5350', down: '#26a69a', ma20: '#ffa726', volume: '#78909c',
    oi: '#42a5f5', oiChange: '#ef5350', homie: '#ec407a', inst: '#ab47bc',
    iv: '#42a5f5', ivPct: '#66bb6a', cb: '#8d6e63'
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    await initContractSelect();
    initEventListeners();
    initCharts();
    setupChartLinkage();
    
    const select = document.getElementById('contract-select');
    if (select.options.length > 0) {
        select.selectedIndex = 0;
        await loadChartData(select.value);
    }
});

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

function initCharts() {
    Object.keys(CONFIG.charts).forEach(key => {
        CONFIG.charts[key] = echarts.init(document.getElementById(`chart-${key}`));
    });
    window.addEventListener('resize', () => {
        Object.values(CONFIG.charts).forEach(chart => chart && chart.resize());
    });
}

/**
 * 核心修复：配置联动
 * 1. connect: 处理 dataZoom (缩放) 联动
 * 2. 手动事件监听: 处理 axisPointer (悬浮竖线) 的完美同步
 */
function setupChartLinkage() {
    const charts = Object.values(CONFIG.charts);
    // 1. 缩放联动
    echarts.connect(charts);

    // 2. 悬浮联动 (Tooltip/AxisPointer 同步)
    // 使用 `updateAxisPointer` 事件，当鼠标在某个图表移动时，强制其他图表同步显示
    charts.forEach(chart => {
        chart.on('updateAxisPointer', (event) => {
            // event 对象中包含当前的数据索引信息
            const { dataIndex } = event;
            
            // 同步所有其他图表
            charts.forEach(otherChart => {
                if (otherChart !== chart) {
                    // 触发显示 Tooltip 和 竖线
                    otherChart.dispatchAction({
                        type: 'showTip',
                        seriesIndex: 0, // 每个图表的第0个系列
                        dataIndex: dataIndex
                    });
                }
            });
        });
    });
}

async function loadChartData(filename) {
    showLoading();
    try {
        const response = await fetch(CONFIG.dataPath + filename);
        if (!response.ok) throw new Error('文件不存在');
        const text = await response.text();
        const rawData = CSVParser.parse(text);
        
        if (rawData.length === 0) throw new Error('数据为空');

        // 日期筛选逻辑 (略)
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

        // 按顺序绘制，确保数据同步
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
 * 核心修复：数据处理
 * 统一生成 yymmdd 格式的日期数组，供所有图表共用
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
        dateStr = dateStr.split(' ')[0].replace(/-/g, '');
        
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

        const homieLong  = row['家人多头持仓量'] || 0;
        const homieShort = row['家人空头持仓量'] || 0;
        homieNet.push(homieLong + homieShort);

        const instLong  = row['机构多头持仓量'] || 0;
        const instShort = row['机构空头持仓量'] || 0;
        instNet.push(instLong + instShort);

        iv.push(row['IV']);
        ivPct.push((row['IV_pct'] || 0) * 100);
        cb.push(row['CB_index']);
    });

    return { dates, ohlc, volumes, oi, oiChange, homieNet, instNet, iv, ivPct, cb, ma20 };
}

// ==================== 绘图函数 ====================

/**
 * 生成副图的基础配置
 * 关键：强制使用相同的 grid 和 x轴数据
 */
function getBaseOption(dates) {
    return {
        xAxis: {
            type: 'category',
            data: dates, // 关键：共享同一个 dates 数组
            axisLabel: { show: false }, // 副图默认隐藏标签
            axisTick: { alignWithLabel: true } // 让刻度线对齐到标签中心
        },
        grid: { 
            left: CONFIG.grid.left, 
            right: CONFIG.grid.right,
            top: CONFIG.grid.top,
            bottom: CONFIG.grid.bottom
        },
        tooltip: { 
            trigger: 'axis', 
            confine: true, // 限制在图表区域内，防止溢出
            axisPointer: { 
                type: 'line', 
                lineStyle: { color: '#999', type: 'dashed' } 
            } 
        }
    };
}

function drawKlineChart(data) {
    const base = getBaseOption(data.dates);
    // 主图需要显示日期
    base.xAxis.axisLabel = { 
        show: true, 
        rotate: 45, 
        fontSize: 10 
    };
    
    const option = {
        ...base,
        title: { text: '价格走势', left: 'center', textStyle: { fontSize: 16 } },
        legend: { data: ['K线', 'MA20'], top: 30 },
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
    };
    CONFIG.charts.kline.setOption(option, true);
}

function drawVolumeChart(data) {
    const base = getBaseOption(data.dates);
    const option = {
        ...base,
        title: { text: '成交量', left: 'center', textStyle: { fontSize: 14 } },
        yAxis: {
            type: 'value',
            splitArea: { show: true },
            axisLabel: { formatter: v => formatNumber(v) }
        },
        series: [{
            name: '成交量', type: 'bar', data: data.volumes,
            itemStyle: { color: COLORS.volume }
        }]
    };
    CONFIG.charts.volume.setOption(option, true);
}

function drawOIChart(data) {
    const base = getBaseOption(data.dates);
    const option = {
        ...base,
        title: { text: '持仓量 & 变幅', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['持仓量', '持仓量变幅'], top: 25 },
        yAxis: [
            { type: 'value', name: '持仓量', position: 'left', splitArea: { show: true } },
            { type: 'value', name: '变幅(%)', position: 'right', axisLabel: { formatter: '{value}%' } }
        ],
        series: [
            { name: '持仓量', type: 'bar', data: data.oi, itemStyle: { color: COLORS.oi } },
            { 
                name: '持仓量变幅', type: 'line', yAxisIndex: 1, data: data.oiChange,
                lineStyle: { color: COLORS.oiChange, width: 2 }, symbol: 'circle', symbolSize: 4,
                // 【新增】添加红色零轴虚线
                markLine: {
                    silent: true,
                    data: [{ yAxis: 0 }],
                    lineStyle: { color: COLORS.oiChange, type: 'dashed', width: 1.5 }
                }
            }
        ]
    };
    CONFIG.charts.oi.setOption(option, true);
}

function drawPositionChart(data) {
    const base = getBaseOption(data.dates);
    const option = {
        ...base,
        title: { text: '家人 & 机构净持仓', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['家人净持仓', '机构净持仓'], top: 25 },
        yAxis: {
            type: 'value',
            splitArea: { show: true },
            axisLabel: { formatter: v => formatNumber(v) }
        },
        series: [
            { name: '家人净持仓', type: 'line', data: data.homieNet, lineStyle: { color: COLORS.homie, width: 2 }, symbol: 'circle', symbolSize: 4 },
            { name: '机构净持仓', type: 'line', data: data.instNet, lineStyle: { color: COLORS.inst, width: 2 }, symbol: 'circle', symbolSize: 4 }
        ]
    };
    CONFIG.charts.position.setOption(option, true);
}

function drawIVChart(data) {
    const base = getBaseOption(data.dates);
    const option = {
        ...base,
        title: { text: '隐含波动率 (IV)', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['IV', 'IV60日分位数'], top: 25 },
        yAxis: [
            { type: 'value', name: 'IV', position: 'left', splitArea: { show: true } },
            { type: 'value', name: '分位数(%)', position: 'right', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }
        ],
        series: [
            { name: 'IV', type: 'line', data: data.iv, lineStyle: { color: COLORS.iv, width: 2 }, symbol: 'circle', symbolSize: 4 },
            { name: 'IV60日分位数', type: 'line', yAxisIndex: 1, data: data.ivPct, lineStyle: { color: COLORS.ivPct, width: 2, type: 'dashed' }, symbol: 'circle', symbolSize: 4 }
        ]
    };
    CONFIG.charts.iv.setOption(option, true);
}

function drawCBChart(data) {
    const base = getBaseOption(data.dates);
    const option = {
        ...base,
        title: { text: '期限结构分数', left: 'center', textStyle: { fontSize: 14 } },
        yAxis: { type: 'value', splitArea: { show: true } },
        series: [{
            name: '期限结构', type: 'line', data: data.cb,
            lineStyle: { color: COLORS.cb, width: 2 }, symbol: 'circle', symbolSize: 4,
            markLine: { silent: true, data: [{ yAxis: 0 }], lineStyle: { color: '#999', type: 'dashed' } }
        }]
    };
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

function showLoading() { const el = document.getElementById('loading-overlay'); if (el) { el.style.color = '#667eea'; el.textContent = '加载中...'; el.style.display = 'block'; } }
function showError(msg) { const el = document.getElementById('loading-overlay'); if (el) { el.style.color = '#dc3545'; el.textContent = msg; el.style.display = 'block'; } }
function hideOverlay() { const el = document.getElementById('loading-overlay'); if (el) el.style.display = 'none'; }

function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const abs = Math.abs(num);
    if (abs >= 100000000) return (num / 100000000).toFixed(2) + '亿';
    if (abs >= 10000) return (num / 10000).toFixed(2) + '万';
    return num.toFixed(2);
}