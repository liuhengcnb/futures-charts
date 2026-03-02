// js/app.js

// ==================== 全局配置 ====================
const CONFIG = {
    dataPath: 'data/',
    charts: {
        kline: null, volume: null, oi: null, position: null, iv: null, cb: null
    },
    // 统一网格配置，确保 X 轴完全对齐
    grid: {
        left: 80, 
        right: 80,
        top: 40,
        bottom: 40
    }
};

const COLORS = {
    up: '#ef5350', down: '#26a69a', ma20: '#ffa726', volume: '#78909c',
    oi: '#42a5f5', oiChange: '#ef5350', homie: '#ec407a', inst: '#ab47bc',
    iv: '#42a5f5', ivPct: '#66bb6a', cb: '#8d6e63', zeroLine: '#000000'
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    initCharts();
    await initContractSelect();
    initEventListeners();
    
    const select = document.getElementById('contract-select');
    if (select.options.length > 0) {
        await loadChartData(select.value);
    }
});

function initCharts() {
    Object.keys(CONFIG.charts).forEach(key => {
        const dom = document.getElementById(`chart-${key}`);
        if (dom) {
            CONFIG.charts[key] = echarts.init(dom);
        }
    });

    // 解决鼠标悬浮同步和贯穿线问题的核心：手动关联 axisPointer
    syncChartsAxisPointer();

    window.addEventListener('resize', () => {
        Object.values(CONFIG.charts).forEach(chart => chart && chart.resize());
    });
}

/**
 * 核心：跨图表光标同步
 * 实现鼠标悬浮时，所有图表同时出现垂直贯穿线并显示数值
 */
function syncChartsAxisPointer() {
    const charts = Object.values(CONFIG.charts).filter(c => c !== null);
    charts.forEach(chart => {
        chart.getZr().on('mousemove', (params) => {
            const pointInPixel = [params.offsetX, params.offsetY];
            // 转换像素点为逻辑索引
            const pointInGrid = chart.convertFromPixel({ seriesIndex: 0 }, pointInPixel);
            
            if (pointInGrid) {
                const dataIndex = pointInGrid[0];
                // 向所有图表派发显示请求
                charts.forEach(c => {
                    c.dispatchAction({
                        type: 'showTip',
                        seriesIndex: 0,
                        dataIndex: dataIndex
                    });
                    // 同步轴指示器（贯穿线）
                    c.dispatchAction({
                        type: 'updateAxisPointer',
                        currTrigger: 'click',
                        x: chart.convertToPixel({ xAxisIndex: 0 }, dataIndex)
                    });
                });
            }
        });
    });
}

// ==================== 数据加载与处理 ====================
async function loadChartData(filename) {
    showLoading();
    try {
        const response = await fetch(CONFIG.dataPath + filename);
        if (!response.ok) throw new Error('数据文件读取失败');
        const text = await response.text();
        const rawData = CSVParser.parse(text);
        
        // 彻底清理旧实例，防止品种切换时数据残留
        Object.values(CONFIG.charts).forEach(chart => chart && chart.clear());

        const data = processChartData(rawData);
        
        // 依次渲染
        drawKlineChart(data);
        drawVolumeChart(data);
        drawOIChart(data);
        drawPositionChart(data);
        drawIVChart(data);
        drawCBChart(data);

        updateStatsPanel(data);
        hideOverlay();
    } catch (error) {
        console.error(error);
        showError('加载失败: ' + error.message);
    }
}

function processChartData(rawData) {
    const res = {
        dates: [], ohlc: [], volumes: [], oi: [], oiChange: [],
        homieNet: [], instNet: [], iv: [], ivPct: [], cb: [], ma20: []
    };

    rawData.forEach(row => {
        // 日期统一处理为 yymmdd
        let rawDate = String(row['日期'] || row['date'] || row['']);
        let formattedDate = rawDate.replace(/-/g, '').replace(/\//g, '');
        if (formattedDate.length === 8) formattedDate = formattedDate.substring(2);
        
        res.dates.push(formattedDate);
        res.ohlc.push([row['开盘价'], row['收盘价'], row['最低价'], row['最高价']]);
        res.volumes.push(row['成交量'] || row['volume']);
        res.oi.push(row['持仓量'] || row['oi']);
        res.oiChange.push((row['持仓量变幅'] || 0) * 100); // 存为百分数
        res.homieNet.push((row['家人多头持仓量'] || 0) + (row['家人空头持仓量'] || 0));
        res.instNet.push((row['机构多头持仓量'] || 0) + (row['机构空头持仓量'] || 0));
        res.iv.push((row['IV'] || 0) * 100); 
        res.ivPct.push((row['IV_pct'] || 0) * 100);
        res.cb.push(row['CB_index'] || 0);
        res.ma20.push(row['ma20'] || row['MA20']);
    });
    return res;
}

// ==================== 绘图通用模板 ====================
function getCommonOptions(dates) {
    return {
        grid: CONFIG.grid,
        xAxis: {
            type: 'category',
            data: dates,
            axisLine: { onZero: false },
            splitLine: { show: false },
            axisPointer: {
                show: true,
                type: 'line',
                lineStyle: { color: '#666', type: 'dashed', width: 1 },
                label: { show: false } // 隐藏轴上的标签，由 tooltip 统一显示
            }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'none' }, // 禁用 tooltip 默认线，使用 xAxis 的贯穿线
            confine: true,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            textStyle: { color: '#333', fontSize: 12 }
        }
    };
}

// ==================== 各子图绘制 ====================

function drawKlineChart(data) {
    const opt = getCommonOptions(data.dates);
    opt.xAxis.axisLabel = { show: true, fontSize: 10 }; // 主图显示日期
    opt.yAxis = { scale: true, splitArea: { show: true } };
    opt.series = [
        {
            name: 'K线', type: 'candlestick', data: data.ohlc,
            itemStyle: { color: COLORS.up, color0: COLORS.down, borderColor: COLORS.up, borderColor0: COLORS.down }
        },
        { name: 'MA20', type: 'line', data: data.ma20, smooth: true, lineStyle: { color: COLORS.ma20, width: 1.5 }, symbol: 'none' }
    ];
    opt.tooltip.formatter = (params) => {
        const d = params[0];
        const k = data.ohlc[d.dataIndex];
        return `日期: <b>${d.name}</b><br/>开: ${k[0]} 高: ${k[3]}<br/>低: ${k[2]} 收: <b>${k[1]}</b>`;
    };
    CONFIG.charts.kline.setOption(opt, true);
}

function drawOIChart(data) {
    const opt = getCommonOptions(data.dates);
    opt.yAxis = [
        { type: 'value', name: '持仓', axisLabel: { formatter: v => (v/10000).toFixed(0) + '万' } },
        { type: 'value', name: '变幅', axisLabel: { formatter: '{value}%' } }
    ];
    opt.series = [
        { name: '持仓量', type: 'bar', data: data.oi, itemStyle: { color: COLORS.oi } },
        { name: '变幅', type: 'line', yAxisIndex: 1, data: data.oiChange, symbol: 'none', lineStyle: { color: COLORS.oiChange } }
    ];
    opt.tooltip.formatter = (params) => {
        const idx = params[0].dataIndex;
        return `持仓: ${formatNumber(data.oi[idx])}<br/>变幅: <span style="color:${COLORS.oiChange}">${data.oiChange[idx].toFixed(1)}%</span>`;
    };
    CONFIG.charts.oi.setOption(opt, true);
}

function drawPositionChart(data) {
    const opt = getCommonOptions(data.dates);
    opt.yAxis = { type: 'value', axisLabel: { formatter: v => (v/10000).toFixed(0) + '万' } };
    opt.series = [
        { name: '家人', type: 'line', data: data.homieNet, symbol: 'none', lineStyle: { color: COLORS.homie } },
        { name: '机构', type: 'line', data: data.instNet, symbol: 'none', lineStyle: { color: COLORS.inst } },
        // 黑色虚线零轴
        {
            type: 'line', markLine: {
                symbol: 'none',
                data: [{ yAxis: 0 }],
                lineStyle: { color: COLORS.zeroLine, type: 'dashed', width: 1 }
            }
        }
    ];
    opt.tooltip.formatter = (p) => {
        const i = p[0].dataIndex;
        return `家人净持: ${formatNumber(data.homieNet[i])}<br/>机构净持: ${formatNumber(data.instNet[i])}`;
    };
    CONFIG.charts.position.setOption(opt, true);
}

function drawIVChart(data) {
    const opt = getCommonOptions(data.dates);
    opt.yAxis = [
        { type: 'value', axisLabel: { formatter: '{value}.0%' } }, // 左轴 0.0% 格式
        { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } }
    ];
    opt.series = [
        { name: 'IV', type: 'line', data: data.iv, symbol: 'none', lineStyle: { color: COLORS.iv } },
        { name: 'IV分位', type: 'line', yAxisIndex: 1, data: data.ivPct, symbol: 'none', lineStyle: { color: COLORS.ivPct, type: 'dotted' } }
    ];
    opt.tooltip.formatter = (p) => {
        const i = p[0].dataIndex;
        return `IV: ${data.iv[i].toFixed(1)}%<br/>IV分位: ${data.ivPct[i].toFixed(1)}%`;
    };
    CONFIG.charts.iv.setOption(opt, true);
}

function drawCBChart(data) {
    const opt = getCommonOptions(data.dates);
    opt.yAxis = { type: 'value', axisLabel: { formatter: v => v.toFixed(2) } }; // 左轴 0.00 格式
    opt.series = [{ 
        name: '期限分数', type: 'line', data: data.cb, symbol: 'none', 
        lineStyle: { color: COLORS.cb },
        markLine: { symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { type: 'dashed' } }
    }];
    opt.tooltip.formatter = (p) => `期限结构分数: <b>${data.cb[p[0].dataIndex].toFixed(1)}</b>`;
    CONFIG.charts.cb.setOption(opt, true);
}

function drawVolumeChart(data) {
    const opt = getCommonOptions(data.dates);
    opt.yAxis = { axisLabel: { formatter: v => (v/10000).toFixed(0) + '万' } };
    opt.series = [{ name: '成交量', type: 'bar', data: data.volumes, itemStyle: { color: COLORS.volume } }];
    opt.tooltip.formatter = (p) => `成交量: ${formatNumber(data.volumes[p[0].dataIndex])}`;
    CONFIG.charts.volume.setOption(opt, true);
}

// ==================== 辅助功能 ====================
function formatNumber(n) {
    if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(2) + '亿';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    return n;
}

async function initContractSelect() {
    const select = document.getElementById('contract-select');
    try {
        const res = await fetch(CONFIG.dataPath + 'manifest.json');
        const files = await res.json();
        select.innerHTML = files.map(f => `<option value="${f.filename}">${f.display_name}</option>`).join('');
    } catch (e) { select.innerHTML = '<option>加载失败</option>'; }
}

function initEventListeners() {
    document.getElementById('contract-select').addEventListener('change', e => loadChartData(e.target.value));
    document.getElementById('update-btn').addEventListener('click', () => loadChartData(document.getElementById('contract-select').value));
}

function showLoading() { const el = document.getElementById('loading-overlay'); if (el) { el.textContent = '读取中...'; el.style.display = 'block'; } }
function showError(m) { const el = document.getElementById('loading-overlay'); if (el) { el.style.color = 'red'; el.textContent = m; } }
function hideOverlay() { const el = document.getElementById('loading-overlay'); if (el) el.style.display = 'none'; }

function updateStatsPanel(data) {
    // 此处保留你原有的面板更新逻辑...
}