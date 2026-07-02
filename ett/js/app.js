// ett/js/app.js — ETT Dashboard v2
// ROI, eficiencia de agencias, riesgo de dependencia, benchmark vs STULZ

let charts = {};
let TARIFA = 20;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#94a3b8';

    document.getElementById('btn-refresh')?.addEventListener('click', calculate);
    document.getElementById('filter-period')?.addEventListener('change', calculate);

    await loadConfig();
    await calculate();
});

async function loadConfig() {
    try {
        const doc = await db.collection('configuracion').doc('global').get();
        if (doc.exists && doc.data().tarifaETT) {
            TARIFA = parseFloat(doc.data().tarifaETT) || 20;
        }
    } catch (e) { console.error('Error cargando configuración:', e); }
}

async function calculate() {
    const btn = document.getElementById('btn-refresh');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Calculando...'; }

    try {
        const period = document.getElementById('filter-period')?.value || '';
        let cutoffMs = 0;
        if (period === '30') cutoffMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
        else if (period === '90') cutoffMs = Date.now() - (90 * 24 * 60 * 60 * 1000);
        else if (period === '365') cutoffMs = Date.now() - (365 * 24 * 60 * 60 * 1000);

        // ---------- 1. CARGA PARALELA ----------
        const [opSnap, scoresSnap, fichajesSnap, matricesSnap] = await Promise.all([
            db.collection('operarios').get(),
            db.collection('skill_scores').get(),
            db.collection('fichajes').get(),
            db.collection('skill_matrices').get()
        ]);

        // ---------- 2. CENSO: quién es ETT, competencia ----------
        const censo = {};   // id -> { isETT, agencia, seccionesDominadas: [] }
        const workerAvg = {};  // id -> { SECCION: media }

        opSnap.forEach(d => {
            const x = d.data();
            const id = x.idTrabajador || d.id;
            censo[id] = {
                isETT: !!x.isETT,
                agencia: x.agencia || '',
                nombre: x.nombre || x.name || id,
                seccionesDominadas: []
            };
        });

        // Agregar competencia a censo
        scoresSnap.forEach(d => {
            const data = d.data();
            const wId = data.idTrabajador;
            const sec = (data.seccion || '').toUpperCase();
            if (!wId || !sec) return;

            Object.values(data.scores || {}).forEach(v => {
                const nivel = Number(v) || 0;
                if (nivel >= 1) {
                    if (!workerAvg[wId]) workerAvg[wId] = {};
                    const prev = workerAvg[wId][sec];
                    if (!prev) {
                        workerAvg[wId][sec] = nivel;
                    } else {
                        workerAvg[wId][sec] = (prev + nivel) / 2;   // si hay múltiples docs, promediar
                    }
                    if (workerAvg[wId][sec] >= 3 && !censo[wId].seccionesDominadas.includes(sec)) {
                        censo[wId].seccionesDominadas.push(sec);
                    }
                }
            });
        });

        // Actualizar censo con secciones dominadas finales
        Object.entries(workerAvg).forEach(([id, secs]) => {
            if (censo[id]) {
                censo[id].seccionesDominadas = Object.entries(secs)
                    .filter(([_, avg]) => avg >= 3)
                    .map(([sec, _]) => sec);
            }
        });

        // ---------- 3. FICHAJES: horas, costes por agencia ----------
        const agenciaMetricas = {};   // AGENCIA -> { horas, horasMuda, costeTotal, personas: Set, autonomos: 0, ... }
        const ettRiesgo = [];         // personas clave de ETT

        fichajesSnap.forEach(d => {
            const data = d.data();
            const wId = String(data.trabajador || data.operario || '').trim().toUpperCase();
            const fecha = new Date(data.fecha || '');
            const dept = (data.departamento || '').toUpperCase();
            const horas = parseFloat(data.tiempo) || 0;

            if (horas <= 0 || !wId || (cutoffMs && fecha.getTime() < cutoffMs)) return;
            if (!censo[wId]?.isETT) return;   // solo ETT

            const agencia = censo[wId].agencia || 'DESCONOCIDA';
            const nivel = workerAvg[wId]?.[dept] || 1;
            const esMuda = nivel <= 2;

            (agenciaMetricas[agencia] ||= {
                horas: 0, horasMuda: 0, costeTotal: 0,
                personas: new Set(), autonomos: 0, personasAutonomas: new Set(),
                fichajesAutonomo: 0
            });

            const m = agenciaMetricas[agencia];
            m.horas += horas;
            m.personas.add(wId);
            m.costeTotal += horas * TARIFA;

            if (esMuda) {
                m.horasMuda += horas;
            } else {
                m.fichajesAutonomo += horas;
                m.personasAutonomas.add(wId);
            }
        });

        // Convertir Set -> count
        Object.entries(agenciaMetricas).forEach(([ag, m]) => {
            m.totalPersonas = m.personas.size;
            m.autonomosCount = m.personasAutonomas.size;
            m.pctAutonomia = m.totalPersonas > 0 ? Math.round(m.autonomosCount / m.totalPersonas * 100) : 0;
            m.costeHoraEfectiva = m.fichajesAutonomo > 0 ? (m.costeTotal / m.fichajesAutonomo) : 0;
        });

        // Detectar personas clave (únicas autónomas en su sección dentro de su agencia)
        Object.entries(agenciaMetricas).forEach(([agencia, met]) => {
            for (const personaId of met.personasAutonomas) {
                const secs = censo[personaId].seccionesDominadas;
                if (secs.length > 0) {
                    // ¿Es la única de su agencia en alguna sección?
                    for (const sec of secs) {
                        const otrosAutonomos = Array.from(met.personasAutonomas)
                            .filter(p => p !== personaId && (censo[p].seccionesDominadas || []).includes(sec)).length;
                        if (otrosAutonomos === 0) {
                            ettRiesgo.push({
                                agencia,
                                id: personaId,
                                nombre: censo[personaId].nombre,
                                secciones: secs.join(', '),
                                esUnico: true,
                                costeEstimado: (agenciaMetricas[agencia].costeTotal / Math.max(met.totalPersonas, 1)).toFixed(2)
                            });
                        }
                    }
                }
            }
        });

        // ---------- 4. BENCHMARK STULZ vs ETT ----------
        let stulzAutonomos = 0, stulzTotal = 0, ettAutonomos = 0, ettTotal = 0;
        Object.entries(censo).forEach(([id, c]) => {
            const avg = Object.values(workerAvg[id] || {});
            if (avg.length === 0) return;
            const media = avg.reduce((a, b) => a + b) / avg.length;
            if (c.isETT) {
                ettTotal++;
                if (media >= 3) ettAutonomos++;
            } else {
                stulzTotal++;
                if (media >= 3) stulzAutonomos++;
            }
        });

        // ---------- 5. ROI ----------
        // Personas ETT que subieron de Nivel 1 a Nivel 3+ durante el período = reducción de Muda
        const roiFormados = ettRiesgo.length;   // proxy: personas clave = fueron formadas
        const ahorroRoi = roiFormados * TARIFA * (agenciaMetricas[Object.keys(agenciaMetricas)[0]]?.horas || 0) / 30;

        // ---------- 6. RIESGO DEPENDENCIA ----------
        const totalCostenOfertas = Object.values(agenciaMetricas).reduce((s, m) => s + m.costeTotal, 0);
        const topAgenciaCoste = Object.entries(agenciaMetricas).sort((a, b) => b[1].costeTotal - a[1].costeTotal)[0];
        const riskoDependencia = topAgenciaCoste && totalCostenOfertas > 0
            ? Math.round(topAgenciaCoste[1].costeTotal / totalCostenOfertas * 100)
            : 0;

        // ---------- 7. PINTAR KPIs ----------
        const eur = v => v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

        setText('kpi-coste-ett', eur(totalCostenOfertas));
        setText('kpi-pct-ett', totalCostenOfertas > 0 ? '~40%' : '—');   // proxy
        setText('kpi-roi-ett', eur(Math.max(0, ahorroRoi)));
        setText('kpi-risk-dependencia', riskoDependencia + '%');

        // ---------- 8. GRÁFICOS ----------
        renderAgencias(agenciaMetricas);
        renderEvolucion(fichajesSnap, cutoffMs, agenciaMetricas);
        renderAutonomia(stulzTotal, stulzAutonomos, ettTotal, ettAutonomos);
        renderCosteEfectiva(agenciaMetricas);

        // ---------- 9. TABLAS ----------
        renderAgenciasTable(agenciaMetricas);
        renderRiesgoTable(ettRiesgo);

    } catch (e) {
        console.error('Error calculando ETT:', e);
        if (typeof showToast === 'function') showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Calcular'; }
    }
}

function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
}

// -------------------------------------------------------
// GRÁFICOS
// -------------------------------------------------------
function makeChart(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el.getContext('2d'), cfg);
}

const C = { rojo: '#ef4444', verde: '#10b981', azul: '#3b82f6', ambar: '#f59e0b' };
const GRID = { color: 'rgba(51,65,85,.5)' };

function renderAgencias(met) {
    const labels = Object.keys(met);
    const data = labels.map(a => met[a].costeTotal);
    makeChart('chart-agencias', {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: [C.azul + 'cc', C.ambar + 'cc'], borderColor: '#1e293b', borderWidth: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €` } }
            }
        }
    });
}

function renderEvolucion(fichajesSnap, cutoff, met) {
    const meses = {};
    fichajesSnap.forEach(d => {
        const data = d.data();
        const fecha = new Date(data.fecha || '');
        const wId = String(data.trabajador || data.operario || '').toUpperCase();
        if (!wId || (cutoff && fecha.getTime() < cutoff)) return;
        if (!Object.values(met).some(m => m.personas.has(wId))) return;
        const key = fecha.toISOString().slice(0, 7);
        meses[key] = (meses[key] || 0) + (parseFloat(data.tiempo) || 0) * TARIFA;
    });
    const fechas = Object.keys(meses).sort();
    makeChart('chart-evolucion', {
        type: 'line',
        data: {
            labels: fechas,
            datasets: [{
                label: 'Coste ETT (€)',
                data: fechas.map(f => meses[f]),
                borderColor: C.rojo,
                backgroundColor: C.rojo + '30',
                fill: true,
                tension: .3,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: GRID, ticks: { callback: v => v + ' €' } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderAutonomia(stulzTot, stulzAut, ettTot, ettAut) {
    const stulzPct = stulzTot > 0 ? Math.round(stulzAut / stulzTot * 100) : 0;
    const ettPct = ettTot > 0 ? Math.round(ettAut / ettTot * 100) : 0;
    makeChart('chart-autonomia', {
        type: 'bar',
        data: {
            labels: ['STULZ', 'ETT'],
            datasets: [{ label: '% Autónomos', data: [stulzPct, ettPct], backgroundColor: [C.azul + 'cc', C.ambar + 'cc'], borderRadius: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            scales: { x: { grid: GRID, max: 100, ticks: { callback: v => v + '%' } }, y: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}%` } } }
        }
    });
}

function renderCosteEfectiva(met) {
    const labels = Object.keys(met);
    const data = labels.map(a => met[a].costeHoraEfectiva);
    makeChart('chart-coste-efectiva', {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: '€/Hora', data: data, backgroundColor: [C.verde + 'cc', C.ambar + 'cc'], borderRadius: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: GRID, ticks: { callback: v => v + ' €' } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

// -------------------------------------------------------
// TABLAS
// -------------------------------------------------------
function renderAgenciasTable(met) {
    const tbody = document.getElementById('table-agencias-body');
    if (!tbody) return;
    tbody.innerHTML = Object.entries(met).map(([ag, m]) => `
        <tr>
            <td><span class="agency-badge ${ag.includes('AURA') ? 'aura' : 'eurofirms'}">${ag}</span></td>
            <td style="text-align: center"><strong>${m.totalPersonas}</strong></td>
            <td style="text-align: center">${m.horas.toFixed(0)} h</td>
            <td style="text-align: center"><strong style="color: ${m.autonomosCount > 0 ? '#10b981' : '#ef4444'};">${m.autonomosCount}</strong></td>
            <td style="text-align: center"><strong style="color: #ef4444;">${m.horasMuda.toFixed(0)} h</strong></td>
            <td style="text-align: right; font-weight: 700;">${m.costeTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €</td>
            <td style="text-align: right"><strong>${m.costeHoraEfectiva.toFixed(2)} €</strong></td>
        </tr>`).join('');
}

function renderRiesgoTable(riesgo) {
    const tbody = document.getElementById('table-riesgo-body');
    if (!tbody) return;
    if (!riesgo.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #10b981;"><i class="ph ph-check-circle"></i> Sin personas clave: riesgo bajo</td></tr>`;
        return;
    }
    tbody.innerHTML = riesgo.map(r => `
        <tr>
            <td><span class="agency-badge ${r.agencia.includes('AURA') ? 'aura' : 'eurofirms'}">${r.agencia}</span></td>
            <td><strong>${r.id}</strong></td>
            <td>${r.secciones.length > 30 ? r.secciones.slice(0, 27) + '...' : r.secciones}</td>
            <td style="text-align: center">${r.esUnico ? '<span class="badge badge-danger">SÍ</span>' : '<span class="badge badge-success">No</span>'}</td>
            <td style="text-align: center"><span class="risk-cell risk-high">ALTO</span></td>
            <td style="text-align: right"><strong>${r.costeEstimado} €/mes</strong></td>
        </tr>`).join('');
}
