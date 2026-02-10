// ==========================================
// CONFIGURATION
// ==========================================
const SUPABASE_URL = 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmYWZxY2N2emJveWZqZXd6dmhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2OTM4NzUsImV4cCI6MjA4MzI2OTg3NX0.OoyXHxHxAvSiE28NG3fz-S5QXcKz6OwspLrb9mSGH2Q';

let currentCompany = 'tips';

const COMPANY_CONFIG = {
    tips: {
        name: 'Tips Music',
        youtubeTable: 'tips_youtube_data',
        stockSymbol: 'TIPSMUSIC',
        stockName: 'NSE: TIPSMUSIC'
    },
    saregama: {
        name: 'Saregama Music',
        youtubeTable: 'saregama_youtube_data',
        stockSymbol: 'SAREGAMA',
        stockName: 'NSE: SAREGAMA'
    }
};

// ==========================================
// STATE
// ==========================================
let allYoutubeData = [];
let allStockData = [];
let currentPage = 1;
const rowsPerPage = 50;
let charts = {
    views: null,
    stock: null,
    monthly: null,
    correlation: null,
    scatter: null
};
let chartStates = {
    views: { scale: 'linear', showMA: false },
    stock: { scale: 'linear', showMA: false },
    dualAxis: 'raw'
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function formatNumber(num) {
    if (!num && num !== 0) return '--';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatCurrency(num) {
    if (!num && num !== 0) return '--';
    return '₹' + parseFloat(num).toFixed(2);
}

function formatPercentage(num) {
    if (!num && num !== 0) return '--';
    const sign = num > 0 ? '+' : '';
    return sign + parseFloat(num).toFixed(2) + '%';
}

function calculatePercentageChange(current, previous) {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
}

function calculateMovingAverage(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j];
            }
            result.push(sum / period);
        }
    }
    return result;
}

function filterDataByTimePeriod(data) {
    const period = document.getElementById('timePeriod').value;
    
    if (period === 'all') return data;
    
    if (period === 'custom') {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        if (startDate && endDate) {
            return data.filter(item => item.date >= startDate && item.date <= endDate);
        }
        return data;
    }
    
    const days = parseInt(period);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    return data.filter(item => item.date >= cutoffStr);
}

// ==========================================
// STATISTICAL FUNCTIONS
// ==========================================
function calculatePearsonCorrelation(x, y) {
    const n = x.length;
    if (n === 0) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
}

function calculateRSquared(x, y) {
    const correlation = calculatePearsonCorrelation(x, y);
    return correlation * correlation;
}

function calculateSpearmanCorrelation(x, y) {
    const rankX = rankArray(x);
    const rankY = rankArray(y);
    return calculatePearsonCorrelation(rankX, rankY);
}

function rankArray(arr) {
    const sorted = arr.map((val, idx) => ({ val, idx }))
        .sort((a, b) => a.val - b.val);
    
    const ranks = new Array(arr.length);
    sorted.forEach((item, rank) => {
        ranks[item.idx] = rank + 1;
    });
    
    return ranks;
}

function calculatePValue(r, n) {
    if (n < 3) return 1;
    
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    const df = n - 2;
    const p = 2 * (1 - Math.abs(t) / Math.sqrt(df + t * t));
    return Math.max(0, Math.min(1, p));
}

function performCorrelationAnalysis(youtubeData, stockData) {
    const mergedData = [];
    youtubeData.forEach(yt => {
        const stock = stockData.find(s => s.date === yt.date);
        if (stock) {
            mergedData.push({
                views: yt.daily_views,
                price: stock.close
            });
        }
    });

    if (mergedData.length < 3) {
        return {
            pearson: 0,
            rSquared: 0,
            spearman: 0,
            pValue: 1,
            dataPoints: 0
        };
    }

    const views = mergedData.map(d => d.views);
    const prices = mergedData.map(d => d.price);

    const pearson = calculatePearsonCorrelation(views, prices);
    const rSquared = calculateRSquared(views, prices);
    const spearman = calculateSpearmanCorrelation(views, prices);
    const pValue = calculatePValue(pearson, mergedData.length);

    return {
        pearson,
        rSquared,
        spearman,
        pValue,
        dataPoints: mergedData.length
    };
}

function generateInsights(analysis) {
    const insights = [];
    
    const absPearson = Math.abs(analysis.pearson);
    let strength = 'weak';
    if (absPearson > 0.7) strength = 'strong';
    else if (absPearson > 0.4) strength = 'moderate';
    
    const direction = analysis.pearson > 0 ? 'positive' : 'negative';
    
    insights.push(`The data shows a <span class="insight-highlight">${strength} ${direction}</span> correlation (r = ${analysis.pearson.toFixed(3)}) between daily YouTube views and stock price.`);
    
    const varianceExplained = (analysis.rSquared * 100).toFixed(1);
    insights.push(`Approximately <span class="insight-highlight">${varianceExplained}%</span> of the stock price variance can be explained by YouTube view fluctuations.`);
    
    if (analysis.pValue < 0.01) {
        insights.push(`The correlation is <span class="insight-highlight">highly statistically significant</span> (p < 0.01), indicating this relationship is unlikely to occur by chance.`);
    } else if (analysis.pValue < 0.05) {
        insights.push(`The correlation is <span class="insight-highlight">statistically significant</span> (p < 0.05), suggesting a reliable relationship.`);
    } else {
        insights.push(`The correlation is <span class="insight-highlight">not statistically significant</span> (p = ${analysis.pValue.toFixed(3)}), suggesting caution in drawing conclusions.`);
    }
    
    if (absPearson > 0.5) {
        if (analysis.pearson > 0) {
            insights.push(`<strong>Investment insight:</strong> Increased YouTube engagement appears to <span class="insight-highlight">correlate with rising stock prices</span>, suggesting content popularity may drive investor confidence.`);
        } else {
            insights.push(`<strong>Investment insight:</strong> There appears to be an <span class="insight-highlight">inverse relationship</span>, which may indicate complex market dynamics or external factors.`);
        }
    } else {
        insights.push(`<strong>Investment insight:</strong> The relationship is relatively weak, suggesting stock price is influenced more by <span class="insight-highlight">broader market factors</span> than daily content performance.`);
    }
    
    insights.push(`Analysis based on <span class="insight-highlight">${analysis.dataPoints} matched data points</span> across the selected time period.`);
    
    return insights;
}

function updateCorrelationAnalysis() {
    const filteredYoutubeData = filterDataByTimePeriod([...allYoutubeData].reverse());
    const filteredStockData = filterDataByTimePeriod([...allStockData].reverse());
    
    const analysis = performCorrelationAnalysis(filteredYoutubeData, filteredStockData);
    
    document.getElementById('pearsonCorr').textContent = analysis.pearson.toFixed(3);
    document.getElementById('rSquared').textContent = analysis.rSquared.toFixed(3);
    document.getElementById('spearmanCorr').textContent = analysis.spearman.toFixed(3);
    document.getElementById('pValue').textContent = analysis.pValue < 0.001 ? '<0.001' : analysis.pValue.toFixed(3);
    
    const insights = generateInsights(analysis);
    const insightsContent = document.getElementById('insightsContent');
    insightsContent.innerHTML = insights.map(insight => 
        `<div class="insight-item">${insight}</div>`
    ).join('');
}

// ==========================================
// DATA FETCHING
// ==========================================
async function fetchYouTubeData() {
    const config = COMPANY_CONFIG[currentCompany];
    
    try {
        const response = await axios.get(
            `${SUPABASE_URL}/rest/v1/${config.youtubeTable}`,
            {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                params: {
                    select: '*',
                    order: 'date.desc'
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error('Error fetching YouTube data:', error);
        return [];
    }
}

async function fetchStockPrices() {
    const config = COMPANY_CONFIG[currentCompany];
    
    try {
        const response = await axios.get(
            `${SUPABASE_URL}/rest/v1/stock_prices`,
            {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                params: {
                    select: '*',
                    symbol: `eq.${config.stockSymbol}`,
                    order: 'date.desc'
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error('Error fetching stock data:', error);
        return [];
    }
}

async function fetchData() {
    console.log('Fetching data for:', currentCompany);
    
    const [youtubeData, stockData] = await Promise.all([
        fetchYouTubeData(),
        fetchStockPrices()
    ]);

    allYoutubeData = youtubeData || [];
    allStockData = stockData || [];

    updateStats();
    renderCharts();
    updateCorrelationAnalysis();
    renderTable();
    updateLastUpdated();
}

// ==========================================
// UI UPDATE
// ==========================================
function updateStats() {
    if (allYoutubeData.length > 0) {
        const latest = allYoutubeData[0];
        const previous = allYoutubeData[1];
        
        document.getElementById('totalSubs').textContent = formatNumber(latest.subscribers);
        document.getElementById('totalViews').textContent = formatNumber(latest.total_views);
        document.getElementById('dailyViews').textContent = formatNumber(latest.daily_views);
        
        if (previous) {
            const subChange = latest.subscribers - previous.subscribers;
            document.getElementById('subsChange').innerHTML = 
                `<span class="stat-change ${subChange >= 0 ? 'positive' : 'negative'}">${subChange > 0 ? '+' : ''}${formatNumber(subChange)}</span> today`;
            
            const viewChange = latest.daily_views - previous.daily_views;
            const viewPct = calculatePercentageChange(latest.daily_views, previous.daily_views);
            document.getElementById('dailyChange').innerHTML = 
                `<span class="stat-change ${viewChange >= 0 ? 'positive' : 'negative'}">${formatPercentage(viewPct)}</span> vs yesterday`;
        }
    }

    if (allStockData.length > 0) {
        const latest = allStockData[0];
        const previous = allStockData[1];
        
        document.getElementById('stockPrice').textContent = formatCurrency(latest.close);
        
        if (previous) {
            const change = latest.close - previous.close;
            const pct = calculatePercentageChange(latest.close, previous.close);
            document.getElementById('stockChange').innerHTML = 
                `<span class="stat-change ${change >= 0 ? 'positive' : 'negative'}">${formatCurrency(change)} (${formatPercentage(pct)})</span>`;
        }
    }
}

function switchCompany(company) {
    currentCompany = company;
    const config = COMPANY_CONFIG[company];
    
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    event.target.closest('.tab-button').classList.add('active');
    
    document.getElementById('viewsChartTitle').textContent = config.name + ' Views';
    document.getElementById('stockChartTitle').textContent = config.stockName;
    document.getElementById('footerStock').textContent = config.stockName;
    
    currentPage = 1;
    fetchData();
}

function handleTimePeriodChange() {
    const period = document.getElementById('timePeriod').value;
    
    if (period === 'custom') {
        document.getElementById('startDate').classList.remove('hidden');
        document.getElementById('endDate').classList.remove('hidden');
    } else {
        document.getElementById('startDate').classList.add('hidden');
        document.getElementById('endDate').classList.add('hidden');
        renderCharts();
        updateCorrelationAnalysis();
        renderTable();
    }
}

function updateLastUpdated() {
    const now = new Date();
    document.getElementById('lastUpdated').textContent = now.toLocaleString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

// ==========================================
// CHART RENDERING
// ==========================================
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
Chart.defaults.font.family = "'Outfit', sans-serif";

function renderCharts() {
    const filteredYoutubeData = filterDataByTimePeriod([...allYoutubeData].reverse());
    const filteredStockData = filterDataByTimePeriod([...allStockData].reverse());
    
    renderViewsChart(filteredYoutubeData);
    renderStockChart(filteredStockData);
    renderMonthlyChart(filteredYoutubeData);
    renderCorrelationChart(filteredYoutubeData, filteredStockData);
    renderScatterChart(filteredYoutubeData, filteredStockData);
}

function renderViewsChart(data) {
    const ctx = document.getElementById('viewsChart').getContext('2d');
    
    if (charts.views) charts.views.destroy();

    const dates = data.map(d => d.date);
    const views = data.map(d => d.daily_views);
    
    const datasets = [{
        label: 'Daily Views',
        data: views,
        borderColor: '#00d4ff',
        backgroundColor: 'rgba(0, 212, 255, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#00d4ff'
    }];

    if (chartStates.views.showMA) {
        datasets.push(
            {
                label: '7-Day MA',
                data: calculateMovingAverage(views, 7),
                borderColor: '#00ff9f',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointRadius: 0
            },
            {
                label: '30-Day MA',
                data: calculateMovingAverage(views, 30),
                borderColor: '#ffeb3b',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointRadius: 0
            },
            {
                label: '45-Day MA',
                data: calculateMovingAverage(views, 45),
                borderColor: '#ff006e',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointRadius: 0
            }
        );
    }

    charts.views = new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', padding: 15 }
                },
                tooltip: {
                    backgroundColor: 'rgba(19, 24, 37, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: '#00d4ff',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: ctx => ctx.dataset.label + ': ' + formatNumber(ctx.parsed.y)
                    }
                }
            },
            scales: {
                y: {
                    type: chartStates.views.scale,
                    beginAtZero: chartStates.views.scale === 'linear',
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { callback: value => formatNumber(value) }
                },
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 45, minRotation: 45 }
                }
            }
        }
    });
}

function renderStockChart(data) {
    const ctx = document.getElementById('stockChart').getContext('2d');
    
    if (charts.stock) charts.stock.destroy();

    const dates = data.map(d => d.date);
    const prices = data.map(d => d.close);
    
    const datasets = [{
        label: 'Stock Price (₹)',
        data: prices,
        borderColor: '#ff006e',
        backgroundColor: 'rgba(255, 0, 110, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ff006e'
    }];

    if (chartStates.stock.showMA) {
        datasets.push(
            {
                label: '7-Day MA',
                data: calculateMovingAverage(prices, 7),
                borderColor: '#00ff9f',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointRadius: 0
            },
            {
                label: '30-Day MA',
                data: calculateMovingAverage(prices, 30),
                borderColor: '#ffeb3b',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointRadius: 0
            },
            {
                label: '45-Day MA',
                data: calculateMovingAverage(prices, 45),
                borderColor: '#b265ff',
                borderWidth: 2,
                fill: false,
                tension: 0.4,
                pointRadius: 0
            }
        );
    }

    charts.stock = new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', padding: 15 }
                },
                tooltip: {
                    backgroundColor: 'rgba(19, 24, 37, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: '#ff006e',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: ctx => ctx.dataset.label + ': ₹' + ctx.parsed.y.toFixed(2)
                    }
                }
            },
            scales: {
                y: {
                    type: chartStates.stock.scale,
                    beginAtZero: chartStates.stock.scale === 'linear',
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { callback: value => '₹' + value.toFixed(0) }
                },
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 45, minRotation: 45 }
                }
            }
        }
    });
}

function renderMonthlyChart(data) {
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    
    if (charts.monthly) charts.monthly.destroy();

    const monthlyData = {};
    data.forEach(item => {
        const month = item.date.substring(0, 7);
        if (!monthlyData[month]) {
            monthlyData[month] = { views: 0, count: 0 };
        }
        monthlyData[month].views += item.daily_views;
        monthlyData[month].count += 1;
    });

    const months = Object.keys(monthlyData).sort();
    const monthlyViews = months.map(m => monthlyData[m].views);

    charts.monthly = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Monthly Views',
                data: monthlyViews,
                backgroundColor: 'rgba(0, 212, 255, 0.6)',
                borderColor: '#00d4ff',
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(19, 24, 37, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: '#00d4ff',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: ctx => 'Total Views: ' + formatNumber(ctx.parsed.y)
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { callback: value => formatNumber(value) }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function renderCorrelationChart(youtubeData, stockData) {
    const ctx = document.getElementById('correlationChart').getContext('2d');
    
    if (charts.correlation) charts.correlation.destroy();

    const mergedData = [];
    youtubeData.forEach(yt => {
        const stock = stockData.find(s => s.date === yt.date);
        if (stock) {
            mergedData.push({
                date: yt.date,
                views: yt.daily_views,
                price: stock.close
            });
        }
    });

    const dates = mergedData.map(d => d.date);
    const views = mergedData.map(d => d.views);
    const prices = mergedData.map(d => d.price);

    let viewsDataset;
    switch (chartStates.dualAxis) {
        case 'raw':
            viewsDataset = views;
            break;
        case 'ma30':
            viewsDataset = calculateMovingAverage(views, 30);
            break;
        case 'ma45':
            viewsDataset = calculateMovingAverage(views, 45);
            break;
    }

    charts.correlation = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: chartStates.dualAxis === 'raw' ? 'Daily Views' : `${chartStates.dualAxis.toUpperCase()} Views`,
                    data: viewsDataset,
                    borderColor: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.4,
                    yAxisID: 'y',
                    pointRadius: 0
                },
                {
                    label: 'Stock Price (₹)',
                    data: prices,
                    borderColor: '#ff006e',
                    backgroundColor: 'rgba(255, 0, 110, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.4,
                    yAxisID: 'y1',
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', padding: 15 }
                },
                tooltip: {
                    backgroundColor: 'rgba(19, 24, 37, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: '#00d4ff',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    title: {
                        display: true,
                        text: 'Views',
                        color: '#00d4ff'
                    },
                    ticks: { callback: value => formatNumber(value) }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    title: {
                        display: true,
                        text: 'Price (₹)',
                        color: '#ff006e'
                    },
                    ticks: { callback: value => '₹' + value.toFixed(0) }
                },
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 45, minRotation: 45 }
                }
            }
        }
    });
}

function renderScatterChart(youtubeData, stockData) {
    const ctx = document.getElementById('scatterChart').getContext('2d');
    
    if (charts.scatter) charts.scatter.destroy();

    const scatterData = [];
    youtubeData.forEach(yt => {
        const stock = stockData.find(s => s.date === yt.date);
        if (stock) {
            scatterData.push({
                x: yt.daily_views,
                y: stock.close
            });
        }
    });

    const xValues = scatterData.map(d => d.x);
    const yValues = scatterData.map(d => d.y);
    const n = xValues.length;
    
    if (n > 0) {
        const sumX = xValues.reduce((a, b) => a + b, 0);
        const sumY = yValues.reduce((a, b) => a + b, 0);
        const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
        const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        
        const trendline = [
            { x: minX, y: slope * minX + intercept },
            { x: maxX, y: slope * maxX + intercept }
        ];

        charts.scatter = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Data Points',
                        data: scatterData,
                        backgroundColor: 'rgba(0, 212, 255, 0.6)',
                        borderColor: '#00d4ff',
                        borderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 8
                    },
                    {
                        label: 'Trendline',
                        data: trendline,
                        type: 'line',
                        borderColor: '#ff006e',
                        borderWidth: 3,
                        pointRadius: 0,
                        fill: false,
                        tension: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#94a3b8', padding: 15 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(19, 24, 37, 0.95)',
                        titleColor: '#e2e8f0',
                        bodyColor: '#94a3b8',
                        borderColor: '#00d4ff',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: ctx => {
                                if (ctx.datasetIndex === 0) {
                                    return `Views: ${formatNumber(ctx.parsed.x)} | Price: ₹${ctx.parsed.y.toFixed(2)}`;
                                }
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        title: {
                            display: true,
                            text: 'Daily YouTube Views',
                            color: '#94a3b8'
                        },
                        ticks: { callback: value => formatNumber(value) }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        title: {
                            display: true,
                            text: 'Stock Price (₹)',
                            color: '#94a3b8'
                        },
                        ticks: { callback: value => '₹' + value.toFixed(0) }
                    }
                }
            }
        });
    }
}

// ==========================================
// CHART CONTROLS
// ==========================================
function toggleScale(chartName, scale, event) {
    chartStates[chartName].scale = scale;
    
    const buttons = event.target.parentElement.querySelectorAll('button');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    renderCharts();
}

function toggleMA(chartName, event) {
    chartStates[chartName].showMA = !chartStates[chartName].showMA;
    event.target.classList.toggle('active');
    renderCharts();
}

function toggleDualAxis(mode, event) {
    chartStates.dualAxis = mode;
    
    const buttons = event.target.parentElement.querySelectorAll('button');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    renderCharts();
}

// ==========================================
// TABLE
// ==========================================
function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    const filteredData = filterDataByTimePeriod(allYoutubeData);

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No data available</td></tr>';
        updatePagination(0);
        return;
    }

    const start = (currentPage - 1) * rowsPerPage;
    const end = Math.min(start + rowsPerPage, filteredData.length);
    const pageData = filteredData.slice(start, end);

    pageData.forEach(row => {
        const tr = document.createElement('tr');
        
        const nextIndex = filteredData.indexOf(row) + 1;
        const previousRow = nextIndex < filteredData.length ? filteredData[nextIndex] : null;
        
        let viewChange = '--';
        let viewChangePercent = '--';
        let viewChangeClass = '';
        
        if (previousRow) {
            const change = row.daily_views - previousRow.daily_views;
            const changePercent = calculatePercentageChange(row.daily_views, previousRow.daily_views);
            viewChange = (change > 0 ? '+' : '') + formatNumber(change);
            viewChangePercent = formatPercentage(changePercent);
            viewChangeClass = change >= 0 ? 'positive' : 'negative';
        }

        const stockMatch = allStockData.find(s => s.date === row.date);
        let stockPrice = '--';
        let stockChange = '--';
        let stockChangeClass = '';

        if (stockMatch) {
            stockPrice = formatCurrency(stockMatch.close);
            
            const stockIndex = allStockData.indexOf(stockMatch);
            const previousStock = stockIndex < allStockData.length - 1 ? allStockData[stockIndex + 1] : null;
            
            if (previousStock) {
                const change = stockMatch.close - previousStock.close;
                const changePercent = calculatePercentageChange(stockMatch.close, previousStock.close);
                stockChange = `${change > 0 ? '+' : ''}${formatCurrency(change)} (${formatPercentage(changePercent)})`;
                stockChangeClass = change >= 0 ? 'positive' : 'negative';
            }
        }

        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${formatNumber(row.daily_views)}</td>
            <td class="${viewChangeClass}">${viewChange}</td>
            <td class="${viewChangeClass}">${viewChangePercent}</td>
            <td>${stockPrice}</td>
            <td class="${stockChangeClass}">${stockChange}</td>
        `;
        tbody.appendChild(tr);
    });

    updatePagination(filteredData.length);
}

function updatePagination(totalRecords) {
    const start = totalRecords === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
    const end = Math.min(start + rowsPerPage - 1, totalRecords);

    document.getElementById('pageInfo').textContent = `Showing ${start}-${end} of ${totalRecords}`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = end >= totalRecords;
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    const filteredData = filterDataByTimePeriod(allYoutubeData);
    const maxPage = Math.ceil(filteredData.length / rowsPerPage);
    
    if (currentPage < maxPage) {
        currentPage++;
        renderTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard initialized - Symphony of Data');
    fetchData();
});