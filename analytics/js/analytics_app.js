// analytics/js/app.js - Business Intelligence & ILUO Cost Analysis
let chartTopOFs = null;
let chartIluoDist = null;

let TARIFA_BASE = 20; // 20€/h por defecto si no hay tarifa ETT
let trainingThreshold = 2; // Niveles 1 y 2 = Formación/Muda

document.addEventListener('DOMContentLoaded', async () => {
    // Iniciar reloj (shared.js)
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#94a3b8';

    const btnCalculate = document.getElementById('btn-calculate');
    if (btnCalculate) {
        btnCalculate.addEventListener('click', calculateFinancials);
    }

    // Inicializar visualización
    await loadConfig();
    await calculateFinancials();
});

async function loadConfig() {
    try {
        const configDoc = await db.collection('configuracion').doc('global').get();
        if (configDoc.exists) {
            const data = configDoc.data();
            if (data.tarifaETT) {
                TARIFA_BASE = parseFloat(data.tarifaETT);
            }
        }
        // El KPI de tarifa ya no se muestra en el dashboard
    } catch (e) {
        console.error("Error cargando configuración:", e);
    }
}

async function calculateFinancials() {
    const btn = document.getElementById('btn-calculate');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Calculando...';
    }

    try {
        const lineaFilter = document.getElementById('filter-linea').value;
        const ofFilter = document.getElementById('filter-of').value.trim().toUpperCase();

        // 1. Obtener TODOS los scores ILUO (sin filtrar por línea: la competencia
        //    de una persona es suya, independientemente de en qué línea se subió el Excel.
        //    El filtro de línea se aplica a los FICHAJES, que es donde tiene sentido).
        const scoresSnap = await db.collection('skill_scores').get();

        // workerId -> { seccion -> { sum, count } }  (acumula por si hay varios docs)
        const workerAgg = {};

        scoresSnap.forEach(doc => {
            const data = doc.data();
            const wId = data.idTrabajador;
            const sec = (data.seccion || '').toUpperCase();
            if (!wId || !sec) return;

            Object.values(data.scores || {}).forEach(v => {
                const nivel = Number(v) || 0;
                if (nivel < 1) return;   // 0 = sin evaluación, no cuenta en la media
                ((workerAgg[wId] ||= {})[sec] ||= { sum: 0, count: 0 });
                workerAgg[wId][sec].sum += nivel;
                workerAgg[wId][sec].count++;
            });
        });

        // workerId -> { seccion -> media }, y clasificación por OPERARIO ÚNICO
        const workerAverages = {};
        let countProductivos = 0;   // media global del operario > umbral
        let countAprendices = 0;

        Object.entries(workerAgg).forEach(([wId, secs]) => {
            workerAverages[wId] = {};
            let gSum = 0, gCount = 0;
            Object.entries(secs).forEach(([sec, agg]) => {
                workerAverages[wId][sec] = agg.sum / agg.count;
                gSum += agg.sum; gCount += agg.count;
            });
            if (gCount > 0) {
                if (gSum / gCount > trainingThreshold) countProductivos++;
                else countAprendices++;
            }
        });
        const totalWorkersAnalized = countProductivos + countAprendices;

        // 2. Obtener los fichajes, filtrados por línea si procede
        let fichajesQuery = db.collection('fichajes');
        if (lineaFilter) {
            fichajesQuery = fichajesQuery.where('linea', '==', lineaFilter);
        }
        const fichajesSnap = await fichajesQuery.get();

        // Estructuras de datos para los KPIs
        let totalCoste = 0;
        let totalHorasMuda = 0;
        const costByOF = {};
        const workerDetails = []; // Para la tabla

        fichajesSnap.forEach(doc => {
            const data = doc.data();
            const workerId = String(data.trabajador || data.operario || '').trim().toUpperCase();
            const ofNum = data.of || 'SIN OF';
            const dept = (data.departamento || '').toUpperCase();
            const horas = parseFloat(data.tiempo) || 0;

            if (horas <= 0 || !workerId) return;

            // Filtro por OF (coincidencia parcial)
            if (ofFilter && !ofNum.includes(ofFilter)) return;

            // Nivel del operario en la sección del fichaje.
            // Conservadurismo financiero: sin evaluación en esa sección => Nivel 1 (Muda).
            let avgLevel = 1;
            if (workerAverages[workerId] && workerAverages[workerId][dept] !== undefined) {
                avgLevel = workerAverages[workerId][dept];
            }

            // Aplicar regla de negocio (Muda)
            if (avgLevel <= trainingThreshold) {
                const costeFichaje = horas * TARIFA_BASE;
                totalCoste += costeFichaje;
                totalHorasMuda += horas;

                costByOF[ofNum] = (costByOF[ofNum] || 0) + costeFichaje;

                workerDetails.push({
                    operario: workerId,
                    of: ofNum,
                    seccion: dept,
                    nivel: avgLevel.toFixed(1),
                    horas: horas.toFixed(1),
                    coste: costeFichaje.toFixed(2)
                });
            }
        });

        // Actualizar KPIs de Arriba
        document.getElementById('kpi-coste-total').textContent = `${totalCoste.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})} €`;
        document.getElementById('kpi-horas-total').textContent = `${totalHorasMuda.toFixed(1)} h`;
        
        let pctAutonomia = 0;
        if (totalWorkersAnalized > 0) {
            pctAutonomia = Math.round((countProductivos / totalWorkersAnalized) * 100);
        }
        document.getElementById('kpi-autonomia').textContent = `${pctAutonomia}%`;

        // Gráfico 1: Top OFs
        const sortedOFs = Object.entries(costByOF).sort((a, b) => b[1] - a[1]).slice(0, 5);
        renderTopOFChart(sortedOFs);

        // Gráfico 2: Distribución
        renderDistChart(countProductivos, countAprendices);

        // Tabla Detalles
        renderTable(workerDetails);

    } catch (e) {
        console.error("Error calculando analíticas:", e);
        if (typeof showToast === 'function') showToast("Error calculando costes", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Calcular';
        }
    }
}

function renderTopOFChart(sortedData) {
    const ctx = document.getElementById('chart-top-ofs').getContext('2d');
    if (chartTopOFs) chartTopOFs.destroy();

    const labels = sortedData.map(d => d[0]);
    const values = sortedData.map(d => d[1]);

    chartTopOFs = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Coste Formación (€)',
                data: values,
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderColor: '#ef4444',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    grid: { color: 'rgba(51, 65, 85, 0.5)' },
                    ticks: { callback: (val) => val + ' €' }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.parsed.y.toLocaleString('es-ES')} €`
                    }
                }
            }
        }
    });
}

function renderDistChart(productivos, aprendices) {
    const ctx = document.getElementById('chart-iluo-dist').getContext('2d');
    if (chartIluoDist) chartIluoDist.destroy();

    chartIluoDist = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Productivos (Nivel 3-4)', 'Aprendices / Muda (Nivel 1-2)'],
            datasets: [{
                data: [productivos, aprendices],
                backgroundColor: ['rgba(16, 185, 129, 0.8)', 'rgba(239, 68, 68, 0.8)'],
                borderColor: '#1e293b',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function renderTable(details) {
    const tbody = document.getElementById('table-details-body');
    tbody.innerHTML = '';
    
    // Ordenar de mayor a menor coste
    details.sort((a, b) => parseFloat(b.coste) - parseFloat(a.coste));
    
    // Coger top 20 para no saturar
    const top20 = details.slice(0, 20);
    
    if (top20.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">No hay registros de costes de formación</td></tr>`;
        return;
    }

    top20.forEach(row => {
        let nivelBadgeClass = 'badge-danger';
        if (parseFloat(row.nivel) > 1.5) nivelBadgeClass = 'badge-warning';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${row.operario}</strong></td>
            <td>${row.of}</td>
            <td>${row.seccion}</td>
            <td><span class="badge ${nivelBadgeClass}">Lvl ${row.nivel}</span></td>
            <td>${row.horas} h</td>
            <td style="color: #ef4444; font-weight: 700;">${parseFloat(row.coste).toLocaleString('es-ES', {minimumFractionDigits: 2})} €</td>
        `;
        tbody.appendChild(tr);
    });
}
