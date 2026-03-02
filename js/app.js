// js/app.js

// ==================== 全局配置 ====================
const CONFIG = {
    dataPath: 'data/',
    charts: {},
    currentDates: [],
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
    initCharts();
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
}

// ==================== 联动 ====================
let _syncing = false;

function setupChartLinkage() {
    const chartList = Object.values(CONFIG.charts).filter(Boolean);

    // 注意：不再使用 echarts.connect 做缩放联动
    // 原因：echarts.connect 对 bar 系列图表的 dataZoom 同步有 bug
    // 改用手动监听 datazoom 事件，精确同步所有图表的 start/end

    chartList.forEach(src => {
        src.off('updateAxisPointer');
        src.off('globalout');
        src.off('datazoom');

        // ── 悬浮竖线联动 ──
        src.on('updateAxisPointer', (evt) => {
            if (_syncing) return;
            let idx = evt.dataIndex;
            if (typeof idx !== 'number') {
                const xInfo = evt.axesInfo && evt.axesInfo.find(a => a.axisDim === 'x');
                if (xInfo) {
                    const v = xInfo.value;
                    idx = typeof v === 'number' ? v : CONFIG.currentDates.indexOf(String(v));
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

        src.on('globalout', () => {
            if (_syncing) return;
            _syncing = true;
            chartList.forEach(tgt => tgt.dispatchAction({ type: 'hideTip' }));
            _syncing = false;
        });

        // ── 缩放联动（手动同步，解决成交量 bar 图不跟随的问题）──
        src.on('datazoom', (evt) => {
            if (_syncing) return;

            // 取当前图表 dataZoom 组件的 start/end
            let start, end;
            if (evt.batch && evt.batch.length > 0) {
                start = evt.batch[0].start;
                end   = evt.batch[0].end;
            } else {
                start = evt.start;
                end   = evt.end;
            }
            if (start === undefined || end === undefined) return;

            _syncing = true;
            chartList.forEach(tgt => {
                if (tgt === src) return;
                tgt.dispatchAction({
                    type:         'dataZoom',
                    dataZoomIndex: 0,
                    start,
                    end
                });
            });
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

        CONFIG.rawData = rawData;
        updateDateRange(rawData);

        const startDate = document.getElementById('start-date').value;
        const endDate   = document.getElementById('end-date').value;
        const filtered  = filterByDate(rawData, startDate, endDate);
        const chartData = processChartData(filtered);
        CONFIG.currentDates = chartData.dates;

        drawKlineChart(chartData);
        drawVolumeChart(chartData);
        drawOIChart(chartData);
        drawPositionChart(chartData);
        drawIVChart(chartData);
        drawCBChart(chartData);

        // 每次绘图后重新绑定（setOption notMerge 会重置事件）
        setupChartLinkage();

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
        let ds = row[''] || row['日期'] || row['date'];
        ds = String(typeof ds === 'number' ? ds : ds).split(' ')[0].replace(/-/g, '');
        // ★ 严格截取后6位，保证 yymmdd 格式
        dates.push(ds.length >= 6 ? ds.slice(-6) : ds);

        const open  = parseFloat(row['开盘价'] || row['open'])  || 0;
        const close = parseFloat(row['收盘价'] || row['close']) || 0;
        const low   = parseFloat(row['最低价'] || row['low'])   || 0;
        const high  = parseFloat(row['最高价'] || row['high'])  || 0;
        ohlc.push([open, close, low, high]);

        ma20.push(parseFloat(row['ma20'] || row['MA20']) || null);
        volumes.push(parseFloat(row['成交量'] || row['volume'] || row['vol']) || 0);
        oi.push(parseFloat(row['持仓量'] || row['oi']) || 0);
        oiChange.push((parseFloat(row['持仓量变幅']) || 0) * 100);

        homieNet.push((parseFloat(row['家人多头持仓量']) || 0) + (parseFloat(row['家人空头持仓量']) || 0));
        instNet.push((parseFloat(row['机构多头持仓量']) || 0) + (parseFloat(row['机构空头持仓量']) || 0));

        iv.push(parseFloat(row['IV']) || null);
        ivPct.push((parseFloat(row['IV_pct']) || 0) * 100);

        const cbVal = row['CB_index'];
        cb.push(cbVal !== undefined && cbVal !== '' && cbVal !== null ? parseFloat(cbVal) : null);
    });

    return { dates, ohlc, volumes, oi, oiChange, homieNet, instNet, iv, ivPct, cb, ma20 };
}

// ==================== 通用配置生成器 ====================

function makeXAxis(dates, showLabel) {
    return {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisTick:  { alignWithLabel: true },
        axisLine:  { onZero: false },
        axisLabel: showLabel
            ? {
                show: true,
                fontSize: 10,
                color: '#666',
                interval: Math.max(0, Math.floor(dates.length / 13) - 1),
                formatter: v => String(v)   // 原样输出 yymmdd
            }
            : { show: false }
    };
}

function makeGrid(extraBottom) {
    return {
        left:         CONFIG.grid.left,
        right:        CONFIG.grid.right,
        top:          CONFIG.grid.top,
        bottom:       CONFIG.grid.bottom + (extraBottom || 0),
        containLabel: false
    };
}

// 所有图表统一用 inside zoom，无 slider bar
function makeZoom() {
    return [{ type: 'inside', xAxisIndex: [0], start: 50, end: 100 }];
}

function makeSubTooltip(formatter) {
    return {
        trigger:      'axis',
        confine:      true,
        appendToBody: true,
        axisPointer: {
            type:      'line',
            lineStyle: { color: 'rgba(80,80,80,0.45)', type: 'dashed', width: 1 }
        },
        formatter
    };
}

// ==================== 绘图函数 ====================

function drawKlineChart(data) {
    // ★ 把 dates 数组注入闭包，dataIndex 取值保证是完整 yymmdd
    const dates = data.dates;

    CONFIG.charts.kline.setOption({
        title:  { text: '价格走势', left: 'center', textStyle: { fontSize: 16 } },
        legend: { data: ['K线', 'MA20'], top: 28 },
        grid:   makeGrid(),
        xAxis:  makeXAxis(dates, true),
        yAxis: {
            type: 'value', scale: true, splitArea: { show: true }, position: 'left',
            axisLabel: { fontSize: 11 }
        },
        dataZoom: makeZoom(),
        tooltip: {
            trigger:      'axis',
            confine:      true,
            appendToBody: true,
            axisPointer: {
                type:      'line',
                lineStyle: { color: 'rgba(80,80,80,0.45)', type: 'dashed', width: 1 }
            },
            formatter(params) {
                if (!params || !params.length) return '';
                const k = params.find(p => p.seriesName === 'K线');
                const m = params.find(p => p.seriesName === 'MA20');
                if (!k) return '';

                // ★ 用 dataIndex 从闭包 dates 里取，绝对是 yymmdd
                const idx     = k.dataIndex;
                const dateStr = (idx != null && dates[idx]) ? String(dates[idx]) : '';

                const [o, c, l, h] = k.value;
                const clr    = c >= o ? COLORS.up : COLORS.down;
                const chg    = o > 0 ? ((c - o) / o * 100) : 0;
                const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';

                return `<div style="font-size:12px;line-height:2;min-width:160px">
                    <div style="font-weight:700;border-bottom:1px solid #eee;padding-bottom:2px;margin-bottom:3px">${dateStr}</div>
                    <div>开&ensp;<b>${fmtPrice(o)}</b>&ensp;收&ensp;<b style="color:${clr}">${fmtPrice(c)}</b>&ensp;<span style="color:${clr};font-size:11px">${chgStr}</span></div>
                    <div>高&ensp;<b style="color:${COLORS.up}">${fmtPrice(h)}</b>&ensp;低&ensp;<b style="color:${COLORS.down}">${fmtPrice(l)}</b></div>
                    ${m && m.value != null
                        ? `<div>MA20&ensp;<b style="color:${COLORS.ma20}">${fmtPrice(m.value)}</b></div>`
                        : ''}
                </div>`;
            }
        },
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
        title:    { text: '成交量', left: 'center', textStyle: { fontSize: 14 } },
        grid:     makeGrid(),
        xAxis:    makeXAxis(data.dates, false),
        yAxis:    {
            type: 'value', splitArea: { show: true },
            axisLabel: { formatter: v => fmtNum(v), fontSize: 11 }
        },
        dataZoom: makeZoom(),
        tooltip:  makeSubTooltip((params) => {
            const p = params[0];
            if (!p) return '';
            return `<div style="font-size:12px;line-height:1.9">
                <span style="color:${COLORS.volume}">●</span>&nbsp;成交量&nbsp;<b>${fmtNum(p.value)}</b>
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
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const oiP = params.find(p => p.seriesName === '持仓量');
            const chP = params.find(p => p.seriesName === '持仓量变幅');
            return `<div style="font-size:12px;line-height:1.9">
                ${oiP ? `<span style="color:${COLORS.oi}">●</span>&nbsp;持仓量&nbsp;<b>${fmtNum(oiP.value)}</b><br/>` : ''}
                ${chP ? `<span style="color:${COLORS.oiChange}">●</span>&nbsp;持仓量变幅&nbsp;<b>${fmtPct1(chP.value)}</b>` : ''}
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
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const h = params.find(p => p.seriesName === '家人净持仓');
            const i = params.find(p => p.seriesName === '机构净持仓');
            return `<div style="font-size:12px;line-height:1.9">
                ${h ? `<span style="color:${COLORS.homie}">●</span>&nbsp;家人净持仓&nbsp;<b>${fmtNum(h.value)}</b><br/>` : ''}
                ${i ? `<span style="color:${COLORS.inst}">●</span>&nbsp;机构净持仓&nbsp;<b>${fmtNum(i.value)}</b>` : ''}
            </div>`;
        }),
        series: [
            {
                name: '家人净持仓', type: 'line', data: data.homieNet,
                lineStyle: { color: COLORS.homie, width: 2 }, symbol: 'circle', symbolSize: 3,
                markLine: {
                    silent: true, symbol: 'none',
                    data: [{ yAxis: 0 }],
                    lineStyle: { color: '#333', type: 'dashed', width: 1.5 }
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
                axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 }
            },
            {
                type: 'value', name: '分位数(%)', position: 'right',
                min: 0, max: 100, splitLine: { show: false },
                axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 }
            }
        ],
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const ivP    = params.find(p => p.seriesName === 'IV');
            const ivPctP = params.find(p => p.seriesName === 'IV60日分位数');
            return `<div style="font-size:12px;line-height:1.9">
                ${ivP    ? `<span style="color:${COLORS.iv}">●</span>&nbsp;IV&nbsp;<b>${fmtPct1(ivP.value)}</b><br/>` : ''}
                ${ivPctP ? `<span style="color:${COLORS.ivPct}">●</span>&nbsp;IV分位数&nbsp;<b>${fmtPct1(ivPctP.value)}</b>` : ''}
            </div>`;
        }),
        series: [
            {
                name: 'IV', type: 'line', data: data.iv,
                lineStyle: { color: COLORS.iv, width: 2 }, symbol: 'circle', symbolSize: 3,
                connectNulls: true
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
        title:    { text: '期限结构分数', left: 'center', textStyle: { fontSize: 14 } },
        grid:     makeGrid(),
        xAxis:    makeXAxis(data.dates, false),
        yAxis:    {
            type: 'value', splitArea: { show: true },
            axisLabel: { formatter: v => v.toFixed(2), fontSize: 11 }
        },
        dataZoom: makeZoom(),
        tooltip:  makeSubTooltip((params) => {
            const p = params[0];
            if (!p) return '';
            return `<div style="font-size:12px;line-height:1.9">
                <span style="color:${COLORS.cb}">●</span>&nbsp;期限结构分数&nbsp;<b>${fmtCB(p.value)}</b>
            </div>`;
        }),
        series: [{
            name: '期限结构', type: 'line', data: data.cb,
            lineStyle: { color: COLORS.cb, width: 2 }, symbol: 'circle', symbolSize: 3,
            connectNulls: true,
            markLine: {
                silent: true, symbol: 'none',
                data: [{ yAxis: 0 }],
                lineStyle: { color: '#999', type: 'dashed', width: 1.5 }
            }
        }]
    }, { notMerge: true });
}

// ==================== 格式化工具 ====================

function fmtPrice(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(2);
}
function fmtPct1(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(1) + '%';
}
function fmtCB(v) {
    if (v == null || isNaN(v)) return '-';
    return Number(v).toFixed(2);
}
function fmtNum(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const abs = Math.abs(num);
    if (abs >= 1e8) return (num / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return (num / 1e4).toFixed(2) + '万';
    return Math.round(num).toString();
}
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
        { label: '最新收盘价', value: fmtPrice(lastClose),   className: change >= 0 ? 'positive' : 'negative' },
        { label: '涨跌幅',     value: (changePct >= 0 ? '+' : '') + fmtPct1(changePct), className: changePct >= 0 ? 'positive' : 'negative' },
        { label: '最新成交量', value: fmtNum(data.volumes[lastIdx]) },
        { label: '最新持仓量', value: fmtNum(data.oi[lastIdx]) },
        { label: '家人净持仓', value: fmtNum(data.homieNet[lastIdx]), className: (data.homieNet[lastIdx] || 0) >= 0 ? 'positive' : 'negative' },
        { label: '机构净持仓', value: fmtNum(data.instNet[lastIdx]),  className: (data.instNet[lastIdx]  || 0) >= 0 ? 'positive' : 'negative' },
        { label: 'IV',         value: fmtPct1(data.iv[lastIdx]) },
        { label: '期限结构',   value: fmtCB(data.cb[lastIdx]),        className: (data.cb[lastIdx] || 0) >= 0 ? 'positive' : 'negative' }
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
        val = String(typeof val === 'number' ? val : val).replace(/-/g, '').split(' ')[0];
        if (val.length === 8) return `${val.substr(0,4)}-${val.substr(4,2)}-${val.substr(6,2)}`;
        return val;
    };
    const getD  = r => r[''] || r['日期'] || r['date'];
    const first = toDateStr(getD(data[0]));
    const last  = toDateStr(getD(data[data.length - 1]));
    const si = document.getElementById('start-date');
    const ei = document.getElementById('end-date');
    si.min = first; si.max = last;
    ei.min = first; ei.max = last;
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