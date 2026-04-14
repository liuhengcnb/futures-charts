// ==================== 全局配置 ====================
const CONFIG = {
    dataPath:            'data/行情图表数据/',
    seatDataPath:        'data/席位数据/',
    charts:              {},
    currentDates:        [],
    grid:                { left: 85, right: 85, top: 50, bottom: 30 },
    currentContractName: '',
    klineVisibleSeries:  ['K线', 'DKX', 'MADKX'],
    currentTab:          'chart',   // 'chart' | 'seat'
    currentSeatData:     null
};

const COLORS = {
    up:'#ef5350', down:'#26a69a', ma20:'#2196F3', ma5:'#FFA726',
    dkx:'#FF6D00', madkx:'#9C27B0', volume:'#78909c', volMa10:'#FFB74D',
    volAmp:'#FF0000', oi:'#42a5f5', oiChange:'#FF6D00', homie:'#9C27B0',
    inst:'#ef5350', iv:'#00BCD4', ivPct:'#66bb6a', ivUp:'#FF0000',
    cb:'#8d6e63', cbHistPct:'#26C6DA', trend:'#5C6BC0', trendHist:'#43A047',
    atrMA14:'#FF5722', atr60D60Pct:'#00BCD4', stopLoss:'#E91E63'
};

const Contract_ORDER = [
    '欧线EC','碳酸锂LC','氧化铝AO','三十年国债TL','生猪LH','烧碱SH',
    'LPGPG','苯乙烯EB','焦煤JM','豆一A','沥青BU','中证1000IM',
    '工业硅SI','多晶硅PS','白糖SR','尿素UR','玻璃FG','塑料L','硅铁SF',
    '纸浆SP','纯碱SA','乙二醇EG','棉花CF','不锈钢SS','豆粕M',
    '红枣CJ','二年国债TS','聚丙烯PP','20号胶NR','苹果AP','沪锡SN',
    '橡胶RU','锰硅SM','螺纹钢RB','焦炭J','玉米C','沪铝AL',
    '铁矿石I','原油SC','五年国债TF','甲醇MA','菜粕RM','十年国债T',
    'PVCV','鸡蛋JD','棕榈油P','PTATA','豆油Y','沪银AG','沪铅PB',
    '沪深300IF','菜油OI','沪金AU','沪铜CU','沪锌ZN','燃油FU','沪镍NI'
];

// ==================== 日期工具 ====================
function toDigits8(raw) { if(!raw)return''; return String(raw).replace(/\s/g,'').replace(/[-\/]/g,''); }
function toCatDate(raw) { const d=toDigits8(raw); if(d.length<8)return d; return `${d.substr(2,2)}-${d.substr(4,2)}-${d.substr(6,2)}`; }
function toDisplay(v) { return String(v||'').replace(/[-\/]/g,'').trim(); }
function toFullDate(raw) { const d=toDigits8(raw); return d.length===8?`${d.substr(0,4)}-${d.substr(4,2)}-${d.substr(6,2)}`:d; }

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    await initContractSelect();
    initEventListeners();
    initCharts();
    const select = document.getElementById('contract-select');
    if (select.options.length > 0) { select.selectedIndex = 0; await loadChartData(select.value); }
});

async function initContractSelect() {
    const select = document.getElementById('contract-select');
    select.innerHTML = '<option value="">加载中...</option>';
    try {
        const resp = await fetch(CONFIG.dataPath + 'manifest.json');
        if (!resp.ok) throw new Error('未找到 manifest.json');
        const files = await resp.json();
        select.innerHTML = '';
        const orderMap = {};
        Contract_ORDER.forEach((n,i) => { orderMap[n]=i; });
        [...files].sort((a,b) => {
            const ia = orderMap[a.display_name]??9999, ib = orderMap[b.display_name]??9999;
            return ia-ib;
        }).forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.filename; opt.textContent = f.display_name;
            select.appendChild(opt);
        });
    } catch(e) { console.error(e); select.innerHTML = '<option value="">加载失败</option>'; }
}

function initEventListeners() {
    document.getElementById('contract-select').addEventListener('change', async (e) => {
        if (!e.target.value) return;
        const opt = e.target.options[e.target.selectedIndex];
        CONFIG.currentContractName = opt ? opt.textContent : '';
        if (CONFIG.currentTab === 'chart') await loadChartData(e.target.value);
        else await loadAndRenderSeat();
    });
    document.getElementById('update-btn').addEventListener('click', async () => {
        const sel = document.getElementById('contract-select');
        if (!sel.value) return;
        if (CONFIG.currentTab === 'chart') await loadChartData(sel.value);
        else await loadAndRenderSeat();
    });
    document.getElementById('reset-btn').addEventListener('click', () => {
        document.getElementById('start-date').value = '';
        document.getElementById('end-date').value   = '';
        const sel = document.getElementById('contract-select');
        if (sel.value && CONFIG.currentTab === 'chart') loadChartData(sel.value);
    });
}

function initCharts() {
    ['kline','volume','oi','atr','trend','position','iv','cb'].forEach(k => {
        const el = document.getElementById(`chart-${k}`);
        if (el) CONFIG.charts[k] = echarts.init(el);
    });
    window.addEventListener('resize', () => Object.values(CONFIG.charts).forEach(c => c&&c.resize()));
}

// ==================== Tab 切换 ====================
function switchTab(tab) {
    CONFIG.currentTab = tab;
    document.getElementById('tab-chart').classList.toggle('active', tab==='chart');
    document.getElementById('tab-seat').classList.toggle('active',  tab==='seat');
    document.getElementById('charts-container').style.display = tab==='chart' ? '' : 'none';
    document.getElementById('seat-container').style.display   = tab==='seat'  ? '' : 'none';
    document.getElementById('date-controls').style.display    = tab==='chart' ? '' : 'none';
    if (tab === 'seat' && CONFIG.currentContractName) loadAndRenderSeat();
}

// ==================== 联动 ====================
let _syncing = false;
function setupChartLinkage() {
    const cl = Object.values(CONFIG.charts).filter(Boolean);
    cl.forEach(src => {
        src.off('updateAxisPointer'); src.off('globalout'); src.off('datazoom');
        src.on('updateAxisPointer', evt => {
            if (_syncing) return;
            let idx = evt.dataIndex;
            if (typeof idx !== 'number') {
                const xi = evt.axesInfo&&evt.axesInfo.find(a=>a.axisDim==='x');
                if (xi) { const v=xi.value; idx=typeof v==='number'?v:CONFIG.currentDates.indexOf(String(v)); }
            }
            if (typeof idx !== 'number' || idx < 0) return;
            _syncing = true; cl.forEach(t => { if(t!==src) t.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:idx}); }); _syncing=false;
        });
        src.on('globalout', () => { if(_syncing)return; _syncing=true; cl.forEach(t=>t.dispatchAction({type:'hideTip'})); _syncing=false; });
        src.on('datazoom', evt => {
            if (_syncing) return;
            let s,e;
            if (evt.batch&&evt.batch.length>0){s=evt.batch[0].start;e=evt.batch[0].end;}else{s=evt.start;e=evt.end;}
            if (s===undefined||e===undefined) return;
            _syncing=true; cl.forEach(t=>{if(t!==src)t.dispatchAction({type:'dataZoom',dataZoomIndex:0,start:s,end:e});}); _syncing=false;
        });
    });
}

// ==================== 行情数据加载 ====================
function getRawDate(row) {
    for (const key of Object.keys(row)) {
        const k = key.replace(/^\uFEFF/,'').trim();
        if (k===''||k==='日期'||k==='date') return row[key];
    }
    return null;
}

async function loadChartData(filename) {
    showLoading();
    try {
        const resp = await fetch(CONFIG.dataPath + filename);
        if (!resp.ok) throw new Error('文件不存在');
        const rawData = CSVParser.parse(await resp.text());
        if (!rawData||rawData.length===0) throw new Error('数据为空');
        CONFIG.rawData = rawData;
        updateDateRange(rawData);
        const sel = document.getElementById('contract-select');
        CONFIG.currentContractName = (sel.options[sel.selectedIndex]||{}).textContent || '';
        const filtered  = filterByDate(rawData, document.getElementById('start-date').value, document.getElementById('end-date').value);
        const chartData = processChartData(filtered);
        CONFIG.currentDates = chartData.dates;
        drawKlineChart(chartData); drawVolumeChart(chartData); drawOIChart(chartData);
        drawATRChart(chartData);   drawTrendChart(chartData);  drawPositionChart(chartData);
        drawIVChart(chartData);    drawCBChart(chartData);
        setupChartLinkage(); hideOverlay();
    } catch(e) { console.error(e); showError('加载数据失败: '+e.message); }
}

function filterByDate(rawData, startDate, endDate) {
    if (!startDate&&!endDate) return rawData;
    return rawData.filter(row => {
        const full = toFullDate(getRawDate(row));
        if (startDate&&full<startDate) return false;
        if (endDate&&full>endDate) return false;
        return true;
    });
}

function parsePctField(val) {
    if (val==null||val==='') return null;
    const v = parseFloat(val); if(isNaN(v)) return null;
    return Math.abs(v)<=1 ? v*100 : v;
}

function processChartData(rawData) {
    const dates=[],ohlc=[],volumes=[],oi=[],oiChange=[],homieNet=[],instNet=[],
          iv=[],ivPct=[],cb=[],cbHistPct=[],ma20=[],trendCS=[],trendHist=[],
          ma5=[],dkx=[],madkx=[],volMa10=[],volAmplify=[],ivUpSignal=[],
          atrMA14=[],atr60D60Pct=[],stopLossWidth=[];
    rawData.forEach((row,idx) => {
        dates.push(toCatDate(getRawDate(row)));
        ohlc.push([parseFloat(row['开盘价']||row['open'])||0, parseFloat(row['收盘价']||row['close'])||0,
                   parseFloat(row['最低价']||row['low'])||0,   parseFloat(row['最高价']||row['high'])||0]);
        ma20.push(parseFloat(row['ma20']||row['MA20'])||null);
        ma5.push(parseFloat(row['ma5']||row['MA5'])||null);
        dkx.push(parseFloat(row['DKX'])||null);
        madkx.push(parseFloat(row['MADKX'])||null);
        volumes.push(parseFloat(row['成交量']||row['volume']||row['vol'])||0);
        volMa10.push(parseFloat(row['成交量MA10']||row['vol_ma10'])||null);
        const va=parseFloat(row['成交量放大信号']); if(!isNaN(va)&&va!==0) volAmplify.push([idx,va]);
        oi.push(parseFloat(row['持仓量']||row['oi'])||0);
        oiChange.push((parseFloat(row['持仓量变幅'])||0)*100);
        homieNet.push((parseFloat(row['家人多头持仓量'])||0)+(parseFloat(row['家人空头持仓量'])||0));
        instNet.push((parseFloat(row['机构多头持仓量'])||0)+(parseFloat(row['机构空头持仓量'])||0));
        iv.push(parseFloat(row['IV'])||null);
        ivPct.push((parseFloat(row['IV_pct'])||0)*100);
        const iu=parseFloat(row['IV上涨信号']); if(!isNaN(iu)&&iu!==0) ivUpSignal.push([idx,iu]);
        const cbv=row['CB_index']; cb.push(cbv!=null&&cbv!==''?parseFloat(cbv):null);
        cbHistPct.push(parsePctField(row['CB_index历史分位数']));
        trendCS.push(parsePctField(row['趋势横截面分位数']!=null?row['趋势横截面分位数']:row['趋势排名分位数']));
        trendHist.push(parsePctField(row['趋势历史分位数']));
        atrMA14.push(parseFloat(row['ATRMA14'])||null);
        atr60D60Pct.push(parseFloat(row['ATR60D60pct'])||null);
        stopLossWidth.push(parseFloat(row['推荐止损宽度'])||null);
    });
    return {dates,ohlc,volumes,volMa10,volAmplify,oi,oiChange,homieNet,instNet,
            iv,ivPct,ivUpSignal,cb,cbHistPct,ma20,ma5,dkx,madkx,trendCS,trendHist,
            atrMA14,atr60D60Pct,stopLossWidth};
}

// ==================== 席位数据加载与渲染 ====================
async function loadAndRenderSeat() {
    const name      = CONFIG.currentContractName;
    const container = document.getElementById('seat-container');
    if (!name) { container.innerHTML='<p class="seat-msg">请先选择合约</p>'; return; }
    container.innerHTML='<p class="seat-msg" style="color:#667eea">加载席位数据…</p>';
    try {
        const safe = name.replace(/[\/\s]/g,'_');
        const resp = await fetch(`${CONFIG.seatDataPath}${encodeURIComponent(safe)}.json`);
        if (!resp.ok) throw new Error('暂无席位数据（请先运行 Python 导出步骤）');
        const data = await resp.json();
        CONFIG.currentSeatData = data;
        container.innerHTML = buildSeatHTML(data);
    } catch(e) { container.innerHTML=`<p class="seat-msg" style="color:#dc3545">${e.message}</p>`; }
}

function fmtSeatVal(v) {
    if (v===null||v===undefined) return '';
    const abs = Math.abs(v);
    if (abs>=10000) return (v/10000).toFixed(1)+'万';
    return v.toLocaleString('zh-CN');
}

// 格式化日期 YYYYMMDD → YY-MM-DD
function fmtSeatDate(d) {
    const s = String(d);
    return s.length===8 ? `${s.substr(2,2)}-${s.substr(4,2)}-${s.substr(6,2)}` : s;
}

/**
 * 构建单张席位表 HTML
 */
function buildSeatTableBlock(title, dates, shortSeats, longSeats, matrix, colorScheme) {
    const allSeats = [...shortSeats, ...longSeats];
    const nShort   = shortSeats.length;
    const nLong    = longSeats.length;

    const colMax = {};
    allSeats.forEach(s => {
        const vals = (matrix[s]||[]).filter(v=>v!==null&&!isNaN(v));
        colMax[s] = vals.length ? Math.max(...vals.map(Math.abs)) : 1;
    });

    const shortBg = colorScheme==='alt' ? 'rgba(156,39,176,0.10)' : 'rgba(239,83,80,0.10)';
    const longBg  = colorScheme==='alt' ? 'rgba(67,160,71,0.10)'  : 'rgba(38,166,154,0.10)';
    const latestDate = dates.length ? fmtSeatDate(dates[dates.length-1]) : '';

    let h = `<div class="seat-block">`;
    if (title) h += `<div class="seat-block-title">${title}</div>`;
    h += `<div class="seat-scroll-wrap"><table class="seat-table"><thead>
        <tr>
          <th class="st-corner" rowspan="2">${latestDate}<br><span class="st-corner-sub">最新→上</span></th>
          ${nShort>0?`<th class="st-group" colspan="${nShort}" style="background:${shortBg}">净空单前 ${nShort}</th>`:''}
          ${nLong>0 ?`<th class="st-group" colspan="${nLong}"  style="background:${longBg}">净多单前 ${nLong}</th>`:''}
        </tr><tr>
          ${shortSeats.map(s=>`<th class="st-seat" style="background:${shortBg}">${s}</th>`).join('')}
          ${longSeats.map(s =>`<th class="st-seat" style="background:${longBg}">${s}</th>`).join('')}
        </tr>
    </thead><tbody>`;

    [...dates].reverse().forEach((date, ri) => {
        const di      = dates.length - 1 - ri;
        const isLatest = ri === 0;
        h += `<tr${isLatest?' class="st-row-latest"':''}>`;
        h += `<td class="st-date">${fmtSeatDate(date)}</td>`;
        allSeats.forEach(seat => {
            const val = (matrix[seat]||[])[di];
            if (val===null||val===undefined) { h+=`<td class="st-cell"></td>`; return; }
            const pct    = Math.min(Math.abs(val)/(colMax[seat]||1)*86, 86).toFixed(1);
            const isPos  = val >= 0;
            const barStyle = isPos
                ? `left:5%;width:${pct}%;background:rgba(38,166,154,0.35)`
                : `right:5%;width:${pct}%;background:rgba(239,83,80,0.35)`;
            const numColor = isPos ? '#0d6b63' : '#b71c1c';
            h += `<td class="st-cell">
                    <div class="st-bar" style="${barStyle}"></div>
                    <span class="st-val" style="color:${numColor}">${fmtSeatVal(val)}</span>
                  </td>`;
        });
        h += `</tr>`;
    });

    h += `</tbody></table></div></div>`;
    return h;
}

function buildSeatHTML(data) {
    const { contract, dates, short_seats, long_seats, matrix, custom_groups } = data;
    let html = `<div class="seat-page">`;

    html += buildSeatTableBlock(
        `${contract}　全市场前 ${long_seats.length} 名多空席位`,
        dates, short_seats, long_seats, matrix, 'main'
    );

    (custom_groups||[]).forEach(grp => {
        if (!grp.seats||grp.seats.length===0) return;
        const lastIdx = dates.length - 1;
        const getLastVal = s => (grp.matrix[s]||[])[lastIdx] ?? 0;
        const shortS = grp.seats.filter(s=>getLastVal(s)<0).sort((a,b)=>getLastVal(a)-getLastVal(b));
        const longS  = grp.seats.filter(s=>getLastVal(s)>=0).sort((a,b)=>getLastVal(a)-getLastVal(b));
        const fShort = shortS.length>0 ? shortS : [];
        const fLong  = longS.length>0  ? longS  : grp.seats.slice().sort((a,b)=>getLastVal(a)-getLastVal(b));
        html += buildSeatTableBlock(grp.name, dates, fShort, fLong, grp.matrix, 'alt');
    });

    html += `</div>`;
    return html;
}

// ==================== 通用配置生成器 ====================
function makeXAxis(dates, showLabel) {
    return { type:'category', data:dates, boundaryGap:true, axisTick:{alignWithLabel:true}, axisLine:{onZero:false},
             axisLabel: showLabel ? {show:true,fontSize:10,color:'#666',interval:Math.max(0,Math.floor(dates.length/13)-1),formatter:v=>toDisplay(v)} : {show:false} };
}
function makeGrid(extra) { return {left:CONFIG.grid.left,right:CONFIG.grid.right,top:CONFIG.grid.top,bottom:CONFIG.grid.bottom+(extra||0),containLabel:false}; }
function makeZoom() { return [{type:'inside',xAxisIndex:[0],start:50,end:100}]; }
function makeSubTooltip(fn) {
    return { trigger:'axis', confine:true, appendToBody:true,
             axisPointer:{type:'line',lineStyle:{color:'rgba(80,80,80,0.45)',type:'dashed',width:1}},
             formatter(params) {
                 if(!params||!params.length) return '';
                 const hdr=`<div style="font-weight:700;border-bottom:1px solid #eee;padding-bottom:2px;margin-bottom:3px">${toDisplay(params[0].axisValue)}</div>`;
                 return `<div style="font-size:12px;line-height:2;min-width:130px">${hdr}${fn(params)}</div>`;
             }};
}
function makeTitle(t) { const n=CONFIG.currentContractName; return n?`${n}  ${t}`:t; }

// ==================== 绘图函数 ====================
function drawKlineChart(data) {
    const sel={};['K线','DKX','MADKX','MA5','MA20'].forEach(s=>{sel[s]=CONFIG.klineVisibleSeries.includes(s);});
    CONFIG.charts.kline.setOption({
        title:{text:makeTitle('价格走势'),left:'center',textStyle:{fontSize:16}},
        legend:{data:['K线','DKX','MADKX','MA5','MA20'],top:28,selected:sel},
        grid:makeGrid(), xAxis:makeXAxis(data.dates,true),
        yAxis:{type:'value',scale:true,splitArea:{show:true},position:'left',axisLabel:{fontSize:11}},
        dataZoom:makeZoom(),
        tooltip:{trigger:'axis',confine:true,appendToBody:true,
                 axisPointer:{type:'line',lineStyle:{color:'rgba(80,80,80,0.45)',type:'dashed',width:1}},
                 formatter(params){
                     if(!params||!params.length)return'';
                     const k=params.find(p=>p.seriesName==='K线');
                     if(!k||!Array.isArray(k.value))return'';
                     const[o,c,l,h]=k.value,clr=c>=o?COLORS.up:COLORS.down,chg=o>0?((c-o)/o*100):0;
                     const dP=params.find(p=>p.seriesName==='DKX'),mP=params.find(p=>p.seriesName==='MADKX');
                     const m5P=params.find(p=>p.seriesName==='MA5'),m20P=params.find(p=>p.seriesName==='MA20');
                     return`<div style="font-size:12px;line-height:2;min-width:220px">
                         <div style="font-weight:700;border-bottom:1px solid #eee;padding-bottom:2px;margin-bottom:3px">${toDisplay(params[0].axisValue)}</div>
                         <div>开&ensp;<b>${fmtPrice(o)}</b>&ensp;收&ensp;<b style="color:${clr}">${fmtPrice(c)}</b>&ensp;<span style="color:${clr};font-size:11px">${(chg>=0?'+':'')+chg.toFixed(2)}%</span></div>
                         <div>高&ensp;<b style="color:${COLORS.up}">${fmtPrice(h)}</b>&ensp;低&ensp;<b style="color:${COLORS.down}">${fmtPrice(l)}</b></div>
                         ${dP&&dP.value!=null?`<div>DKX&ensp;<b style="color:${COLORS.dkx}">${fmtPrice(dP.value)}</b></div>`:''}
                         ${mP&&mP.value!=null?`<div>MADKX&ensp;<b style="color:${COLORS.madkx}">${fmtPrice(mP.value)}</b></div>`:''}
                         ${m5P&&m5P.value!=null?`<div>MA5&ensp;<b style="color:${COLORS.ma5}">${fmtPrice(m5P.value)}</b></div>`:''}
                         ${m20P&&m20P.value!=null?`<div>MA20&ensp;<b style="color:${COLORS.ma20}">${fmtPrice(m20P.value)}</b></div>`:''}
                     </div>`;
                 }},
        series:[
            {name:'K线',type:'candlestick',data:data.ohlc,itemStyle:{color:COLORS.up,color0:COLORS.down,borderColor:COLORS.up,borderColor0:COLORS.down}},
            {name:'DKX',  type:'line',data:data.dkx,  smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.dkx}},
            {name:'MADKX',type:'line',data:data.madkx,smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.madkx}},
            {name:'MA5',  type:'line',data:data.ma5,  smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.ma5}},
            {name:'MA20', type:'line',data:data.ma20, smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.ma20}}
        ]
    },{notMerge:true});
    CONFIG.charts.kline.off('legendselectchanged');
    CONFIG.charts.kline.on('legendselectchanged',p=>{ CONFIG.klineVisibleSeries=Object.keys(p.selected).filter(k=>p.selected[k]); });
}

function drawVolumeChart(data) {
    CONFIG.charts.volume.setOption({
        title:{text:makeTitle('成交量'),left:'center',textStyle:{fontSize:14}},
        legend:{data:['成交量','成交量MA10','成交量放大信号'],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),
        yAxis:{type:'value',splitArea:{show:true},axisLabel:{formatter:v=>fmtNum(v),fontSize:11}},
        dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            let h='';
            params.forEach(p=>{
                if(p.seriesName==='成交量') h+=`<span style="color:${COLORS.volume}">●</span>&nbsp;成交量&nbsp;<b>${fmtNum(p.value)}</b><br/>`;
                else if(p.seriesName==='成交量MA10'&&p.value!=null) h+=`<span style="color:${COLORS.volMa10}">●</span>&nbsp;成交量MA10&nbsp;<b>${fmtNum(p.value)}</b><br/>`;
                else if(p.seriesName==='成交量放大信号'&&p.value!=null) h+=`<span style="color:${COLORS.volAmp}">★</span>&nbsp;成交量放大信号&nbsp;<b>${fmtNum(p.value[1])}</b><br/>`;
            });
            return h;
        }),
        series:[
            {name:'成交量',type:'bar',data:data.volumes,itemStyle:{color:COLORS.volume},barMaxWidth:8},
            {name:'成交量MA10',type:'line',data:data.volMa10,smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.volMa10}},
            {name:'成交量放大信号',type:'scatter',data:data.volAmplify,symbolSize:8,symbol:'circle',itemStyle:{color:COLORS.volAmp,shadowBlur:6,shadowColor:'rgba(255,0,0,0.5)'}}
        ]
    },{notMerge:true});
}

function drawOIChart(data) {
    CONFIG.charts.oi.setOption({
        title:{text:makeTitle('持仓量 & 变幅'),left:'center',textStyle:{fontSize:14}},
        legend:{data:['持仓量','持仓量变幅'],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),
        yAxis:[{type:'value',name:'持仓量',position:'left',splitArea:{show:true},axisLabel:{formatter:v=>fmtNum(v),fontSize:11}},
               {type:'value',name:'变幅(%)',position:'right',splitLine:{show:false},axisLabel:{formatter:v=>v.toFixed(1)+'%',fontSize:11}}],
        dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            const o=params.find(p=>p.seriesName==='持仓量'),c=params.find(p=>p.seriesName==='持仓量变幅');
            return[o?`<span style="color:${COLORS.oi}">●</span>&nbsp;持仓量&nbsp;<b>${fmtNum(o.value)}</b>`:'',
                   c?`<span style="color:${COLORS.oiChange}">●</span>&nbsp;持仓量变幅&nbsp;<b>${fmtPct1(c.value)}</b>`:''].filter(Boolean).join('<br/>');
        }),
        series:[
            {name:'持仓量',type:'bar',data:data.oi,itemStyle:{color:COLORS.oi},barMaxWidth:8},
            {name:'持仓量变幅',type:'line',yAxisIndex:1,data:data.oiChange,lineStyle:{color:COLORS.oiChange,width:2},symbol:'circle',symbolSize:3,
             markLine:{silent:true,symbol:'none',data:[{yAxis:0}],lineStyle:{color:'#ef5350',type:'dashed',width:1.5}}}
        ]
    },{notMerge:true});
}

function drawATRChart(data) {
    CONFIG.charts.atr.setOption({
        title:{text:makeTitle('ATR和止损'),left:'center',textStyle:{fontSize:14}},
        legend:{data:['ATRMA14','ATR60D60pct','推荐止损宽度'],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),
        yAxis:{type:'value',splitArea:{show:true},axisLabel:{formatter:v=>fmtPrice(v),fontSize:11}},
        dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            let h='';
            params.forEach(p=>{
                if(p.seriesName==='ATRMA14'&&p.value!=null)    h+=`<span style="color:${COLORS.atrMA14}">●</span>&nbsp;ATRMA14&nbsp;<b>${fmtPrice(p.value)}</b><br/>`;
                if(p.seriesName==='ATR60D60pct'&&p.value!=null) h+=`<span style="color:${COLORS.atr60D60Pct}">●</span>&nbsp;ATR60D60pct&nbsp;<b>${fmtPrice(p.value)}</b><br/>`;
                if(p.seriesName==='推荐止损宽度'&&p.value!=null)  h+=`<span style="color:${COLORS.stopLoss}">●</span>&nbsp;推荐止损宽度&nbsp;<b>${fmtPrice(p.value)}</b><br/>`;
            });
            return h;
        }),
        series:[
            {name:'ATRMA14',    type:'line',data:data.atrMA14,     smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.atrMA14},    itemStyle:{color:COLORS.atrMA14}},
            {name:'ATR60D60pct',type:'line',data:data.atr60D60Pct, smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.atr60D60Pct},itemStyle:{color:COLORS.atr60D60Pct}},
            {name:'推荐止损宽度', type:'line',data:data.stopLossWidth,smooth:true,symbol:'none',connectNulls:true,lineStyle:{width:2,color:COLORS.stopLoss},    itemStyle:{color:COLORS.stopLoss}}
        ]
    },{notMerge:true});
}

function drawTrendChart(data) {
    const hasCS=data.trendCS.some(v=>v!==null&&!isNaN(v)), hasHist=data.trendHist.some(v=>v!==null&&!isNaN(v));
    const el=document.getElementById('chart-trend');
    if(el) el.style.display=(hasCS||hasHist)?'':'none';
    if((!hasCS&&!hasHist)||!CONFIG.charts.trend) return;
    const ml={silent:true,symbol:'none',label:{show:true,position:'insideEndTop',fontSize:10},lineStyle:{type:'dashed',width:1},
              data:[{yAxis:80,name:'80%',lineStyle:{color:COLORS.up}},{yAxis:20,name:'20%',lineStyle:{color:COLORS.down}}]};
    const series=[];
    if(hasCS)   series.push({name:'趋势横截面分位数',type:'line',data:data.trendCS,   connectNulls:true,lineStyle:{color:COLORS.trend,width:2},              itemStyle:{color:COLORS.trend},     symbol:'circle',symbolSize:6,markLine:ml});
    if(hasHist) series.push({name:'趋势历史分位数',  type:'line',data:data.trendHist, connectNulls:true,lineStyle:{color:COLORS.trendHist,width:2,type:'dashed'},itemStyle:{color:COLORS.trendHist},symbol:'circle',symbolSize:6,...(!hasCS?{markLine:ml}:{})});
    CONFIG.charts.trend.setOption({
        title:{text:makeTitle('趋势性排名分位数'),left:'center',textStyle:{fontSize:14}},
        legend:{data:[...(hasCS?['趋势横截面分位数']:[]),...(hasHist?['趋势历史分位数']:[])],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),
        yAxis:{type:'value',min:0,max:100,splitArea:{show:true},axisLabel:{formatter:v=>v.toFixed(0)+'%',fontSize:11}},
        dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            let h='';
            params.forEach(p=>{
                if(p.seriesName==='趋势横截面分位数'&&p.value!=null) h+=`<span style="color:${COLORS.trend}">●</span>&nbsp;横截面分位数&nbsp;<b>${fmtPct1(p.value)}</b><br/>`;
                if(p.seriesName==='趋势历史分位数'&&p.value!=null)   h+=`<span style="color:${COLORS.trendHist}">●</span>&nbsp;历史分位数&nbsp;<b>${fmtPct1(p.value)}</b><br/>`;
            });
            return h;
        }),
        series
    },{notMerge:true});
    CONFIG.charts.trend.resize();
}

function drawPositionChart(data) {
    CONFIG.charts.position.setOption({
        title:{text:makeTitle('家人 & 机构净持仓'),left:'center',textStyle:{fontSize:14}},
        legend:{data:[{name:'家人净持仓',itemStyle:{color:COLORS.homie},lineStyle:{color:COLORS.homie}},{name:'机构净持仓',itemStyle:{color:COLORS.inst},lineStyle:{color:COLORS.inst}}],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),
        yAxis:{type:'value',splitArea:{show:true},axisLabel:{formatter:v=>fmtNum(v),fontSize:11}},
        dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            const h=params.find(p=>p.seriesName==='家人净持仓'),i=params.find(p=>p.seriesName==='机构净持仓');
            return[h?`<span style="color:${COLORS.homie}">●</span>&nbsp;家人净持仓&nbsp;<b>${fmtNum(h.value)}</b>`:'',
                   i?`<span style="color:${COLORS.inst}">●</span>&nbsp;机构净持仓&nbsp;<b>${fmtNum(i.value)}</b>`:''].filter(Boolean).join('<br/>');
        }),
        series:[
            {name:'家人净持仓',type:'line',data:data.homieNet,lineStyle:{color:COLORS.homie,width:2},itemStyle:{color:COLORS.homie},symbol:'circle',symbolSize:3,
             markLine:{silent:true,symbol:'none',data:[{yAxis:0}],lineStyle:{color:'#333',type:'dashed',width:1.5}}},
            {name:'机构净持仓',type:'line',data:data.instNet, lineStyle:{color:COLORS.inst, width:2},itemStyle:{color:COLORS.inst}, symbol:'circle',symbolSize:3}
        ]
    },{notMerge:true});
}

function drawIVChart(data) {
    CONFIG.charts.iv.setOption({
        title:{text:makeTitle('隐含波动率 (IV)'),left:'center',textStyle:{fontSize:14}},
        legend:{data:['IV','IV60日分位数','IV上涨信号'],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),
        yAxis:[{type:'value',name:'IV',position:'left',splitArea:{show:true},axisLabel:{formatter:v=>v.toFixed(1)+'%',fontSize:11}},
               {type:'value',name:'分位数(%)',position:'right',min:0,max:100,splitLine:{show:false},axisLabel:{formatter:v=>v.toFixed(1)+'%',fontSize:11}}],
        dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            let h='';
            params.forEach(p=>{
                if(p.seriesName==='IV') h+=`<span style="color:${COLORS.iv}">●</span>&nbsp;IV&nbsp;<b>${fmtPct1(p.value)}</b><br/>`;
                else if(p.seriesName==='IV60日分位数') h+=`<span style="color:${COLORS.ivPct}">●</span>&nbsp;IV分位数&nbsp;<b>${fmtPct1(p.value)}</b><br/>`;
                else if(p.seriesName==='IV上涨信号'&&p.value!=null) h+=`<span style="color:${COLORS.ivUp}">★</span>&nbsp;IV上涨信号&nbsp;<b>${fmtPct1(p.value[1])}</b><br/>`;
            });
            return h;
        }),
        series:[
            {name:'IV',type:'line',data:data.iv,lineStyle:{color:COLORS.iv,width:2},itemStyle:{color:COLORS.iv},symbol:'circle',symbolSize:3,connectNulls:true},
            {name:'IV60日分位数',type:'line',yAxisIndex:1,data:data.ivPct,lineStyle:{color:COLORS.ivPct,width:2,type:'dashed'},itemStyle:{color:COLORS.ivPct},symbol:'circle',symbolSize:3},
            {name:'IV上涨信号',type:'scatter',yAxisIndex:0,data:data.ivUpSignal,symbolSize:8,symbol:'circle',itemStyle:{color:COLORS.ivUp,shadowBlur:6,shadowColor:'rgba(255,0,0,0.5)'}}
        ]
    },{notMerge:true});
}

function drawCBChart(data) {
    const hasCBH=data.cbHistPct.some(v=>v!==null&&!isNaN(v));
    const yAxes=[{type:'value',name:'结构分数',position:'left',splitArea:{show:true},axisLabel:{formatter:v=>v.toFixed(2),fontSize:11}}];
    if(hasCBH) yAxes.push({type:'value',name:'分位数(%)',position:'right',min:0,max:100,splitLine:{show:false},axisLabel:{formatter:v=>v.toFixed(0)+'%',fontSize:11}});
    const series=[{name:'期限结构分数',type:'line',yAxisIndex:0,data:data.cb,lineStyle:{color:COLORS.cb,width:2},itemStyle:{color:COLORS.cb},symbol:'circle',symbolSize:3,connectNulls:true,
                   markLine:{silent:true,symbol:'none',data:[{yAxis:0}],lineStyle:{color:'#999',type:'dashed',width:1.5}}}];
    if(hasCBH) series.push({name:'历史分位数',type:'line',yAxisIndex:1,data:data.cbHistPct,lineStyle:{color:COLORS.cbHistPct,width:2,type:'dashed'},itemStyle:{color:COLORS.cbHistPct},symbol:'circle',symbolSize:3,connectNulls:true,
                             markLine:{silent:true,symbol:'none',label:{show:true,position:'insideEndTop',fontSize:10},lineStyle:{type:'dashed',width:1},
                                       data:[{yAxis:80,name:'80%',lineStyle:{color:COLORS.up}},{yAxis:20,name:'20%',lineStyle:{color:COLORS.down}}]}});
    CONFIG.charts.cb.setOption({
        title:{text:makeTitle('期限结构分数'),left:'center',textStyle:{fontSize:14}},
        legend:{data:['期限结构分数',...(hasCBH?['历史分位数']:[])],top:25},
        grid:makeGrid(),xAxis:makeXAxis(data.dates,false),yAxis:yAxes,dataZoom:makeZoom(),
        tooltip:makeSubTooltip(params=>{
            let h='';
            params.forEach(p=>{
                if(p.seriesName==='期限结构分数'&&p.value!=null) h+=`<span style="color:${COLORS.cb}">●</span>&nbsp;期限结构分数&nbsp;<b>${fmtCB(p.value)}</b><br/>`;
                if(p.seriesName==='历史分位数'&&p.value!=null)    h+=`<span style="color:${COLORS.cbHistPct}">●</span>&nbsp;历史分位数&nbsp;<b>${fmtPct1(p.value)}</b><br/>`;
            });
            return h;
        }),
        series
    },{notMerge:true});
}

// ==================== 格式化 ====================
function fmtPrice(v){return(v==null||isNaN(v))?'-':Number(v).toFixed(2);}
function fmtPct1(v) {return(v==null||isNaN(v))?'-':Number(v).toFixed(1)+'%';}
function fmtCB(v)   {return(v==null||isNaN(v))?'-':Number(v).toFixed(2);}
function fmtNum(n)  {if(n==null||isNaN(n))return'-';const a=Math.abs(n);if(a>=1e8)return(n/1e8).toFixed(2)+'亿';if(a>=1e4)return(n/1e4).toFixed(2)+'万';return Math.round(n).toString();}

function updateDateRange(data) {
    if(!data||!data.length) return;
    const si=document.getElementById('start-date'),ei=document.getElementById('end-date');
    si.min=ei.min=toFullDate(getRawDate(data[0]));
    si.max=ei.max=toFullDate(getRawDate(data[data.length-1]));
}

function showLoading(){const e=document.getElementById('loading-overlay');if(e){e.style.color='#667eea';e.textContent='加载中...';e.style.display='block';}}
function showError(m){const e=document.getElementById('loading-overlay');if(e){e.style.color='#dc3545';e.textContent=m;e.style.display='block';}}
function hideOverlay(){const e=document.getElementById('loading-overlay');if(e)e.style.display='none';}