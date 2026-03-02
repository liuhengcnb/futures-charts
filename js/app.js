// js/app.js

// ==================== 全局配置 ====================
const CONFIG = {
    dataPath: 'data/',
    charts: {},
    currentDates: [],
    // 固定像素网格：所有图表绘图区域左右边界完全对齐
    grid: { left: 85, right: 85, top: 50, bottom: 30 }
};

const COLORS = {
    up: '#ef5350', down: '#26a69a', ma20: '#ffa726', volume: '#78909c',
    oi: '#42a5f5', oiChange: '#ef5350', homie: '#ec407a', inst: '#ab47bc',
    iv: '#42a5f5', ivPct: '#66bb6a', cb: '#8d6e63'
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    await initContractSelect();
    initEventListeners();
    initCharts();                          // 先建实例、挂联动
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
        const resp = await fetch(CONFIG.dataPath + 'manifest.json');
        if (!resp.ok) throw new Error('未找到 manifest.json');
        const files = await resp.json();
        select.innerHTML = '';
        files.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.filename;
            opt.textContent = f.display_name;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('加载品种列表失败:', e);
        select.innerHTML = '<option value="">加载失败</option>';
    }
}

function initEventListeners() {
    document.getElementById('contract-select').addEventListener('change', async (e) => {
        if (e.target.value) await loadChartData(e.target.value);
    });
    document.getElementById('update-btn').addEventListener('click', async () => {
        const sel = document.getElementById('contract-select');
        if (sel.value) await loadChartData(sel.value);
    });
    document.getElementById('reset-btn').addEventListener('click', () => {
        document.getElementById('start-date').value = '';
        document.getElementById('end-date').value = '';
        const sel = document.getElementById('contract-select');
        if (sel.value) loadChartData(sel.value);
    });
}

function initCharts() {
    ['kline', 'volume', 'oi', 'position', 'iv', 'cb'].forEach(key => {
        const el = document.getElementById(`chart-${key}`);
        if (el) CONFIG.charts[key] = echarts.init(el);
    });
    window.addEventListener('resize', () => {
        Object.values(CONFIG.charts).forEach(c => c && c.resize());
    });
    setupChartLinkage();
}

// ==================== 联动（悬浮竖线 + 缩放同步） ====================
let _syncing = false;

function setupChartLinkage() {
    const chartList = Object.values(CONFIG.charts).filter(Boolean);

    // 1. 缩放联动（echarts.connect 令所有图表共享 dataZoom 状态）
    echarts.connect(chartList);

    // 2. 悬浮联动：任意图 updateAxisPointer → 驱动其余图表显示同索引 tip
    chartList.forEach(src => {
        src.off('updateAxisPointer');
        src.on('updateAxisPointer', (evt) => {
            if (_syncing) return;

            // 优先取 dataIndex；若无则从 axesInfo 提取 x 轴坐标
            let idx = evt.dataIndex;
            if (typeof idx !== 'number') {
                const xInfo = evt.axesInfo && evt.axesInfo.find(a => a.axisDim === 'x');
                if (xInfo) {
                    const v = xInfo.value;
                    idx = (typeof v === 'number') ? v : CONFIG.currentDates.indexOf(String(v));
                }
            }
            if (typeof idx !== 'number' || idx < 0) return;

            _syncing = true;
            chartList.forEach(tgt => {
                if (tgt === src) return;
                tgt.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
            });
            _syncing = false;
        });

        // 鼠标离开图表区域时，所有图隐藏 tip
        src.off('globalout');
        src.on('globalout', () => {
            if (_syncing) return;
            _syncing = true;
            chartList.forEach(tgt => tgt.dispatchAction({ type: 'hideTip' }));
            _syncing = false;
        });
    });
}

// ==================== 数据加载 ====================
async function loadChartData(filename) {
    showLoading();
    try {
        const resp = await fetch(CONFIG.dataPath + filename);
        if (!resp.ok) throw new Error('文件不存在');
        const text = await resp.text();
        const rawData = CSVParser.parse(text);
        if (!rawData || rawData.length === 0) throw new Error('数据为空');

        CONFIG.rawData   = rawData;
        CONFIG.currentFile = filename;

        updateDateRange(rawData);

        const startDate = document.getElementById('start-date').value;
        const endDate   = document.getElementById('end-date').value;
        const filtered  = filterByDate(rawData, startDate, endDate);
        const chartData = processChartData(filtered);
        CONFIG.currentDates = chartData.dates;

        // ★ 清空所有图表（彻底清除旧数据/缩放状态）
        Object.values(CONFIG.charts).forEach(c => c && c.clear());

        // ★ 重绘所有图表（品种切换必须六图全部刷新）
        drawKlineChart(chartData);
        drawVolumeChart(chartData);
        drawOIChart(chartData);
        drawPositionChart(chartData);
        drawIVChart(chartData);
        drawCBChart(chartData);

        hideOverlay();
        updateStatsPanel(chartData);
    } catch (e) {
        console.error('加载失败:', e);
        showError('加载数据失败: ' + e.message);
    }
}

function filterByDate(rawData, startDate, endDate) {
    if (!startDate && !endDate) return rawData;
    return rawData.filter(row => {
        let ds = row[''] || row['日期'] || row['date'];
        if (!ds) return true;
        ds = String(typeof ds === 'number' ? ds : ds).split(' ')[0].replace(/-/g, '');
        const fmt = ds.length === 8
            ? `${ds.substr(0, 4)}-${ds.substr(4, 2)}-${ds.substr(6, 2)}`
            : ds;
        if (startDate && fmt < startDate) return false;
        if (endDate   && fmt > endDate)   return false;
        return true;
    });
}

function processChartData(rawData) {
    const dates = [], ohlc = [], volumes = [], oi = [], oiChange = [];
    const homieNet = [], instNet = [], iv = [], ivPct = [], cb = [], ma20 = [];

    rawData.forEach(row => {
        // --- 日期 → yymmdd (6位) ---
        let ds = row[''] || row['日期'] || row['date'];
        ds = String(typeof ds === 'number' ? ds : ds).split(' ')[0].replace(/-/g, '');
        dates.push(ds.length === 8 ? ds.substring(2) : ds);   // 去掉世纪两位

        const open  = parseFloat(row['开盘价'] || row['open'])  || 0;
        const close = parseFloat(row['收盘价'] || row['close']) || 0;
        const low   = parseFloat(row['最低价'] || row['low'])   || 0;
        const high  = parseFloat(row['最高价'] || row['high'])  || 0;
        ohlc.push([open, close, low, high]);

        ma20.push(parseFloat(row['ma20'] || row['MA20']) || null);
        volumes.push(parseFloat(row['成交量'] || row['volume'] || row['vol']) || 0);
        oi.push(parseFloat(row['持仓量'] || row['oi']) || 0);
        oiChange.push((parseFloat(row['持仓量变幅']) || 0) * 100);

        const homieLong  = parseFloat(row['家人多头持仓量']) || 0;
        const homieShort = parseFloat(row['家人空头持仓量']) || 0;
        homieNet.push(homieLong + homieShort);

        const instLong  = parseFloat(row['机构多头持仓量']) || 0;
        const instShort = parseFloat(row['机构空头持仓量']) || 0;
        instNet.push(instLong + instShort);

        iv.push(parseFloat(row['IV']) || null);
        ivPct.push((parseFloat(row['IV_pct']) || 0) * 100);
        cb.push(parseFloat(row['CB_index']) !== undefined && row['CB_index'] !== '' && row['CB_index'] !== null
            ? parseFloat(row['CB_index'])
            : null);
    });

    return { dates, ohlc, volumes, oi, oiChange, homieNet, instNet, iv, ivPct, cb, ma20 };
}

// ==================== 通用配置生成器 ====================

/**
 * 生成统一的 xAxis 配置
 * @param {string[]} dates   - yymmdd 格式日期数组
 * @param {boolean}  showLabel - 是否显示刻度标签（仅主图为 true）
 */
function makeXAxis(dates, showLabel) {
    return {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisTick: { alignWithLabel: true },
        axisLine: { onZero: false },
        axisPointer: { type: 'shadow' },
        axisLabel: showLabel
            ? {
                show: true,
                fontSize: 10,
                color: '#666',
                // 自动稀疏：约显示 12~15 个刻度
                interval: Math.max(0, Math.floor(dates.length / 13) - 1),
                formatter: v => v   // 已是 yymmdd 格式，直接用
            }
            : { show: false }
    };
}

/**
 * 生成统一的 grid 配置（含固定像素，保证绘图区对齐）
 * @param {number} [extraBottom=0] - 额外底部留白（主图为 50，给 slider）
 */
function makeGrid(extraBottom) {
    return {
        left:         CONFIG.grid.left,
        right:        CONFIG.grid.right,
        top:          CONFIG.grid.top,
        bottom:       CONFIG.grid.bottom + (extraBottom || 0),
        containLabel: false   // 不含轴标签，才能保证像素级对齐
    };
}

/**
 * 生成统一的 tooltip 基础配置（含竖线 axisPointer）
 */
function makeTooltip(formatter) {
    return {
        trigger:     'axis',
        confine:     true,
        appendToBody: true,
        axisPointer: {
            type:      'line',
            lineStyle: { color: 'rgba(80,80,80,0.5)', type: 'dashed', width: 1 }
        },
        formatter
    };
}

/**
 * 各副图统一挂载 inside dataZoom（由主图 slider 通过 connect 同步）
 */
function makeSubZoom() {
    return [{ type: 'inside', xAxisIndex: [0], start: 50, end: 100 }];
}

// ==================== 绘图函数 ====================

function drawKlineChart(data) {
    CONFIG.charts.kline.setOption({
        title:  { text: '价格走势', left: 'center', textStyle: { fontSize: 16 } },
        legend: { data: ['K线', 'MA20'], top: 28 },
        grid:   makeGrid(50),   // 额外 50px 给 slider
        xAxis:  makeXAxis(data.dates, true),   // ★ 主图显示 yymmdd 横轴
        yAxis: {
            type: 'value', scale: true, splitArea: { show: true }, position: 'left',
            axisLabel: { fontSize: 11 }
        },
        dataZoom: [
            { type: 'inside', xAxisIndex: [0], start: 50, end: 100 },
            { type: 'slider', xAxisIndex: [0], start: 50, end: 100, height: 20, bottom: 10, handleSize: 14 }
        ],
        tooltip: makeTooltip((params) => {
            const k = params.find(p => p.seriesName === 'K线');
            const m = params.find(p => p.seriesName === 'MA20');
            if (!k) return '';
            const [o, c, l, h] = k.value;
            const clr = c >= o ? COLORS.up : COLORS.down;
            return `<div style="font-size:12px;line-height:2">
                <b style="font-size:13px">${k.name}</b><br/>
                <span style="color:${COLORS.up}">●</span> <b>K线</b><br/>
                &nbsp;开&nbsp;<b>${fmtPrice(o)}</b>&ensp;收&nbsp;<b style="color:${clr}">${fmtPrice(c)}</b><br/>
                &nbsp;低&nbsp;<b>${fmtPrice(l)}</b>&ensp;高&nbsp;<b>${fmtPrice(h)}</b>
                ${m && m.value != null
                    ? `<br/><span style="color:${COLORS.ma20}">●</span> MA20&nbsp;<b>${fmtPrice(m.value)}</b>`
                    : ''}
            </div>`;
        }),
        series: [
            {
                name: 'K线', type: 'candlestick', data: data.ohlc,
                itemStyle: {
                    color: COLORS.up, color0: COLORS.down,
                    borderColor: COLORS.up, borderColor0: COLORS.down
                }
            },
            {
                name: 'MA20', type: 'line', data: data.ma20,
                smooth: true, symbol: 'none', connectNulls: true,
                lineStyle: { width: 2, color: COLORS.ma20 }
            }
        ]
    }, { notMerge: true });
}

function drawVolumeChart(data) {
    CONFIG.charts.volume.setOption({
        title:  { text: '成交量', left: 'center', textStyle: { fontSize: 14 } },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis: {
            type: 'value', splitArea: { show: true },
            axisLabel: { formatter: v => fmtNum(v), fontSize: 11 }
        },
        dataZoom: makeSubZoom(),
        tooltip: makeTooltip((params) => {
            const p = params[0];
            if (!p) return '';
            return `<div style="font-size:12px;line-height:2">
                <span style="color:${COLORS.volume}">●</span> 成交量&nbsp;<b>${fmtNum(p.value)}</b>
            </div>`;
        }),
        series: [{
            name: '成交量', type: 'bar', data: data.volumes,
            itemStyle: { color: COLORS.volume }, barMaxWidth: 8
        }]
    }, { notMerge: true });
}

function drawOIChart(data) {
    CONFIG.charts.oi.setOption({
        title:  { text: '持仓量 & 变幅', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['持仓量', '持仓量变幅'], top: 25 },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis: [
            {
                type: 'value', name: '持仓量', position: 'left', splitArea: { show: true },
                axisLabel: { formatter: v => fmtNum(v), fontSize: 11 }
            },
            {
                type: 'value', name: '变幅(%)', position: 'right', splitLine: { show: false },
                axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 }
            }
        ],
        dataZoom: makeSubZoom(),
        tooltip: makeTooltip((params) => {
            const oiP  = params.find(p => p.seriesName === '持仓量');
            const chP  = params.find(p => p.seriesName === '持仓量变幅');
            return `<div style="font-size:12px;line-height:2">
                ${oiP ? `<span style="color:${COLORS.oi}">●</span> 持仓量&nbsp;<b>${fmtNum(oiP.value)}</b><br/>` : ''}
                ${chP ? `<span style="color:${COLORS.oiChange}">●</span> 持仓量变幅&nbsp;<b>${fmtPct1(chP.value)}</b>` : ''}
            </div>`;
        }),
        series: [
            {
                name: '持仓量', type: 'bar', data: data.oi,
                itemStyle: { color: COLORS.oi }, barMaxWidth: 8
            },
            {
                name: '持仓量变幅', type: 'line', yAxisIndex: 1, data: data.oiChange,
                lineStyle: { color: COLORS.oiChange, width: 2 },
                symbol: 'circle', symbolSize: 3,
                // ★ 红色虚线 0 轴
                markLine: {
                    silent: true, symbol: 'none',
                    data: [{ yAxis: 0 }],
                    lineStyle: { color: '#ef5350', type: 'dashed', width: 1.5 }
                }
            }
        ]
    }, { notMerge: true });
}

function drawPositionChart(data) {
    CONFIG.charts.position.setOption({
        title:  { text: '家人 & 机构净持仓', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['家人净持仓', '机构净持仓'], top: 25 },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis: {
            type: 'value', splitArea: { show: true },
            axisLabel: { formatter: v => fmtNum(v), fontSize: 11 }
        },
        dataZoom: makeSubZoom(),
        tooltip: makeTooltip((params) => {
            const h = params.find(p => p.seriesName === '家人净持仓');
            const i = params.find(p => p.seriesName === '机构净持仓');
            return `<div style="font-size:12px;line-height:2">
                ${h ? `<span style="color:${COLORS.homie}">●</span> 家人净持仓&nbsp;<b>${fmtNum(h.value)}</b><br/>` : ''}
                ${i ? `<span style="color:${COLORS.inst}">●</span> 机构净持仓&nbsp;<b>${fmtNum(i.value)}</b>` : ''}
            </div>`;
        }),
        series: [
            {
                name: '家人净持仓', type: 'line', data: data.homieNet,
                lineStyle: { color: COLORS.homie, width: 2 }, symbol: 'circle', symbolSize: 3,
                // ★ 黑色虚线 0 轴
                markLine: {
                    silent: true, symbol: 'none',
                    data: [{ yAxis: 0 }],
                    lineStyle: { color: '#333333', type: 'dashed', width: 1.5 }
                }
            },
            {
                name: '机构净持仓', type: 'line', data: data.instNet,
                lineStyle: { color: COLORS.inst, width: 2 }, symbol: 'circle', symbolSize: 3
            }
        ]
    }, { notMerge: true });
}

function drawIVChart(data) {
    CONFIG.charts.iv.setOption({
        title:  { text: '隐含波动率 (IV)', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['IV', 'IV60日分位数'], top: 25 },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis: [
            {
                type: 'value', name: 'IV', position: 'left', splitArea: { show: true },
                // ★ 左轴格式：0.0%
                axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 }
            },
            {
                type: 'value', name: '分位数(%)', position: 'right',
                min: 0, max: 100, splitLine: { show: false },
                axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 }
            }
        ],
        dataZoom: makeSubZoom(),
        tooltip: makeTooltip((params) => {
            const ivP    = params.find(p => p.seriesName === 'IV');
            const ivPctP = params.find(p => p.seriesName === 'IV60日分位数');
            return `<div style="font-size:12px;line-height:2">
                ${ivP    ? `<span style="color:${COLORS.iv}">●</span> IV&nbsp;<b>${fmtPct1(ivP.value)}</b><br/>` : ''}
                ${ivPctP ? `<span style="color:${COLORS.ivPct}">●</span> IV分位数&nbsp;<b>${fmtPct1(ivPctP.value)}</b>` : ''}
            </div>`;
        }),
        series: [
            {
                name: 'IV', type: 'line', data: data.iv,
                lineStyle: { color: COLORS.iv, width: 2 }, symbol: 'circle', symbolSize: 3, connectNulls: true
            },
            {
                name: 'IV60日分位数', type: 'line', yAxisIndex: 1, data: data.ivPct,
                lineStyle: { color: COLORS.ivPct, width: 2, type: 'dashed' },
                symbol: 'circle', symbolSize: 3
            }
        ]
    }, { notMerge: true });
}

function drawCBChart(data) {
    CONFIG.charts.cb.setOption({
        title: { text: '期限结构分数', left: 'center', textStyle: { fontSize: 14 } },
        grid:  makeGrid(),
        xAxis: makeXAxis(data.dates, false),
        yAxis: {
            type: 'value', splitArea: { show: true },
            // ★ 左轴格式：0.00
            axisLabel: { formatter: v => v.toFixed(2), fontSize: 11 }
        },
        dataZoom: makeSubZoom(),
        tooltip: makeTooltip((params) => {
            const p = params[0];
            if (!p) return '';
            return `<div style="font-size:12px;line-height:2">
                <span style="color:${COLORS.cb}">●</span> 期限结构分数&nbsp;<b>${fmtCB(p.value)}</b>
            </div>`;
        }),
        series: [{
            name: '期限结构', type: 'line', data: data.cb,
            lineStyle: { color: COLORS.cb, width: 2 }, symbol: 'circle', symbolSize: 3, connectNulls: true,
            markLine: {
                silent: true, symbol: 'none',
                data: [{ yAxis: 0 }],
                lineStyle: { color: '#999', type: 'dashed', width: 1.5 }
            }
        }]
    }, { notMerge: true });
}

// ==================== 格式化工具 ====================

/** 价格：保留两位小数 */
function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(2);
}

/** 百分比：x.x% */
function fmtPct1(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(1) + '%';
}

/** 期限结构分数：x.xx */
function fmtCB(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(2);
}

/** 大数字：万 / 亿 简写 */
function fmtNum(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const abs = Math.abs(num);
    if (abs >= 1e8) return (num / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return (num / 1e4).toFixed(2) + '万';
    return Math.round(num).toString();
}

/** 向后兼容别名 */
function formatNumber(num) { return fmtNum(num); }

// ==================== 统计面板 ====================
function updateStatsPanel(data) {
    const lastIdx = data.dates.length - 1;
    const prevIdx = Math.max(0, lastIdx - 1);
    const [, lastClose] = data.ohlc[lastIdx] || [0, 0];
    const [, prevClose] = data.ohlc[prevIdx] || [0, lastClose];
    const change    = lastClose - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;

    const stats = [
        { label: '最新收盘价', value: fmtPrice(lastClose),
          className: change >= 0 ? 'positive' : 'negative' },
        { label: '涨跌幅',
          value: (changePct >= 0 ? '+' : '') + fmtPct1(changePct),
          className: changePct >= 0 ? 'positive' : 'negative' },
        { label: '最新成交量',  value: fmtNum(data.volumes[lastIdx]) },
        { label: '最新持仓量',  value: fmtNum(data.oi[lastIdx]) },
        { label: '家人净持仓',  value: fmtNum(data.homieNet[lastIdx]),
          className: (data.homieNet[lastIdx] || 0) >= 0 ? 'positive' : 'negative' },
        { label: '机构净持仓',  value: fmtNum(data.instNet[lastIdx]),
          className: (data.instNet[lastIdx] || 0) >= 0 ? 'positive' : 'negative' },
        { label: 'IV',         value: fmtPct1(data.iv[lastIdx]) },
        { label: '期限结构',   value: fmtCB(data.cb[lastIdx]),
          className: (data.cb[lastIdx] || 0) >= 0 ? 'positive' : 'negative' }
    ];

    document.getElementById('stats-panel').innerHTML = stats.map(s => `
        <div class="stat-item">
            <div class="stat-label">${s.label}</div>
            <div class="stat-value ${s.className || ''}">${s.value}</div>
        </div>
    `).join('');
}

function updateDateRange(data) {
    if (!data || data.length === 0) return;
    const toDateStr = val => {
        if (typeof val === 'number') val = val.toString();
        val = String(val).replace(/-/g, '').split(' ')[0];
        if (val.length === 8)
            return `${val.substr(0,4)}-${val.substr(4,2)}-${val.substr(6,2)}`;
        return val;
    };
    const getD = r => r[''] || r['日期'] || r['date'];
    const firstStr = toDateStr(getD(data[0]));
    const lastStr  = toDateStr(getD(data[data.length - 1]));
    const si = document.getElementById('start-date');
    const ei = document.getElementById('end-date');
    si.min = firstStr; si.max = lastStr;
    ei.min = firstStr; ei.max = lastStr;
}

// ==================== 覆盖层辅助 ====================
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