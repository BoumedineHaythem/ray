let revenueChartInstance = null;

async function renderAnalytics() {
    const sessions = await SessionStore.getCompleted();

    if (sessions.length === 0) {
        document.getElementById('stat-revenue').textContent  = '0.00 DA';
        document.getElementById('stat-sessions').textContent = '0';
        document.getElementById('stat-avg').textContent      = '0 DA';
        document.getElementById('stat-popular').textContent  = '-';
        return;
    }

    let totalRevenue = 0;
    const vehicleCounts = {};
    const revenueByDay  = {};

    sessions.forEach(s => {
        totalRevenue += s.price;
        vehicleCounts[s.vehicleId] = (vehicleCounts[s.vehicleId] || 0) + 1;
        const date = new Date(s.endTime).toISOString().split('T')[0];
        revenueByDay[date] = (revenueByDay[date] || 0) + s.price;
    });

    document.getElementById('stat-revenue').textContent  = `${totalRevenue.toFixed(2)} DA`;
    document.getElementById('stat-sessions').textContent = sessions.length;
    const avg = totalRevenue / sessions.length;
    document.getElementById('stat-avg').textContent = `${avg.toFixed(0)} DA`;

    // Most popular vehicle
    const popularId = Object.keys(vehicleCounts).reduce((a, b) =>
        vehicleCounts[a] > vehicleCounts[b] ? a : b, null);
    if (popularId) {
        const fleet      = await DB.getAll('fleet');
        const popVehicle = fleet.find(v => v.id === popularId);
        document.getElementById('stat-popular').textContent =
            popVehicle ? popVehicle.name : popularId;
    }

    // Revenue chart
    const ctx    = document.getElementById('revenueChart').getContext('2d');
    const labels = Object.keys(revenueByDay).sort();
    const data   = labels.map(d => revenueByDay[d]);

    if (revenueChartInstance) revenueChartInstance.destroy();

    const isDark    = document.body.classList.contains('dark-mode');
    const accent    = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const textColor = isDark ? '#8892b0' : '#6b7280';

    revenueChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Daily Revenue (DA)',
                data,
                borderColor: accent,
                backgroundColor: isDark ? 'rgba(96,165,250,0.1)' : 'rgba(59,130,246,0.08)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: accent,
                pointRadius: 4,
                pointHoverRadius: 6,
                borderWidth: 2.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1a1a2e' : '#fff',
                    titleColor: isDark ? '#f0f4ff' : '#1a1a2e',
                    bodyColor: accent,
                    borderColor: isDark ? '#2d2d4e' : '#e5e7eb',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid:  { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
                    ticks: { color: textColor, callback: v => v + ' DA' }
                },
                x: {
                    grid:  { display: false },
                    ticks: { color: textColor, maxTicksLimit: 7 }
                }
            }
        }
    });
}