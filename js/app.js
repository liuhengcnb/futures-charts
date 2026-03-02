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
    up: '#ef5350',
    down: '#26a69a',
    ma20: '#ffa726',
    volume: '#78909c',
    oi: '#42a5f5',
    oiChange: '#ef5350',
    homie: '#ec407a',
    inst: '#ab47bc',
    iv: '#42a5f5',
    ivPct: '#66bb6a',
    cb: '#8d6e63'
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initContractSelect();
    initEventListeners();
    initCharts();

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
        let files = [];

        if (response.ok) {
            files = await response.json();
        } else {
            console.log('manifest.json not found');
            select.innerHTML = '<option value="">未找到数据文件</option>';
            return;
        }

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
        if (e.target.value) {
            await loadChartData(e.target.value);
        }
    });

    document.getElementById('update-btn').addEventListener('click', async () => {
        const select = document.getElementById('contract-select');
        if (select.value) {
            await loadChartData(select.value);
        }
    });

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
    CONFIG.charts.kline    = echarts.init(document.getElementById('chart-kline'));
    CONFIG.charts.volume   = echarts.init(document.getElementById('chart-volume'));
    CONFIG.charts.oi       = echarts.init(document.getElementById('chart-oi'));
    CONFIG.charts.position = echarts.init(document.getElementById('chart-position'));
    CONFIG.charts.iv       = echarts.init(document.getElementById('chart-iv'));
    CONFIG.charts.cb       = echarts.init(document.getElementById('chart-cb'));

    window.addEventListener('resize', () => {
        Object.values(CONFIG.charts).forEach(chart => {
            if (chart) chart.resize();
        });
    });

    setupChartLinkage();
}

/**
 * 设置图表联动
 */
function setupChartLinkage() {
    const charts = Object.values(CONFIG.charts);

    charts.forEach(chart => {
        chart.on('datazoom', (params) => {
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
        const response = await fetch(CONFIG.dataPath + filename);
        const text = await response.text();
        const rawData = CSVParser.parse(text);

        if (rawData.length === 0) {
            throw new Error('数据为空');
        }

        CONFIG.currentData = rawData;
        CONFIG.currentContract = filename;

        const startDate = document.getElementById('start-date').value;
        const endDate   = document.getElementById('end-date').value;

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
                if (endDate   && formattedDate > endDate)   return false;
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
        console.error('加载图表数据失败:', error);
        showError('加载数据失败: ' + error.message);
    }
}

/**
 * 处理图表数据
 */
function processChartData(rawData) {
    const dates = [], ohlc = [], volumes = [], oi = [], oiChange = [];
    const homieNet = [], instNet = [], iv = [], ivPct = [], cb = [], ma20 = [];

    rawData.forEach(row => {
        let dateStr = row[''] || row['日期'] || row['date'];
        if (typeof dateStr === 'number') {
            dateStr = dateStr.toString();
            dateStr = `${dateStr.substr(0, 4)}-${dateStr.substr(4, 2)}-${dateStr.substr(6, 2)}`;
        } else if (dateStr) {
            dateStr = dateStr.split(' ')[0];
        }
        dates.push(dateStr);

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

/**
 * 绘制K线图
 */
function drawKlineChart(data) {
    CONFIG.charts.kline.setOption({
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
                        const v = param.data;
                        result += `<div>开盘: ${v[1].toFixed(2)}</div>`;
                        result += `<div>收盘: <span style="color:${v[1] <= v[2] ? COLORS.up : COLORS.down}">${v[2].toFixed(2)}</span></div>`;
                        result += `<div>最低: ${v[3].toFixed(2)}</div>`;
                        result += `<div>最高: ${v[4].toFixed(2)}</div>`;
                    } else if (param.seriesName === 'MA20') {
                        result += `<div>MA20: ${param.data?.toFixed(2) || '-'}</div>`;
                    }
                });
                return result;
            }
        },
        legend: { data: ['K线', 'MA20'], top: 30 },
        grid: { left: '10%', right: '5%', top: 80, bottom: 80 },
        xAxis: { type: 'category', data: data.dates, axisLabel: { rotate: 45 } },
        yAxis: { type: 'value', scale: true, splitArea: { show: true } },
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
    }, true);
}

/**
 * 绘制成交量图
 */
function drawVolumeChart(data) {
    CONFIG.charts.volume.setOption({
        title: { text: '成交量', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: {
            trigger: 'axis',
            formatter: params =>
                `<div style="font-weight:bold;">${params[0].axisValue}</div><div>成交量: ${formatNumber(params[0].data)}</div>`
        },
        grid: { left: '10%', right: '5%', top: 50, bottom: 30 },
        xAxis: { type: 'category', data: data.dates, axisLabel: { show: false } },
        yAxis: {
            type: 'value',
            splitArea: { show: true },
            axisLabel: { formatter: v => formatNumber(v) }
        },
        series: [{
            name: '成交量',
            type: 'bar',
            data: data.volumes,
            itemStyle: { color: COLORS.volume }
        }]
    }, true);
}

/**
 * 绘制持仓量图
 */
function drawOIChart(data) {
    CONFIG.charts.oi.setOption({
        title: { text: '持仓量 & 持仓量变幅', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = `<div style="font-weight:bold;">${params[0].axisValue}</div>`;
                params.forEach(p => {
                    if (p.seriesName === '持仓量')     result += `<div>持仓量: ${formatNumber(p.data)}</div>`;
                    else if (p.seriesName === '持仓量变幅') result += `<div>变幅: ${p.data?.toFixed(2) || '-'}%</div>`;
                });
                return result;
            }
        },
        legend: { data: ['持仓量', '持仓量变幅'], top: 25 },
        grid: { left: '10%', right: '15%', top: 60, bottom: 30 },
        xAxis: { type: 'category', data: data.dates, axisLabel: { show: false } },
        yAxis: [
            {
                type: 'value', name: '持仓量', position: 'left',
                splitArea: { show: true },
                axisLabel: { formatter: v => formatNumber(v) }
            },
            {
                type: 'value', name: '变幅(%)', position: 'right',
                axisLabel: { formatter: '{value}%' }
            }
        ],
        series: [
            {
                name: '持仓量', type: 'bar', data: data.oi,
                itemStyle: { color: COLORS.oi }
            },
            {
                name: '持仓量变幅', type: 'line', yAxisIndex: 1, data: data.oiChange,
                lineStyle: { color: COLORS.oiChange, width: 2 },
                symbol: 'circle', symbolSize: 4
            }
        ]
    }, true);
}

/**
 * 绘制持仓分析图
 */
function drawPositionChart(data) {
    CONFIG.charts.position.setOption({
        title: { text: '家人 & 机构净持仓', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = `<div style="font-weight:bold;">${params[0].axisValue}</div>`;
                params.forEach(p => { result += `<div>${p.seriesName}: ${formatNumber(p.data)}</div>`; });
                return result;
            }
        },
        legend: { data: ['家人净持仓', '机构净持仓'], top: 25 },
        grid: { left: '10%', right: '5%', top: 60, bottom: 30 },
        xAxis: { type: 'category', data: data.dates, axisLabel: { show: false } },
        yAxis: {
            type: 'value', splitArea: { show: true },
            axisLabel: { formatter: v => formatNumber(v) }
        },
        series: [
            {
                name: '家人净持仓', type: 'line', data: data.homieNet,
                lineStyle: { color: COLORS.homie, width: 2 },
                symbol: 'circle', symbolSize: 4,
                areaStyle: {
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(236,64,122,0.3)' },
                            { offset: 1, color: 'rgba(236,64,122,0.05)' }
                        ]
                    }
                }
            },
            {
                name: '机构净持仓', type: 'line', data: data.instNet,
                lineStyle: { color: COLORS.inst, width: 2 },
                symbol: 'circle', symbolSize: 4,
                areaStyle: {
                    color: {
                        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: 'rgba(171,71,188,0.3)' },
                            { offset: 1, color: 'rgba(171,71,188,0.05)' }
                        ]
                    }
                }
            }
        ]
    }, true);
}

/**
 * 绘制IV图
 */
function drawIVChart(data) {
    CONFIG.charts.iv.setOption({
        title: { text: '隐含波动率 (IV)', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = `<div style="font-weight:bold;">${params[0].axisValue}</div>`;
                params.forEach(p => {
                    if (p.seriesName === 'IV')           result += `<div>IV: ${p.data?.toFixed(2) || '-'}</div>`;
                    else if (p.seriesName === 'IV60日分位数') result += `<div>分位数: ${p.data?.toFixed(2) || '-'}%</div>`;
                });
                return result;
            }
        },
        legend: { data: ['IV', 'IV60日分位数'], top: 25 },
        grid: { left: '10%', right: '15%', top: 60, bottom: 30 },
        xAxis: { type: 'category', data: data.dates, axisLabel: { show: false } },
        yAxis: [
            { type: 'value', name: 'IV', position: 'left', splitArea: { show: true } },
            {
                type: 'value', name: '分位数(%)', position: 'right',
                min: 0, max: 100,
                axisLabel: { formatter: '{value}%' }
            }
        ],
        series: [
            {
                name: 'IV', type: 'line', data: data.iv,
                lineStyle: { color: COLORS.iv, width: 2 },
                symbol: 'circle', symbolSize: 4
            },
            {
                name: 'IV60日分位数', type: 'line', yAxisIndex: 1, data: data.ivPct,
                lineStyle: { color: COLORS.ivPct, width: 2, type: 'dashed' },
                symbol: 'circle', symbolSize: 4
            }
        ]
    }, true);
}

/**
 * 绘制期限结构图
 */
function drawCBChart(data) {
    CONFIG.charts.cb.setOption({
        title: { text: '期限结构分数', left: 'center', textStyle: { fontSize: 14 } },
        tooltip: {
            trigger: 'axis',
            formatter: params =>
                `<div style="font-weight:bold;">${params[0].axisValue}</div><div>期限结构: ${params[0].data?.toFixed(2) || '-'}</div>`
        },
        grid: { left: '10%', right: '5%', top: 50, bottom: 30 },
        xAxis: { type: 'category', data: data.dates, axisLabel: { show: false } },
        yAxis: { type: 'value', splitArea: { show: true } },
        series: [{
            name: '期限结构', type: 'line', data: data.cb,
            lineStyle: { color: COLORS.cb, width: 2 },
            symbol: 'circle', symbolSize: 4,
            areaStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: 'rgba(141,110,99,0.3)' },
                        { offset: 1, color: 'rgba(141,110,99,0.05)' }
                    ]
                }
            },
            markLine: {
                silent: true,
                data: [{ yAxis: 0 }],
                lineStyle: { color: '#999', type: 'dashed' }
            }
        }]
    }, true);
}

/**
 * 更新统计面板
 */
function updateStatsPanel(data) {
    const lastIdx = data.dates.length - 1;
    const prevIdx = lastIdx - 1;

    const lastClose = data.ohlc[lastIdx]?.[2] || 0;
    const prevClose = data.ohlc[prevIdx]?.[2] || lastClose;
    const change    = lastClose - prevClose;
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

/**
 * 更新日期范围
 */
function updateDateRange(data) {
    if (data.length === 0) return;

    const toDateStr = val => {
        if (typeof val === 'number') {
            const s = val.toString();
            return `${s.substr(0, 4)}-${s.substr(4, 2)}-${s.substr(6, 2)}`;
        }
        return val?.split(' ')[0] || '';
    };

    const firstDateStr = toDateStr(data[0][''] || data[0]['日期'] || data[0]['date']);
    const lastDateStr  = toDateStr(data[data.length - 1][''] || data[data.length - 1]['日期'] || data[data.length - 1]['date']);

    const startInput = document.getElementById('start-date');
    const endInput   = document.getElementById('end-date');
    startInput.min = firstDateStr;
    startInput.max = lastDateStr;
    endInput.min   = firstDateStr;
    endInput.max   = lastDateStr;
}

/**
 * 显示加载状态（不破坏图表容器）
 */
function showLoading() {
    const el = document.getElementById('loading-overlay');
    el.style.color = '#667eea';
    el.textContent = '加载中...';
    el.style.display = 'block';
}

/**
 * 显示错误信息（不破坏图表容器）
 */
function showError(message) {
    const el = document.getElementById('loading-overlay');
    el.style.color = '#dc3545';
    el.textContent = message;
    el.style.display = 'block';
}

/**
 * 隐藏 overlay
 */
function hideOverlay() {
    document.getElementById('loading-overlay').style.display = 'none';
}

/**
 * 格式化数字
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '-';
    const abs = Math.abs(num);
    if (abs >= 100000000) return (num / 100000000).toFixed(2) + '亿';
    if (abs >= 10000)     return (num / 10000).toFixed(2) + '万';
    return num.toFixed(2);
}