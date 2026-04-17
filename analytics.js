let revenueChartInstance = null;

async function renderAnalytics() {
    const sessions = await DB.getAll('sessions');
    
    // Aggregation logic
    let totalRevenue = 0;
    const vehicleCounts = {};
    const revenueByDay = {};

    sessions.forEach(session => {
        totalRevenue += session.price;
        
        // Count vehicle usage
        vehicleCounts[session.vehicleId] = (vehicleCounts[session.vehicleId] || 0) + 1;
        
        // Revenue by day (simple format YYYY-MM-DD)
        const date = new Date(session.endTime).toISOString().split('T')[0];
        revenueByDay[date] = (revenueByDay[date] || 0) + session.price;
    });

    // Update stats UI
    document.getElementById('stat-revenue').textContent = `$${totalRevenue.toFixed(2)}`;
    
    // Find most popular
    const popularId = Object.keys(vehicleCounts).reduce((a, b) => vehicleCounts[a] > vehicleCounts[b] ? a : b, null);
    if(popularId) {
        const fleet = await DB.getAll('fleet');
        const popVehicle = fleet.find(v => v.id === popularId);
        document.getElementById('stat-popular').textContent = popVehicle ? popVehicle.name : popularId;
    }

    // Chart.js Setup
    const ctx = document.getElementById('revenueChart').getContext('2d');
    const labels = Object.keys(revenueByDay).sort();
    const data = labels.map(date => revenueByDay[date]);

    if (revenueChartInstance) {
        revenueChartInstance.destroy();
    }

    revenueChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Revenue ($)',
                data: data,
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}