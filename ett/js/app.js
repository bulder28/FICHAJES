// js/app.js para el Dashboard Financiero ETT

// TARIFA_HORA_ETT y HORAS_AUTONOMO ahora se leen de Configuración Global

let operariosETT = []; // Array enriquecido con datos financieros
let chartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    const searchInput = document.getElementById('search-ett');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderTable(searchInput.value));
    }

    const filterDate = document.getElementById('filter-date-ett');
    if (filterDate) {
        filterDate.addEventListener('change', async () => {
            await loadFinancialData();
        });
    }

    await loadFinancialData();
});

async function loadFinancialData() {
    if (typeof updateDbStatus === 'function') updateDbStatus(false);
    
    try {
        const config = typeof getGlobalConfig === 'function' ? await getGlobalConfig() : { tarifaETT: 18, umbralAutonomia: 10 };
        const HORAS_AUTONOMO = config.umbralAutonomia || 10;
        const TARIFA = config.tarifaETT || 18.0;

        // [FIX BUG-11] Actualizar display de tarifa dinámicamente desde config global
        const tarifaDisplay = document.getElementById('ett-tarifa-display');
        if (tarifaDisplay) tarifaDisplay.textContent = `${TARIFA.toFixed(2)}€ / Hora`;

        // 1. Cargar Operarios
        const operariosSnap = await db.collection('operarios').get();
        const todosOperarios = [];
        operariosSnap.forEach(doc => {
            todosOperarios.push({ id: doc.id, ...doc.data() });
        });

        // Ya no hay simulación: Usamos directamente el flag isETT que se marca en Configuración
        const etts = todosOperarios.filter(op => {
            return op.isETT === true || op.agencia === 'EUROFIRMS' || op.agencia === 'AURA';
        });

        // 2. Cargar Fichajes y filtrar por fecha
        const dateFilter = document.getElementById('filter-date-ett') ? document.getElementById('filter-date-ett').value : 'ALL';
        const now = new Date();
        let cutoffTime = 0; // ms
        
        if (dateFilter === 'MONTH') {
            cutoffTime = now.getTime() - (30 * 24 * 60 * 60 * 1000);
        } else if (dateFilter === 'QUARTER') {
            cutoffTime = now.getTime() - (90 * 24 * 60 * 60 * 1000);
        } else if (dateFilter === 'YEAR') {
            cutoffTime = now.getTime() - (365 * 24 * 60 * 60 * 1000);
        }

        const fichajesSnap = await db.collection('fichajes').get();
        const horasPorTrabajador = {}; // idT -> { departamento: horas }

        fichajesSnap.forEach(doc => {
            const f = doc.data();
            const idT = f.trabajador;
            // [FIX BUG-01] Campo correcto: 'departamento' (antes era 'operacion' — campo que nunca se guardaba)
            const dept = (f.departamento || '').trim();
            const h = parseFloat(f.tiempo) || 0;
            
            // Filtrar por fecha según selector
            let recordTime = 0;
            if (f.createdAt && f.createdAt.toMillis) {
                recordTime = f.createdAt.toMillis();
            } else if (f.fecha) {
                recordTime = new Date(f.fecha).getTime();
            } else {
                recordTime = now.getTime();
            }

            if (idT && dept && recordTime >= cutoffTime) {
                if (!horasPorTrabajador[idT]) horasPorTrabajador[idT] = {};
                if (!horasPorTrabajador[idT][dept]) horasPorTrabajador[idT][dept] = 0;
                horasPorTrabajador[idT][dept] += h;
            }
        });

        // 3. Calcular Costes por ETT
        operariosETT = etts.map(ett => {
            let totalHorasFormacion = 0;
            let isLearning = false;

            const horasDepts = horasPorTrabajador[ett.idTrabajador] || {};
            
            // [FIX BUG-01] Iterar dinámicamente sobre los departamentos reales del trabajador
            const depts = Object.keys(horasDepts);
            
            depts.forEach(dept => {
                const h = horasDepts[dept] || 0;
                
                // Las horas que consideramos "coste de formación" son las primeras hasta el umbral de autonomía.
                const horasComputables = Math.min(h, HORAS_AUTONOMO);
                totalHorasFormacion += horasComputables;

                // Si en algún departamento tiene menos de 10h, está en aprendizaje
                if (h > 0 && h < HORAS_AUTONOMO) {
                    isLearning = true;
                }
            });

            // Si no tiene horas de nada, también está en aprendizaje
            if (depts.length === 0) {
                isLearning = true;
            }

            const costeTotal = totalHorasFormacion * TARIFA;

            return {
                ...ett,
                horasFormacion: totalHorasFormacion,
                coste: costeTotal,
                isLearning: isLearning
            };
        });

        updateKPIs();
        renderChart();
        renderTable();

        if (typeof updateDbStatus === 'function') updateDbStatus(true);
    } catch (error) {
        console.error("Error calculando finanzas:", error);
    }
}

function updateKPIs() {
    const totalEtt = operariosETT.length;
    const learning = operariosETT.filter(e => e.isLearning).length;
    
    let totalCost = 0;
    operariosETT.forEach(e => totalCost += e.coste);

    const avgCost = totalEtt > 0 ? (totalCost / totalEtt) : 0;

    document.getElementById('kpi-total-ett').textContent = totalEtt;
    document.getElementById('kpi-learning-ett').textContent = learning;
    
    // Formatear moneda
    const formatCurrency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    
    document.getElementById('kpi-total-cost').textContent = formatCurrency.format(totalCost);
    document.getElementById('kpi-avg-cost').textContent = formatCurrency.format(avgCost);
}

function renderChart() {
    const ctx = document.getElementById('agencyChart').getContext('2d');
    
    let costEurofirms = 0;
    let costAura = 0;

    operariosETT.forEach(e => {
        if (e.agencia === 'EUROFIRMS') costEurofirms += e.coste;
        if (e.agencia === 'AURA') costAura += e.coste;
    });

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Eurofirms', 'Aura'],
            datasets: [{
                data: [costEurofirms, costAura],
                backgroundColor: ['#1e3a8a', '#86198f'], // Azul y Morado
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' }
            },
            cutout: '70%'
        }
    });
}

function renderTable(searchTerm = '') {
    const tbody = document.getElementById('ett-body');
    tbody.innerHTML = '';
    searchTerm = searchTerm.toUpperCase().trim();

    const filtered = operariosETT.filter(e => {
        return e.idTrabajador.toUpperCase().includes(searchTerm);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #64748b;">No se encontraron operarios.</td></tr>`;
        return;
    }
    
    const formatCurrency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

    // Ordenar por coste (de mayor a menor gasto)
    filtered.sort((a, b) => b.coste - a.coste).forEach(ett => {
        const tr = document.createElement('tr');
        
        const badgeClass = ett.agencia === 'EUROFIRMS' ? 'badge-eurofirms' : 'badge-aura';
        const agenciaLabel = ett.agencia || 'ETT';

        const statusDot = ett.isLearning ? '<span class="status-dot-ett status-training"></span> En Formación' : '<span class="status-dot-ett status-autonomous"></span> Autónomo';
        
        tr.innerHTML = `
            <td>
                <div style="font-weight: 600; color: var(--text-primary);">${ett.idTrabajador}</div>
            </td>
            <td><span class="badge-agency ${badgeClass}">${agenciaLabel}</span></td>
            <td style="text-align: center; font-weight: 600;">${ett.horasFormacion.toFixed(1)}h</td>
            <td style="text-align: center;">${statusDot}</td>
            <td style="text-align: right; font-weight: 700; color: var(--stulz-red); font-variant-numeric: tabular-nums;">
                ${formatCurrency.format(ett.coste)}
            </td>
        `;

        tbody.appendChild(tr);
    });
}
