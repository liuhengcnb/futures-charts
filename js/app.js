// ==================== 全局配置 ====================
const CONFIG = {
    dataPath: 'data/',
    charts: {},
    currentDates: [],
    grid: { left: 85, right: 85, top: 50, bottom: 30 }
};

// 颜色配置（中国市场惯例：红涨绿跌）
const COLORS = {
    up:       '#ef5350',
    down:     '#26a69a',
    ma20:     '#FF6D00',
    volume:   '#78909c',
    oi:       '#42a5f5',
    oiChange: '#FF6D00',
    homie:    '#9C27B0',
    inst:     '#ef5350',
    iv:       '#00BCD4',
    ivPct:    '#66bb6a',
    cb:       '#8d6e63',
    trend:    '#5C6BC0'
};

// ==================== 自定义合约顺序 ====================
const CONTRACT_ORDER = [
    '欧线EC','碳酸锂LC','氧化铝AO','三十年国债TL','生猪LH','烧碱SH',
    'LPGPG','苯乙烯EB','焦煤JM','豆一A','沥青BU','中证1000IM',
    '工业硅SI','白糖SR','尿素UR','玻璃FG','塑料L','硅铁SF',
    '纸浆SP','纯碱SA','乙二醇EG','棉花CF','不锈钢SS','豆粕M',
    '红枣CJ','二年国债TS','聚丙烯PP','20号胶NR','苹果AP','沪锡SN',
    '橡胶RU','锰硅SM','螺纹钢RB','焦炭J','玉米C','沪铝AL',
    '铁矿石I','原油SC','五年国债TF','甲醇MA','菜粕RM','十年国债T',
    'PVCV','鸡蛋JD','棕榈油P','PTATA','豆油Y','沪银AG','沪铅PB',
    '沪深300IF','菜油OI','沪金AU','沪铜CU','沪锌ZN','燃油FU','沪镍NI'
];

// ==================== 日期工具 ====================

function toDigits8(raw) {
    if (!raw) return '';
    return String(raw).replace(/\s/g, '').replace(/[-\/]/g, '');
}

function toCatDate(raw) {
    const d = toDigits8(raw);
    if (d.length < 8) return d;
    return `${d.substr(2,2)}-${d.substr(4,2)}-${d.substr(6,2)}`;
}

function toDisplay(catVal) {
    return String(catVal || '').replace(/[-\/]/g, '').trim();
}

function toFullDate(raw) {
    const d = toDigits8(raw);
    if (d.length === 8)
        return `${d.substr(0,4)}-${d.substr(4,2)}-${d.substr(6,2)}`;
    return d;
}

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

        // 按自定义顺序排序，不在列表中的排到最后
        const orderMap = {};
        CONTRACT_ORDER.forEach((name, idx) => { orderMap[name] = idx; });

        const sorted = [...files].sort((a, b) => {
            const ia = orderMap[a.display_name] !== undefined ? orderMap[a.display_name] : 9999;
            const ib = orderMap[b.display_name] !== undefined ? orderMap[b.display_name] : 9999;
            return ia - ib;
        });

        sorted.forEach(f => {
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
    ['kline', 'volume', 'oi', 'trend', 'position', 'iv', 'cb'].forEach(key => {
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

    chartList.forEach(src => {
        src.off('updateAxisPointer');
        src.off('globalout');
        src.off('datazoom');

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

        src.on('datazoom', (evt) => {
            if (_syncing) return;
            let start, end;
            if (evt.batch && evt.batch.length > 0) {
                start = evt.batch[0].start; end = evt.batch[0].end;
            } else {
                start = evt.start; end = evt.end;
            }
            if (start === undefined || end === undefined) return;
            _syncing = true;
            chartList.forEach(tgt => {
                if (tgt === src) return;
                tgt.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start, end });
            });
            _syncing = false;
        });
    });
}

// ==================== 数据加载 ====================

function getRawDate(row) {
    for (const key of Object.keys(row)) {
        const k = key.replace(/^\uFEFF/, '').trim();
        if (k === '' || k === '日期' || k === 'date') return row[key];
    }
    return null;
}

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
        drawTrendChart(chartData);
        drawPositionChart(chartData);
        drawIVChart(chartData);
        drawCBChart(chartData);

        setupChartLinkage();
        hideOverlay();
    } catch (e) {
        console.error('加载失败:', e);
        showError('加载数据失败: ' + e.message);
    }
}

function filterByDate(rawData, startDate, endDate) {
    if (!startDate && !endDate) return rawData;
    return rawData.filter(row => {
        const raw = getRawDate(row);
        if (!raw) return true;
        const full = toFullDate(raw);
        if (startDate && full < startDate) return false;
        if (endDate   && full > endDate)   return false;
        return true;
    });
}

function processChartData(rawData) {
    const dates = [], ohlc = [], volumes = [], oi = [], oiChange = [];
    const homieNet = [], instNet = [], iv = [], ivPct = [], cb = [], ma20 = [];
    const trend = [];

    rawData.forEach(row => {
        dates.push(toCatDate(getRawDate(row)));

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
        cb.push(cbVal != null && cbVal !== '' ? parseFloat(cbVal) : null);

        const tVal = row['趋势排名分位数'];
        if (tVal != null && tVal !== '') {
            const tv = parseFloat(tVal);
            trend.push(Math.abs(tv) <= 1 ? tv * 100 : tv);
        } else {
            trend.push(null);
        }
    });

    return { dates, ohlc, volumes, oi, oiChange, homieNet, instNet, iv, ivPct, cb, ma20, trend };
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
                formatter: v => toDisplay(v)
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

function makeZoom() {
    return [{ type: 'inside', xAxisIndex: [0], start: 50, end: 100 }];
}

function makeSubTooltip(bodyFormatter) {
    return {
        trigger:      'axis',
        confine:      true,
        appendToBody: true,
        axisPointer: {
            type:      'line',
            lineStyle: { color: 'rgba(80,80,80,0.45)', type: 'dashed', width: 1 }
        },
        formatter(params) {
            if (!params || !params.length) return '';
            const dateStr = toDisplay(params[0].axisValue);
            const header  = `<div style="font-weight:700;border-bottom:1px solid #eee;padding-bottom:2px;margin-bottom:3px">${dateStr}</div>`;
            const body    = bodyFormatter(params);
            return `<div style="font-size:12px;line-height:2;min-width:130px">${header}${body}</div>`;
        }
    };
}

// ==================== 绘图函数 ====================

function drawKlineChart(data) {
    CONFIG.charts.kline.setOption({
        title:  { text: '价格走势', left: 'center', textStyle: { fontSize: 16 } },
        legend: { data: ['K线', 'MA20'], top: 28 },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, true),
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
                if (!k || !Array.isArray(k.value)) return '';

                const dateStr = toDisplay(params[0].axisValue);
                const open  = k.value[0];
                const close = k.value[1];
                const low   = k.value[2];
                const high  = k.value[3];

                const clr    = close >= open ? COLORS.up : COLORS.down;
                const chg    = open > 0 ? ((close - open) / open * 100) : 0;
                const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';

                return `<div style="font-size:12px;line-height:2;min-width:170px">
                    <div style="font-weight:700;border-bottom:1px solid #eee;padding-bottom:2px;margin-bottom:3px">${dateStr}</div>
                    <div>开&ensp;<b>${fmtPrice(open)}</b>&ensp;收&ensp;<b style="color:${clr}">${fmtPrice(close)}</b>&ensp;<span style="color:${clr};font-size:11px">${chgStr}</span></div>
                    <div>高&ensp;<b style="color:${COLORS.up}">${fmtPrice(high)}</b>&ensp;低&ensp;<b style="color:${COLORS.down}">${fmtPrice(low)}</b></div>
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
        yAxis:    { type: 'value', splitArea: { show: true }, axisLabel: { formatter: v => fmtNum(v), fontSize: 11 } },
        dataZoom: makeZoom(),
        tooltip:  makeSubTooltip((params) => {
            const p = params[0];
            if (!p) return '';
            return `<span style="color:${COLORS.volume}">●</span>&nbsp;成交量&nbsp;<b>${fmtNum(p.value)}</b>`;
        }),
        series: [{ name: '成交量', type: 'bar', data: data.volumes, itemStyle: { color: COLORS.volume }, barMaxWidth: 8 }]
    }, { notMerge: true });
}

function drawOIChart(data) {
    CONFIG.charts.oi.setOption({
        title:  { text: '持仓量 & 变幅', left: 'center', textStyle: { fontSize: 14 } },
        legend: { data: ['持仓量', '持仓量变幅'], top: 25 },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis: [
            { type: 'value', name: '持仓量', position: 'left', splitArea: { show: true }, axisLabel: { formatter: v => fmtNum(v), fontSize: 11 } },
            { type: 'value', name: '变幅(%)', position: 'right', splitLine: { show: false }, axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 } }
        ],
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const oiP = params.find(p => p.seriesName === '持仓量');
            const chP = params.find(p => p.seriesName === '持仓量变幅');
            return [
                oiP ? `<span style="color:${COLORS.oi}">●</span>&nbsp;持仓量&nbsp;<b>${fmtNum(oiP.value)}</b>` : '',
                chP ? `<span style="color:${COLORS.oiChange}">●</span>&nbsp;持仓量变幅&nbsp;<b>${fmtPct1(chP.value)}</b>` : ''
            ].filter(Boolean).join('<br/>');
        }),
        series: [
            { name: '持仓量', type: 'bar', data: data.oi, itemStyle: { color: COLORS.oi }, barMaxWidth: 8 },
            {
                name: '持仓量变幅', type: 'line', yAxisIndex: 1, data: data.oiChange,
                lineStyle: { color: COLORS.oiChange, width: 2 }, symbol: 'circle', symbolSize: 3,
                markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: '#ef5350', type: 'dashed', width: 1.5 } }
            }
        ]
    }, { notMerge: true });
}

function drawTrendChart(data) {
    const hasData = data.trend.some(v => v !== null && !isNaN(v));
    const el = document.getElementById('chart-trend');
    if (el) el.style.display = hasData ? '' : 'none';
    if (!hasData || !CONFIG.charts.trend) return;

    CONFIG.charts.trend.setOption({
        title:  { text: '趋势排名分位数', left: 'center', textStyle: { fontSize: 14 } },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis: {
            type: 'value',
            min: 0,
            max: 100,
            splitArea: { show: true },
            axisLabel: { formatter: v => v.toFixed(0) + '%', fontSize: 11 },
            splitLine: { show: true }
        },
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const p = params[0];
            if (!p || p.value == null) return '';
            return `<span style="color:${COLORS.trend}">●</span>&nbsp;趋势排名分位数&nbsp;<b>${fmtPct1(p.value)}</b>`;
        }),
        series: [{
            name: '趋势排名分位数',
            type: 'line',
            data: data.trend,
            connectNulls: true,
            lineStyle: { color: COLORS.trend, width: 2 },
            itemStyle: { color: COLORS.trend },
            symbol:     'circle',
            symbolSize: 10,
            markLine: {
                silent:   true,
                symbol:   'none',
                label:    { show: true, position: 'insideEndTop', fontSize: 10 },
                lineStyle: { type: 'dashed', width: 1 },
                data: [
                    { yAxis: 80, name: '80%', lineStyle: { color: COLORS.up   } },
                    { yAxis: 20, name: '20%', lineStyle: { color: COLORS.down } }
                ]
            }
        }]
    }, { notMerge: true });

    CONFIG.charts.trend.resize();
}

function drawPositionChart(data) {
    CONFIG.charts.position.setOption({
        title:  { text: '家人 & 机构净持仓', left: 'center', textStyle: { fontSize: 14 } },
        legend: {
            data: [
                { name: '家人净持仓', itemStyle: { color: COLORS.homie }, lineStyle: { color: COLORS.homie } },
                { name: '机构净持仓', itemStyle: { color: COLORS.inst  }, lineStyle: { color: COLORS.inst  } }
            ],
            top: 25
        },
        grid:   makeGrid(),
        xAxis:  makeXAxis(data.dates, false),
        yAxis:  { type: 'value', splitArea: { show: true }, axisLabel: { formatter: v => fmtNum(v), fontSize: 11 } },
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const h = params.find(p => p.seriesName === '家人净持仓');
            const i = params.find(p => p.seriesName === '机构净持仓');
            return [
                h ? `<span style="color:${COLORS.homie}">●</span>&nbsp;家人净持仓&nbsp;<b>${fmtNum(h.value)}</b>` : '',
                i ? `<span style="color:${COLORS.inst}">●</span>&nbsp;机构净持仓&nbsp;<b>${fmtNum(i.value)}</b>` : ''
            ].filter(Boolean).join('<br/>');
        }),
        series: [
            {
                name: '家人净持仓', type: 'line', data: data.homieNet,
                lineStyle: { color: COLORS.homie, width: 2 }, itemStyle: { color: COLORS.homie }, symbol: 'circle', symbolSize: 3,
                markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: '#333', type: 'dashed', width: 1.5 } }
            },
            {
                name: '机构净持仓', type: 'line', data: data.instNet,
                lineStyle: { color: COLORS.inst, width: 2 }, itemStyle: { color: COLORS.inst }, symbol: 'circle', symbolSize: 3
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
            { type: 'value', name: 'IV', position: 'left', splitArea: { show: true }, axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 } },
            { type: 'value', name: '分位数(%)', position: 'right', min: 0, max: 100, splitLine: { show: false }, axisLabel: { formatter: v => v.toFixed(1) + '%', fontSize: 11 } }
        ],
        dataZoom: makeZoom(),
        tooltip: makeSubTooltip((params) => {
            const ivP    = params.find(p => p.seriesName === 'IV');
            const ivPctP = params.find(p => p.seriesName === 'IV60日分位数');
            return [
                ivP    ? `<span style="color:${COLORS.iv}">●</span>&nbsp;IV&nbsp;<b>${fmtPct1(ivP.value)}</b>` : '',
                ivPctP ? `<span style="color:${COLORS.ivPct}">●</span>&nbsp;IV分位数&nbsp;<b>${fmtPct1(ivPctP.value)}</b>` : ''
            ].filter(Boolean).join('<br/>');
        }),
        series: [
            { name: 'IV', type: 'line', data: data.iv, lineStyle: { color: COLORS.iv, width: 2 }, itemStyle: { color: COLORS.iv }, symbol: 'circle', symbolSize: 3, connectNulls: true },
            { name: 'IV60日分位数', type: 'line', yAxisIndex: 1, data: data.ivPct, lineStyle: { color: COLORS.ivPct, width: 2, type: 'dashed' }, itemStyle: { color: COLORS.ivPct }, symbol: 'circle', symbolSize: 3 }
        ]
    }, { notMerge: true });
}

function drawCBChart(data) {
    CONFIG.charts.cb.setOption({
        title:    { text: '期限结构分数', left: 'center', textStyle: { fontSize: 14 } },
        grid:     makeGrid(),
        xAxis:    makeXAxis(data.dates, false),
        yAxis:    { type: 'value', splitArea: { show: true }, axisLabel: { formatter: v => v.toFixed(2), fontSize: 11 } },
        dataZoom: makeZoom(),
        tooltip:  makeSubTooltip((params) => {
            const p = params[0];
            if (!p) return '';
            return `<span style="color:${COLORS.cb}">●</span>&nbsp;期限结构分数&nbsp;<b>${fmtCB(p.value)}</b>`;
        }),
        series: [{
            name: '期限结构', type: 'line', data: data.cb,
            lineStyle: { color: COLORS.cb, width: 2 }, itemStyle: { color: COLORS.cb }, symbol: 'circle', symbolSize: 3, connectNulls: true,
            markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: '#999', type: 'dashed', width: 1.5 } }
        }]
    }, { notMerge: true });
}

// ==================== 格式化工具 ====================
function fmtPrice(v) { return (v == null || isNaN(v)) ? '-' : Number(v).toFixed(2); }
function fmtPct1(v)  { return (v == null || isNaN(v)) ? '-' : Number(v).toFixed(1) + '%'; }
function fmtCB(v)    { return (v == null || isNaN(v)) ? '-' : Number(v).toFixed(2); }
function fmtNum(num) {
    if (num == null || isNaN(num)) return '-';
    const abs = Math.abs(num);
    if (abs >= 1e8) return (num / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return (num / 1e4).toFixed(2) + '万';
    return Math.round(num).toString();
}



function updateDateRange(data) {
    if (!data || !data.length) return;
    const first = toFullDate(getRawDate(data[0]));
    const last  = toFullDate(getRawDate(data[data.length - 1]));
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