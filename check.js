
        // ─── Global State ─────────────────────────────────────────────────────────
        let token = localStorage.getItem('token');
        if (!token) window.location.href = '/login';

        let salesTrendChart, categoryChart, profitTrendChart, inventoryStatusChart, expenseChart, expenseTrendChart;
        let allSales = [], allProducts = [], allExpenses = [];
        let currentRange = 'month';
        let customStartDate = null, customEndDate = null;
        let currentChartPeriod = 'weekly';

        // ─── Helpers ──────────────────────────────────────────────────────────────
        function formatNumber(num) {
            if (num === undefined || num === null || isNaN(num)) return '0';
            return Number(num).toLocaleString('en-IN');
        }
        function formatCurrency(num) { return '₹' + formatNumber(num); }
        function getInitials(name) { return name ? name.substring(0, 2).toUpperCase() : 'U'; }
        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
        }

        // ─── User Info ────────────────────────────────────────────────────────────
        async function loadUserInfo() {
            const user = JSON.parse(localStorage.getItem('user'));
            if (user) {
                document.getElementById('userName').innerText = user.username;
                document.getElementById('shopName').innerText = user.shop_name || 'Your Shop';
                document.getElementById('userAvatar').innerText = getInitials(user.username);
            }
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            document.getElementById('startDate').value = firstDay.toISOString().split('T')[0];
            document.getElementById('endDate').value = today.toISOString().split('T')[0];
        }

        // ─── Data Loading ─────────────────────────────────────────────────────────
        let isFetchingData = false;
        async function loadAllData() {
            if (isFetchingData) return;
            isFetchingData = true;
            try {
                const [salesRes, productsRes, expensesRes] = await Promise.all([
                    fetch('/api/sales',    { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch('/api/products', { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch('/api/expenses', { headers: { 'Authorization': `Bearer ${token}` } })
                ]);
                const salesData    = await salesRes.json();
                const productsData = await productsRes.json();
                const expensesData = await expensesRes.json();

                if (salesData.success)    allSales    = salesData.sales       || [];
                if (productsData.success) allProducts = productsData.products || [];
                if (expensesData.success) allExpenses = expensesData.expenses || [];

                await loadAllReports();
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                isFetchingData = false;
            }
        }

        // ─── Date Filtering ───────────────────────────────────────────────────────
        function filterSalesByDate(sales) {
            const now = new Date();
            let filtered = [...sales];

            if (customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end   = new Date(customEndDate);
                end.setHours(23, 59, 59, 999);
                filtered = filtered.filter(s => {
                    const d = new Date(s.created_at);
                    return d >= start && d <= end;
                });
            } else if (currentRange === 'today') {
                filtered = filtered.filter(s => new Date(s.created_at).toDateString() === now.toDateString());
            } else if (currentRange === 'week') {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                filtered = filtered.filter(s => new Date(s.created_at) >= weekAgo);
            } else if (currentRange === 'month') {
                filtered = filtered.filter(s => {
                    const d = new Date(s.created_at);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });
            } else if (currentRange === 'year') {
                filtered = filtered.filter(s => new Date(s.created_at).getFullYear() === now.getFullYear());
            }
            return filtered;
        }

        // ─── Sales Report ─────────────────────────────────────────────────────────
        async function loadSalesReport() {
            const filteredSales  = filterSalesByDate(allSales);
            const totalRevenue   = filteredSales.reduce((sum, s) => sum + parseFloat(s.total_amount  || 0), 0);
            const totalOrders    = filteredSales.length;
            const avgOrderValue  = totalOrders > 0 ? totalRevenue / totalOrders : 0;
            const totalProfit    = filteredSales.reduce((sum, s) => sum + parseFloat(s.total_profit  || 0), 0);

            document.getElementById('salesKpi').innerHTML = `
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Total Revenue</span><div class="kpi-icon"><i class="fas fa-rupee-sign"></i></div></div>
                    <div class="kpi-value">${formatCurrency(totalRevenue)}</div>
                    <div class="kpi-change positive">${filteredSales.length} transactions</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Total Orders</span><div class="kpi-icon"><i class="fas fa-shopping-cart"></i></div></div>
                    <div class="kpi-value">${formatNumber(totalOrders)}</div>
                    <div class="kpi-change positive">${totalOrders} orders</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Average Order Value</span><div class="kpi-icon"><i class="fas fa-chart-line"></i></div></div>
                    <div class="kpi-value">${formatCurrency(avgOrderValue)}</div>
                    <div class="kpi-change">per order</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Total Profit</span><div class="kpi-icon"><i class="fas fa-chart-pie"></i></div></div>
                    <div class="kpi-value">${formatCurrency(totalProfit)}</div>
                    <div class="kpi-change positive">${totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0}% margin</div>
                </div>
            `;

            await loadTopProducts();
            await updateCategoryChart(filteredSales);
            await updateSalesChart(currentChartPeriod);
        }

        // ─── Category Chart ───────────────────────────────────────────────────────
        // Strategy: try /api/reports/sales-by-category first (single fast query).
        // If that endpoint doesn't exist (404/error), fall back to building the
        // breakdown locally from allSales + allProducts using sale items cached in
        // each sale object (sale.items), or group by month as last resort.
        async function updateCategoryChart(filteredSales) {
            const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#f97316','#84cc16'];

            function renderDoughnut(labels, values) {
                const canvas = document.getElementById('categoryChart');
                if (!canvas) return;
                if (categoryChart) {
                    categoryChart.data.labels = labels;
                    categoryChart.data.datasets[0].data = values;
                    categoryChart.data.datasets[0].backgroundColor = COLORS.slice(0, labels.length);
                    categoryChart.update('none');
                    return;
                }
                // Force canvas to have a real size before Chart.js measures it
                canvas.style.display = 'block';
                categoryChart = new Chart(canvas.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels,
                        datasets: [{
                            data: values,
                            backgroundColor: COLORS.slice(0, labels.length),
                            borderWidth: 2,
                            borderColor: '#ffffff',
                            hoverOffset: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 600 },
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } },
                            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)} (${((ctx.raw / ctx.dataset.data.reduce((a,b)=>a+b,0))*100).toFixed(1)}%)` } }
                        },
                        cutout: '60%'
                    }
                });
            }

            // ── Attempt 1: dedicated summary endpoint ──
            try {
                const res  = await fetch('/api/reports/sales-by-category', { headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.categories && data.categories.length > 0) {
                        renderDoughnut(data.categories.map(c => c.name), data.categories.map(c => c.revenue));
                        return;
                    }
                }
            } catch (_) { /* endpoint doesn't exist, fall through */ }

            // ── Attempt 2: derive from allProducts category + sale items ──
            // Many backends embed items inside each sale object as sale.items[]
            // or sale.sale_items[]. Try both field names.
            const categoryMap  = {};   // category_name → total revenue
            let   itemsFound   = false;

            for (const sale of filteredSales) {
                const items = sale.items || sale.sale_items || sale.order_items || [];
                if (items.length > 0) itemsFound = true;
                for (const item of items) {
                    const product  = allProducts.find(p => p.id === (item.product_id || item.id));
                    const catName  = product?.category_name || product?.category || 'Uncategorized';
                    const revenue  = (item.price || item.price_at_time || item.unit_price || 0) * (item.quantity || item.qty || 1);
                    categoryMap[catName] = (categoryMap[catName] || 0) + revenue;
                }
            }

            if (itemsFound && Object.keys(categoryMap).length > 0) {
                const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
                renderDoughnut(sorted.map(e => e[0]), sorted.map(e => e[1]));
                return;
            }

            // ── Attempt 3: group allProducts by category and use stock value as proxy ──
            // (visible even with zero sales — shows inventory distribution)
            const invMap = {};
            allProducts.forEach(p => {
                const cat = p.category_name || p.category || 'Uncategorized';
                invMap[cat] = (invMap[cat] || 0) + ((p.selling_price || 0) * (p.current_stock || 0));
            });

            if (Object.keys(invMap).length > 0) {
                const sorted = Object.entries(invMap).sort((a, b) => b[1] - a[1]);
                // Update chart title to reflect what we're showing
                const titleEl = document.querySelector('#salesReport .chart-card:nth-child(2) .chart-title');
                if (titleEl) titleEl.innerHTML = '<i class="fas fa-chart-pie"></i> Inventory Value by Category';
                renderDoughnut(sorted.map(e => e[0]), sorted.map(e => e[1]));
                return;
            }

            // ── Fallback: nothing to show ──
            renderDoughnut(['No Data Available'], [1]);
        }

        // ─── Sales Trend Chart ────────────────────────────────────────────────────
        // Each period uses the right data scope:
        //   daily   → last 7 actual calendar days (ignores date range filter)
        //   weekly  → last 8 weeks rolling (ignores date range filter)
        //   monthly → all 12 months of the current year (always allSales)
        // This ensures switching period always shows meaningfully different data.
        async function updateSalesChart(period, btnEl) {
            currentChartPeriod = period;

            // Sync active button
            document.querySelectorAll('.chart-actions .chart-btn').forEach(b => b.classList.remove('active'));
            const target = btnEl || document.querySelector(`.chart-actions .chart-btn[data-period="${period}"]`);
            if (target) target.classList.add('active');

            let labels = [], values = [];
            const now = new Date();

            if (period === 'daily') {
                // Last 7 calendar days — always use allSales so "today" range doesn't kill the chart
                const days = [];
                for (let i = 6; i >= 0; i--) {
                    const d = new Date(now);
                    d.setDate(now.getDate() - i);
                    days.push(d);
                }
                labels = days.map(d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
                values = days.map(day => {
                    const ds = day.toDateString();
                    return allSales
                        .filter(s => new Date(s.created_at).toDateString() === ds)
                        .reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
                });

            } else if (period === 'weekly') {
                // Last 8 complete weeks rolling — always use allSales
                const weeks = [];
                for (let i = 7; i >= 0; i--) {
                    const end   = new Date(now);
                    end.setDate(now.getDate() - i * 7);
                    const start = new Date(end);
                    start.setDate(end.getDate() - 6);
                    weeks.push({ start, end });
                }
                labels = weeks.map((w, i) => {
                    const s = w.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                    const e = w.end.toLocaleDateString('en-GB',   { day: 'numeric', month: 'short' });
                    return `${s}–${e}`;
                });
                values = weeks.map(w => {
                    const wStart = new Date(w.start); wStart.setHours(0,0,0,0);
                    const wEnd   = new Date(w.end);   wEnd.setHours(23,59,59,999);
                    return allSales
                        .filter(s => { const d = new Date(s.created_at); return d >= wStart && d <= wEnd; })
                        .reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
                });

            } else {
                // Monthly — all 12 months of current year, always from allSales
                const ORDER  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const curYear = now.getFullYear();
                const map    = {};
                ORDER.forEach(m => { map[m] = 0; });

                allSales.forEach(sale => {
                    const d = new Date(sale.created_at);
                    if (d.getFullYear() !== curYear) return;
                    // Use numeric month index to avoid locale issues
                    const key = ORDER[d.getMonth()];
                    map[key] += parseFloat(sale.total_amount || 0);
                });

                labels = ORDER;
                values = ORDER.map(m => map[m]);
            }

            const canvas = document.getElementById('salesTrendChart');
            if (!canvas) return;

            if (salesTrendChart) {
                salesTrendChart.data.labels = labels;
                salesTrendChart.data.datasets[0].data = values;
                salesTrendChart.update('none');
                return;
            }

            salesTrendChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Revenue',
                        data: values,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99,102,241,0.08)',
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#6366f1',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 400 },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: ctx => ' Revenue: ' + formatCurrency(Math.round(ctx.raw))
                            }
                        },
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                maxTicksLimit: 6,
                                callback: v => v >= 100000 ? '₹' + (v/100000).toFixed(1) + 'L'
                                             : v >= 1000   ? '₹' + (v/1000).toFixed(0) + 'k'
                                             : '₹' + v
                            },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { maxRotation: 35, font: { size: 10 } }
                        }
                    }
                }
            });
        }

        // ─── Top Products ─────────────────────────────────────────────────────────
        async function loadTopProducts() {
            try {
                const response = await fetch('/api/reports/top-products?limit=10', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();

                if (data.success && data.products && data.products.length > 0) {
                    document.getElementById('topProductsTable').innerHTML = `
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Rank</th><th>Product</th><th>Category</th>
                                    <th>Quantity Sold</th><th>Revenue</th><th>Profit</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.products.map((p, i) => `
                                    <tr>
                                        <td><div class="rank-badge rank-${Math.min(i+1,3)}">${i+1}</div></td>
                                        <td>
                                            <div class="product-cell">
                                                <div class="product-icon"><i class="fas fa-box"></i></div>
                                                <div><strong>${escapeHtml(p.name)}</strong><br><small>ID: ${p.id}</small></div>
                                            </div>
                                        </td>
                                        <td>${escapeHtml(p.category_name || 'Uncategorized')}</td>
                                        <td>${formatNumber(p.total_quantity)} units</td>
                                        <td class="positive">${formatCurrency(p.total_revenue)}</td>
                                        <td class="positive">${formatCurrency(p.total_profit)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `;
                } else {
                    document.getElementById('topProductsTable').innerHTML = '<div class="loading">No sales data yet. Make some sales!</div>';
                }
            } catch (error) {
                document.getElementById('topProductsTable').innerHTML = '<div class="loading">Error loading data</div>';
            }
        }

        // ─── Expense date filter (mirrors filterSalesByDate) ──────────────────────
        function filterExpensesByDate(expenses) {
            const now = new Date();
            let filtered = [...expenses];

            if (customStartDate && customEndDate) {
                const start = new Date(customStartDate);
                const end   = new Date(customEndDate); end.setHours(23,59,59,999);
                filtered = filtered.filter(e => { const d = new Date(e.created_at || e.date); return d >= start && d <= end; });
            } else if (currentRange === 'today') {
                filtered = filtered.filter(e => new Date(e.created_at || e.date).toDateString() === now.toDateString());
            } else if (currentRange === 'week') {
                const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
                filtered = filtered.filter(e => new Date(e.created_at || e.date) >= weekAgo);
            } else if (currentRange === 'month') {
                filtered = filtered.filter(e => {
                    const d = new Date(e.created_at || e.date);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });
            } else if (currentRange === 'year') {
                filtered = filtered.filter(e => new Date(e.created_at || e.date).getFullYear() === now.getFullYear());
            }
            return filtered;
        }

        // ─── Profit & Loss Report ─────────────────────────────────────────────────
        async function loadProfitLossReport() {
            // Both sales AND expenses now respect the active date range filter
            const filteredSales    = filterSalesByDate(allSales);
            const filteredExpenses = filterExpensesByDate(allExpenses);

            const totalRevenue  = filteredSales.reduce((sum, s) => sum + parseFloat(s.total_amount || 0), 0);
            const totalProfit   = filteredSales.reduce((sum, s) => sum + parseFloat(s.total_profit || 0), 0);
            const totalExpenses = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount    || 0), 0);
            const cogs          = totalRevenue - totalProfit;
            const netProfit     = totalProfit - totalExpenses;
            const grossMargin   = totalRevenue > 0 ? ((totalProfit  / totalRevenue) * 100).toFixed(1) : '0.0';
            const netMargin     = totalRevenue > 0 ? ((netProfit    / totalRevenue) * 100).toFixed(1) : '0.0';
            const expensePct    = totalRevenue > 0 ? ((totalExpenses/ totalRevenue) * 100).toFixed(1) : '0.0';

            // Range label for display
            const rangeLabel = currentRange === 'today' ? 'Today'
                             : currentRange === 'week'  ? 'This Week'
                             : currentRange === 'month' ? 'This Month'
                             : currentRange === 'year'  ? 'This Year'
                             : 'Custom Range';

            document.getElementById('profitKpi').innerHTML = `
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Gross Profit <small style="font-size:0.7rem;color:#9ca3af">(${rangeLabel})</small></span><div class="kpi-icon"><i class="fas fa-chart-line"></i></div></div>
                    <div class="kpi-value">${formatCurrency(totalProfit)}</div>
                    <div class="kpi-change positive">${grossMargin}% gross margin</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Net Profit <small style="font-size:0.7rem;color:#9ca3af">(${rangeLabel})</small></span><div class="kpi-icon"><i class="fas fa-chart-pie"></i></div></div>
                    <div class="kpi-value" style="color:${netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatCurrency(netProfit)}</div>
                    <div class="kpi-change ${netProfit >= 0 ? 'positive' : 'negative'}">${netMargin}% net margin</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Total Revenue <small style="font-size:0.7rem;color:#9ca3af">(${rangeLabel})</small></span><div class="kpi-icon"><i class="fas fa-rupee-sign"></i></div></div>
                    <div class="kpi-value">${formatCurrency(totalRevenue)}</div>
                    <div class="kpi-change">${filteredSales.length} transactions</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Operating Expenses <small style="font-size:0.7rem;color:#9ca3af">(${rangeLabel})</small></span><div class="kpi-icon"><i class="fas fa-wallet"></i></div></div>
                    <div class="kpi-value">${formatCurrency(totalExpenses)}</div>
                    <div class="kpi-change negative">${expensePct}% of revenue</div>
                </div>
            `;

            document.getElementById('plStatement').innerHTML = `
                <h3 style="margin:0 0 1rem;font-size:1rem;color:var(--gray-600)">P&L Statement — ${rangeLabel}</h3>
                <div class="pl-row"><span class="pl-label">Total Revenue</span><span class="pl-value">${formatCurrency(totalRevenue)}</span></div>
                <div class="pl-row"><span class="pl-label">Cost of Goods Sold (COGS)</span><span class="pl-value negative">${formatCurrency(cogs)}</span></div>
                <div class="pl-row"><span class="pl-label">Gross Profit</span><span class="pl-value positive">${formatCurrency(totalProfit)}</span></div>
                <div class="pl-row"><span class="pl-label">Gross Margin</span><span class="pl-value">${grossMargin}%</span></div>
                <div class="pl-row"><span class="pl-label">Operating Expenses</span><span class="pl-value negative">${formatCurrency(totalExpenses)}</span></div>
                <div class="pl-row total"><span class="pl-label">Net Profit / Loss</span><span class="pl-value ${netProfit >= 0 ? 'positive' : 'negative'}">${formatCurrency(netProfit)}</span></div>
                <div class="pl-row total"><span class="pl-label">Net Profit Margin</span><span class="pl-value ${netMargin >= 0 ? 'positive' : 'negative'}">${netMargin}%</span></div>
            `;

            // Profit trend chart — show monthly breakdown for current year from ALL sales
            // so the trend line is always meaningful regardless of date range filter
            const ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const curYear = new Date().getFullYear();
            const profitMap  = {}, revenueMap  = {}, expenseMap  = {};
            ORDER.forEach(m => { profitMap[m] = 0; revenueMap[m] = 0; expenseMap[m] = 0; });

            allSales.forEach(s => {
                const d = new Date(s.created_at);
                if (d.getFullYear() !== curYear) return;
                const key = ORDER[d.getMonth()];
                profitMap[key]  += parseFloat(s.total_profit  || 0);
                revenueMap[key] += parseFloat(s.total_amount  || 0);
            });
            allExpenses.forEach(e => {
                const d = new Date(e.created_at || e.date);
                if (d.getFullYear() !== curYear) return;
                const key = ORDER[d.getMonth()];
                expenseMap[key] += parseFloat(e.amount || 0);
            });

            if (profitTrendChart) {
                profitTrendChart.data.labels = ORDER;
                profitTrendChart.data.datasets[0].data = ORDER.map(m => Math.round(profitMap[m]));
                profitTrendChart.data.datasets[1].data = ORDER.map(m => Math.round(expenseMap[m]));
                profitTrendChart.data.datasets[2].data = ORDER.map(m => Math.round(profitMap[m] - expenseMap[m]));
                profitTrendChart.update('none');
                return;
            }
            const ctx = document.getElementById('profitTrendChart').getContext('2d');
            profitTrendChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ORDER,
                    datasets: [
                        {
                            label: 'Gross Profit',
                            data: ORDER.map(m => Math.round(profitMap[m])),
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16,185,129,0.08)',
                            fill: true, tension: 0.4,
                            pointBackgroundColor: '#10b981', pointBorderColor: '#fff',
                            pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
                        },
                        {
                            label: 'Expenses',
                            data: ORDER.map(m => Math.round(expenseMap[m])),
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239,68,68,0.05)',
                            fill: false, tension: 0.4, borderDash: [5,3],
                            pointBackgroundColor: '#ef4444', pointBorderColor: '#fff',
                            pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
                        },
                        {
                            label: 'Net Profit',
                            data: ORDER.map(m => Math.round(profitMap[m] - expenseMap[m])),
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99,102,241,0.05)',
                            fill: false, tension: 0.4,
                            pointBackgroundColor: '#6366f1', pointBorderColor: '#fff',
                            pointBorderWidth: 2, pointRadius: 4, pointHoverRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 400 },
                    plugins: {
                        legend: { position: 'top', labels: { usePointStyle: true, font: { size: 11 }, padding: 16 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
                    },
                    scales: {
                        y: {
                            ticks: {
                                callback: v => v >= 100000 ? '₹'+(v/100000).toFixed(1)+'L'
                                             : v >= 1000   ? '₹'+(v/1000).toFixed(0)+'k'
                                             : '₹'+v,
                                maxTicksLimit: 6
                            },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        // ─── Inventory Report ─────────────────────────────────────────────────────
        async function loadInventoryReport() {
            const totalProducts = allProducts.length;
            const lowStock      = allProducts.filter(p => p.current_stock <= p.min_stock && p.current_stock > 0).length;
            const outOfStock    = allProducts.filter(p => p.current_stock === 0).length;
            const inStock       = totalProducts - lowStock - outOfStock;
            const stockValue    = allProducts.reduce((sum, p) => sum + ((parseFloat(p.purchase_price) || 0) * (parseFloat(p.current_stock) || 0)), 0);
            const thisMonth     = new Date().getMonth();
            const thisYear      = new Date().getFullYear();

            document.getElementById('inventoryKpi').innerHTML = `
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Total Products</span><div class="kpi-icon"><i class="fas fa-box"></i></div></div>
                    <div class="kpi-value">${formatNumber(totalProducts)}</div>
                    <div class="kpi-change positive">+${allProducts.filter(p => { const d = new Date(p.created_at); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; }).length} this month</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Stock Value</span><div class="kpi-icon"><i class="fas fa-rupee-sign"></i></div></div>
                    <div class="kpi-value">${formatCurrency(stockValue)}</div>
                    <div class="kpi-change">Current stock value</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Low Stock Items</span><div class="kpi-icon"><i class="fas fa-exclamation-triangle"></i></div></div>
                    <div class="kpi-value">${formatNumber(lowStock)}</div>
                    <div class="kpi-change negative">Need attention</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Out of Stock</span><div class="kpi-icon"><i class="fas fa-times-circle"></i></div></div>
                    <div class="kpi-value">${formatNumber(outOfStock)}</div>
                    <div class="kpi-change negative">Urgent reorder</div>
                </div>
            `;

            if (inventoryStatusChart) {
                inventoryStatusChart.data.labels = [`In Stock (${inStock})`, `Low Stock (${lowStock})`, `Out of Stock (${outOfStock})`];
                inventoryStatusChart.data.datasets[0].data = [inStock, lowStock, outOfStock];
                inventoryStatusChart.update('none');
            } else {
                const ctx = document.getElementById('inventoryStatusChart').getContext('2d');
                inventoryStatusChart = new Chart(ctx, {
                    type: 'doughnut',
                data: {
                    labels: [`In Stock (${inStock})`, `Low Stock (${lowStock})`, `Out of Stock (${outOfStock})`],
                    datasets: [{
                        data: [inStock, lowStock, outOfStock],
                        backgroundColor: ['#10b981','#f59e0b','#ef4444'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } },
                    cutout: '60%'
                }
            });
            }

            document.getElementById('inventoryStatus').innerHTML = `
                <div class="inventory-status">
                    <div class="status-item"><span class="status-name">In Stock</span><span class="status-count">${inStock} items</span><div class="status-bar"><div class="status-progress" style="width:${totalProducts ? (inStock/totalProducts*100) : 0}%"></div></div></div>
                    <div class="status-item"><span class="status-name">Low Stock</span><span class="status-count">${lowStock} items</span><div class="status-bar"><div class="status-progress" style="width:${totalProducts ? (lowStock/totalProducts*100) : 0}%;background:var(--warning);"></div></div></div>
                    <div class="status-item"><span class="status-name">Out of Stock</span><span class="status-count">${outOfStock} items</span><div class="status-bar"><div class="status-progress" style="width:${totalProducts ? (outOfStock/totalProducts*100) : 0}%;background:var(--danger);"></div></div></div>
                </div>
            `;
        }

        // ─── Expense Report ───────────────────────────────────────────────────────
        async function loadExpenseReport() {
            // Use filtered expenses so KPI cards respond to date range changes
            const filteredExpenses = filterExpensesByDate(allExpenses);
            const totalExpenses    = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
            const fixedExpenses    = filteredExpenses.filter(e => ['rent','salary'].includes(e.category)).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
            const variableExpenses = filteredExpenses.filter(e => ['electricity','water','internet'].includes(e.category)).reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
            const oneTimeExpenses  = totalExpenses - fixedExpenses - variableExpenses;

            const rangeLabel = currentRange === 'today' ? 'Today'
                             : currentRange === 'week'  ? 'This Week'
                             : currentRange === 'month' ? 'This Month'
                             : currentRange === 'year'  ? 'This Year'
                             : 'Custom Range';

            document.getElementById('expenseKpi').innerHTML = `
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Total Expenses <small style="font-size:0.7rem;color:#9ca3af">(${rangeLabel})</small></span><div class="kpi-icon"><i class="fas fa-wallet"></i></div></div>
                    <div class="kpi-value">${formatCurrency(totalExpenses)}</div>
                    <div class="kpi-change negative">${filteredExpenses.length} transactions</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Fixed Expenses</span><div class="kpi-icon"><i class="fas fa-home"></i></div></div>
                    <div class="kpi-value">${formatCurrency(fixedExpenses)}</div>
                    <div class="kpi-change">${totalExpenses ? ((fixedExpenses/totalExpenses)*100).toFixed(1) : 0}% of total</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">Variable Expenses</span><div class="kpi-icon"><i class="fas fa-chart-line"></i></div></div>
                    <div class="kpi-value">${formatCurrency(variableExpenses)}</div>
                    <div class="kpi-change">${totalExpenses ? ((variableExpenses/totalExpenses)*100).toFixed(1) : 0}% of total</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-header"><span class="kpi-title">One-time Expenses</span><div class="kpi-icon"><i class="fas fa-bolt"></i></div></div>
                    <div class="kpi-value">${formatCurrency(oneTimeExpenses)}</div>
                    <div class="kpi-change">${totalExpenses ? ((oneTimeExpenses/totalExpenses)*100).toFixed(1) : 0}% of total</div>
                </div>
            `;

            // Pie chart — category breakdown from filtered expenses
            const categoryTotals = {};
            filteredExpenses.forEach(e => {
                const cat = e.category || 'Other';
                categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(e.amount || 0);
            });
            const catLabels = Object.keys(categoryTotals);
            const catValues = catLabels.map(k => categoryTotals[k]);

            if (expenseChart) {
                expenseChart.data.labels = catLabels.length ? catLabels : ['No Data'];
                expenseChart.data.datasets[0].data = catValues.length ? catValues : [1];
                expenseChart.update('none');
            } else {
                const ctx = document.getElementById('expenseChart').getContext('2d');
                expenseChart = new Chart(ctx, {
                    type: 'pie',
                data: {
                    labels: catLabels.length ? catLabels : ['No Data'],
                    datasets: [{
                        data: catValues.length ? catValues : [1],
                        backgroundColor: ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 11 }, padding: 12 } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)}` } }
                    }
                }
            });
            }

            // Trend bar chart — always full year from allExpenses so the trend is visible
            const ORDER   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const curYear = new Date().getFullYear();
            const monthlyExp = {};
            ORDER.forEach(m => { monthlyExp[m] = 0; });
            allExpenses.forEach(e => {
                const d = new Date(e.created_at || e.date);
                if (d.getFullYear() !== curYear) return;
                const key = ORDER[d.getMonth()];
                monthlyExp[key] += parseFloat(e.amount || 0);
            });

            if (expenseTrendChart) {
                expenseTrendChart.data.labels = ORDER;
                expenseTrendChart.data.datasets[0].data = ORDER.map(m => Math.round(monthlyExp[m]));
                expenseTrendChart.update('none');
            } else {
                const trendCtx = document.getElementById('expenseTrendChart').getContext('2d');
                expenseTrendChart = new Chart(trendCtx, {
                    type: 'bar',
                data: {
                    labels: ORDER,
                    datasets: [{
                        label: 'Expenses',
                        data: ORDER.map(m => Math.round(monthlyExp[m])),
                        backgroundColor: 'rgba(99,102,241,0.75)',
                        borderColor: '#6366f1',
                        borderWidth: 1,
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 400 },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => ` Expenses: ${formatCurrency(ctx.raw)}` } }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: v => v >= 100000 ? '₹'+(v/100000).toFixed(1)+'L'
                                             : v >= 1000   ? '₹'+(v/1000).toFixed(0)+'k'
                                             : '₹'+v,
                                maxTicksLimit: 6
                            },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
            }
        }

        // ─── Product Analysis ─────────────────────────────────────────────────────
        async function loadProductAnalysis() {
            try {
                const response = await fetch('/api/reports/top-products?limit=10', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                const topProducts = (data.success && data.products) ? data.products : [];
                const bestSeller  = topProducts.length > 0 ? topProducts[0] : null;

                document.getElementById('productKpi').innerHTML = `
                    <div class="kpi-card">
                        <div class="kpi-header"><span class="kpi-title">Best Seller</span><div class="kpi-icon"><i class="fas fa-trophy"></i></div></div>
                        <div class="kpi-value">${escapeHtml(bestSeller?.name || 'N/A')}</div>
                        <div class="kpi-change">${bestSeller?.total_quantity || 0} units sold</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-header"><span class="kpi-title">Total Products</span><div class="kpi-icon"><i class="fas fa-box"></i></div></div>
                        <div class="kpi-value">${allProducts.length}</div>
                        <div class="kpi-change">in inventory</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-header"><span class="kpi-title">Total Sales</span><div class="kpi-icon"><i class="fas fa-shopping-cart"></i></div></div>
                        <div class="kpi-value">${allSales.length}</div>
                        <div class="kpi-change">transactions</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-header"><span class="kpi-title">Total Revenue</span><div class="kpi-icon"><i class="fas fa-rupee-sign"></i></div></div>
                        <div class="kpi-value">${formatCurrency(allSales.reduce((s, sale) => s + parseFloat(sale.total_amount || 0), 0))}</div>
                        <div class="kpi-change">overall</div>
                    </div>
                `;

                if (topProducts.length === 0) {
                    document.getElementById('productPerformanceTable').innerHTML = '<div class="loading">No sales data yet. Make some sales to see product performance!</div>';
                    return;
                }

                document.getElementById('productPerformanceTable').innerHTML = `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Rank</th><th>Product</th><th>Category</th>
                                <th>Quantity Sold</th><th>Revenue</th><th>Profit</th><th>Margin</th><th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topProducts.map((p, i) => {
                                const margin = p.total_revenue > 0 ? ((p.total_profit / p.total_revenue) * 100).toFixed(1) : 0;
                                return `
                                    <tr>
                                        <td><div class="rank-badge rank-${Math.min(i+1,3)}">${i+1}</div></td>
                                        <td>
                                            <div class="product-cell">
                                                <div class="product-icon"><i class="fas fa-box"></i></div>
                                                <div><strong>${escapeHtml(p.name)}</strong><br><small>ID: ${p.id}</small></div>
                                            </div>
                                        </td>
                                        <td>${escapeHtml(p.category_name || 'Uncategorized')}</td>
                                        <td>${formatNumber(p.total_quantity)} units</td>
                                        <td class="positive">${formatCurrency(p.total_revenue)}</td>
                                        <td class="positive">${formatCurrency(p.total_profit)}</td>
                                        <td class="${margin >= 0 ? 'positive' : 'negative'}">${margin}%</td>
                                        <td><span class="status-badge ${p.total_quantity > 0 ? 'completed' : 'pending'}">${p.total_quantity > 0 ? 'Selling' : 'No Sales'}</span></td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                `;
            } catch (error) {
                document.getElementById('productPerformanceTable').innerHTML = '<div class="loading">Error loading product data</div>';
            }
        }

        // ─── Load All Reports ─────────────────────────────────────────────────────
        async function loadAllReports() {
            await loadSalesReport();
            await loadProfitLossReport();
            await loadInventoryReport();
            await loadExpenseReport();
            await loadProductAnalysis();
        }

        // ─── FIX 3 + 4: Range & Tab controls — pass element reference explicitly ──
        function setRange(range, el) {
            currentRange      = range;
            customStartDate   = null;
            customEndDate     = null;
            document.querySelectorAll('.range-btn').forEach(btn => btn.classList.remove('active'));
            if (el) el.classList.add('active');
            loadAllReports();
        }

        function applyCustomRange() {
            customStartDate = document.getElementById('startDate').value;
            customEndDate   = document.getElementById('endDate').value;
            if (!customStartDate || !customEndDate) { alert('Please select both start and end dates.'); return; }
            currentRange = 'custom';
            document.querySelectorAll('.range-btn').forEach(btn => btn.classList.remove('active'));
            loadAllReports();
        }

        // FIX 4: Accepts element reference directly — no implicit global `event`
        function switchReportTab(tab, el) {
            document.querySelectorAll('.report-tab').forEach(btn => btn.classList.remove('active'));
            if (el) el.classList.add('active');
            document.querySelectorAll('.report-section').forEach(section => section.classList.remove('active'));
            const section = document.getElementById(tab + 'Report');
            if (section) section.classList.add('active');
        }

        // ─── Export / Utility ─────────────────────────────────────────────────────
        function generateReport()    { alert('Generating comprehensive report...'); }
        function scheduleReport()    { alert('Schedule report dialog opened'); }
        function exportPDF()         { alert('Exporting as PDF...'); }
        function exportExcel()       { exportCSV(); }
        function exportTopProducts() { exportCSV(); }
        function printReport()       { window.print(); }

        function exportCSV() {
            if (!allSales.length && !allProducts.length) { alert('No data to export'); return; }
            const rows    = allSales.map(s => `${s.invoice_no},${s.total_amount},${s.total_profit},${new Date(s.created_at).toLocaleString()}`);
            const csv     = '\uFEFF' + 'Invoice,Amount,Profit,Date\n' + rows.join('\n');
            const blob    = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a       = document.createElement('a');
            a.href        = URL.createObjectURL(blob);
            a.download    = `report_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function logout() {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }

        // ─── Init ─────────────────────────────────────────────────────────────────
        document.addEventListener('DOMContentLoaded', () => {
            loadUserInfo();
            loadAllData();

            const qaBtn  = document.querySelector('.quick-actions-btn');
            const qaMenu = document.querySelector('.quick-actions-menu');
            if (qaBtn && qaMenu) {
                qaBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    qaMenu.classList.toggle('open');
                    qaBtn.style.transform = qaMenu.classList.contains('open') ? 'rotate(45deg)' : 'rotate(0deg)';
                });
                document.addEventListener('click', e => {
                    if (qaMenu.classList.contains('open') && !qaBtn.contains(e.target) && !qaMenu.contains(e.target)) {
                        qaMenu.classList.remove('open');
                        qaBtn.style.transform = 'rotate(0deg)';
                    }
                });
                qaMenu.addEventListener('click', e => e.stopPropagation());
            }
        });

        // Auto-refresh every 2 seconds
        setInterval(() => loadAllData(), 2000);
    