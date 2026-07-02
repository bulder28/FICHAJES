// analytics/js/app.js — Command Center · Lean Analytics v2
// Métricas económicas (Muda, ahorro, coste/hora efectiva) y productivas
// (autonomía, polivalencia, bus factor, cobertura de conocimiento).
//
// Fuentes: skill_scores (niveles ILUO), skill_matrices (catálogo de tareas),
//          fichajes (horas reales), operarios (censo STULZ/ETT),
//          configuracion/global (tarifa horaria).

let charts = {};                 // instancias Chart.js por canvas
let TARIFA = 20;                 // €/h, editable y persistida en configuracion/global
const TRAINING_THRESHOLD = 2;    // Niveles 1-2 = en formación (Muda); 3-4 = autónomo

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#94a3b8';

    document.getElementById('btn-calculate')?.addEventListener('click', calculate);
    document.getElementById('filter-linea')?.addEventListener('change', calculate);
    document.getElementById('filter-month')?.addEventListener('change', calculate);
    document.getElementById('input-tarifa')?.addEventListener('change', onTarifaChange);

    await loadConfig();
    await calculate();
});

// -------------------------------------------------------
// CONFIG: tarifa horaria persistente
// -------------------------------------------------------
async function loadConfig() {
    try {
        const doc = await db.collection('configuracion').doc('global').get();
        if (doc.exists && doc.data().tarifaETT) {
            TARIFA = parseFloat(doc.data().tarifaETT) || 20;
        }
    } catch (e) { console.error('Error cargando configuración:', e); }
    const inp = document.getElementById('input-tarifa');
    if (inp) inp.value = TARIFA;
}

async function onTarifaChange() {
    const inp = document.getElementById('input-tarifa');
    const val = parseFloat(inp.value);
    if (!val || val <= 0) { inp.value = TARIFA; return; }
    TARIFA = val;
    try {
        await db.collection('configuracion').doc('global').set({ tarifaETT: TARIFA }, { merge: true });
        if (typeof showToast === 'function') showToast(`Tarifa actualizada: ${TARIFA} €/h`, 'success');
    } catch (e) { console.error('Error guardando tarifa:', e); }
    await calculate();
}

// -------------------------------------------------------
// MOTOR DE CÁLCULO
// -------------------------------------------------------
async function calculate() {
    const btn = document.getElementById('btn-calculate');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Calculando...'; }

    try {
        const lineaFilter = document.getElementById('filter-linea')?.value || '';
        const monthFilter = document.getElementById('filter-month')?.value || ''; // YYYY-MM

        // ---------- 1. CARGA EN PARALELO ----------
        let fichajesQuery = db.collection('fichajes');
        if (lineaFilter) fichajesQuery = fichajesQuery.where('linea', '==', lineaFilter);

        const [scoresSnap, matricesSnap, operariosSnap, fichajesSnap] = await Promise.all([
            db.collection('skill_scores').get(),
            db.collection('skill_matrices').get(),
            db.collection('operarios').get(),
            fichajesQuery.get()
        ]);

        // ---------- 2. CENSO: quién es ETT ----------
        const censo = {}; // idTrabajador -> { isETT, agencia }
        operariosSnap.forEach(d => {
            const x = d.data();
            const id = x.idTrabajador || d.id;
            censo[id] = { isETT: !!x.isETT, agencia: x.agencia || '' };
        });

        // ---------- 3. COMPETENCIA: agregados por operario y sección ----------
        // workerAgg[id][SECCION] = { sum, count }   (fusiona múltiples docs)
        // taskLevels[SECCION][tarea] = { autonomos, formacion }
        const workerAgg = {};
        const taskLevels = {};
        const iluoDist = { 1: 0, 2: 0, 3: 0, 4: 0 };

        scoresSnap.forEach(doc => {
            const d = doc.data();
            const wId = d.idTrabajador;
            const sec = (d.seccion || '').toUpperCase();
            if (!wId || !sec) return;

            Object.entries(d.scores || {}).forEach(([tarea, v]) => {
                const nivel = Number(v) || 0;
                if (nivel < 1) return;                       // 0 = sin evaluación

                ((workerAgg[wId] ||= {})[sec] ||= { sum: 0, count: 0 });
                workerAgg[wId][sec].sum += nivel;
                workerAgg[wId][sec].count++;

                ((taskLevels[sec] ||= {})[tarea] ||= { autonomos: 0, formacion: 0 });
                if (nivel >= 3) taskLevels[sec][tarea].autonomos++;
                else taskLevels[sec][tarea].formacion++;

                iluoDist[nivel] = (iluoDist[nivel] || 0) + 1;
            });
        });

        // Medias por operario y clasificación (por PERSONA, no por documento)
        const workerAvg = {};   // id -> { SECCION: media }
        let productivos = 0, aprendices = 0;
        let sumSeccionesDominadas = 0;
        let operariosConMultiSeccion = 0;

        Object.entries(workerAgg).forEach(([id, secs]) => {
            workerAvg[id] = {};
            let gSum = 0, gCount = 0, dominadas = 0;
            Object.entries(secs).forEach(([sec, a]) => {
                const avg = a.sum / a.count;
                workerAvg[id][sec] = avg;
                gSum += a.sum; gCount += a.count;
                if (avg > TRAINING_THRESHOLD) dominadas++;
            });
            if (gSum / gCount > TRAINING_THRESHOLD) productivos++; else aprendices++;
            sumSeccionesDominadas += dominadas;
            if (dominadas >= 2) operariosConMultiSeccion++;
        });
        const totalEvaluados = productivos + aprendices;

        // ---------- 4. FICHAJES: horas y costes ----------
        let horasTotales = 0, horasMuda = 0;
        let costeMudaSTULZ = 0, costeMudaETT = 0;
        const costByOF = {};
        const horasPorSeccion = {};   // SEC -> { muda, productivas }
        const horasPorFecha = {};     // YYYY-MM-DD -> { muda, productivas }
        const detalles = [];

        fichajesSnap.forEach(doc => {
            const d = doc.data();
            const wId = String(d.trabajador || d.operario || '').trim().toUpperCase();
            const fecha = String(d.fecha || '');
            const dept = (d.departamento || '').toUpperCase();
            const ofNum = d.of || 'SIN OF';
            const horas = parseFloat(d.tiempo) || 0;

            if (horas <= 0 || !wId) return;
            if (monthFilter && !fecha.startsWith(monthFilter)) return;

            // Nivel del operario en la sección trabajada.
            // Conservadurismo: sin evaluación en esa sección => Nivel 1 (Muda).
            let nivel = 1;
            if (workerAvg[wId] && workerAvg[wId][dept] !== undefined) nivel = workerAvg[wId][dept];
            const esMuda = nivel <= TRAINING_THRESHOLD;

            horasTotales += horas;
            (horasPorSeccion[dept || 'SIN SECCIÓN'] ||= { muda: 0, productivas: 0 });
            (horasPorFecha[fecha] ||= { muda: 0, productivas: 0 });

            if (esMuda) {
                horasMuda += horas;
                horasPorSeccion[dept || 'SIN SECCIÓN'].muda += horas;
                horasPorFecha[fecha].muda += horas;

                const coste = horas * TARIFA;
                costByOF[ofNum] = (costByOF[ofNum] || 0) + coste;
                if (censo[wId]?.isETT) costeMudaETT += coste; else costeMudaSTULZ += coste;

                detalles.push({
                    operario: wId + (censo[wId]?.isETT ? ' (ETT)' : ''),
                    of: ofNum, seccion: dept,
                    nivel: nivel.toFixed(1), horas: horas.toFixed(1),
                    coste: coste.toFixed(2)
                });
            } else {
                horasPorSeccion[dept || 'SIN SECCIÓN'].productivas += horas;
                horasPorFecha[fecha].productivas += horas;
            }
        });

        const costeMuda = horasMuda * TARIFA;
        const costeTotal = horasTotales * TARIFA;
        const horasProductivas = horasTotales - horasMuda;

        // ---------- 5. BUS FACTOR y COBERTURA ----------
        const tareasCriticas = [];
        const coberturaPorSeccion = {};   // SEC -> { cubiertas, total }
        // Recorremos el CATÁLOGO de las matrices (incluye tareas que nadie sabe hacer)
        matricesSnap.forEach(m => {
            const x = m.data();
            const sec = (x.seccion || '').toUpperCase();
            (x.tareas || []).forEach(tarea => {
                const info = (taskLevels[sec] && taskLevels[sec][tarea]) || { autonomos: 0, formacion: 0 };
                (coberturaPorSeccion[sec] ||= { cubiertas: 0, total: 0 });
                coberturaPorSeccion[sec].total++;
                if (info.autonomos >= 2) coberturaPorSeccion[sec].cubiertas++;
                if (info.autonomos <= 1) {
                    tareasCriticas.push({ seccion: sec, tarea, autonomos: info.autonomos, formacion: info.formacion });
                }
            });
        });
        tareasCriticas.sort((a, b) => a.autonomos - b.autonomos || b.formacion - a.formacion);

        // ---------- 6. PINTAR KPIs ----------
        const eur = v => v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

        setText('kpi-coste-muda', eur(costeMuda));
        setText('kpi-pct-muda', costeTotal > 0 ? Math.round(costeMuda / costeTotal * 100) + '%' : '—');
        setText('kpi-pct-muda-sub', `Sobre ${eur(costeTotal)} de MOD del periodo`);
        setText('kpi-coste-hora-efectiva', horasProductivas > 0 ? eur(costeTotal / horasProductivas) : '—');
        // Ahorro potencial: si el personal en formación pasara a autónomo, sus horas Muda serían productivas
        setText('kpi-ahorro', eur(costeMuda));
        setText('kpi-horas', `${horasMuda.toFixed(0)} / ${horasTotales.toFixed(0)} h`);
        setText('kpi-horas-sub', horasTotales > 0 ? `${Math.round(horasMuda / horasTotales * 100)}% de las horas son de personal en formación` : 'Sin fichajes en el periodo');
        setText('kpi-autonomia', totalEvaluados > 0 ? Math.round(productivos / totalEvaluados * 100) + '%' : '—');
        setText('kpi-autonomia-sub', `${productivos} de ${totalEvaluados} operarios evaluados`);
        setText('kpi-polivalencia', totalEvaluados > 0 ? (sumSeccionesDominadas / totalEvaluados).toFixed(2) : '—');
        setText('kpi-polivalencia-sub', `${operariosConMultiSeccion} operarios dominan ≥2 secciones`);
        setText('kpi-criticas', tareasCriticas.length);

        // ---------- 7. GRÁFICOS ----------
        renderEvolucion(horasPorFecha);
        renderETT(costeMudaSTULZ, costeMudaETT);
        renderTopOFs(Object.entries(costByOF).sort((a, b) => b[1] - a[1]).slice(0, 8));
        renderSecciones(horasPorSeccion);
        renderIluoDist(iluoDist);
        renderCobertura(coberturaPorSeccion);

        // ---------- 8. TABLAS ----------
        renderRiesgo(tareasCriticas.slice(0, 15));
        renderDetalles(detalles);

    } catch (e) {
        console.error('Error calculando analíticas:', e);
        if (typeof showToast === 'function') showToast('Error calculando: ' + e.message, 'error');
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
function makeChart(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(el.getContext('2d'), config);
}

const GRID = { color: 'rgba(51,65,85,.5)' };
const C = { rojo: '#ef4444', verde: '#10b981', azul: '#3b82f6', ambar: '#f59e0b', gris: '#64748b' };

function renderEvolucion(horasPorFecha) {
    const fechas = Object.keys(horasPorFecha).sort();
    makeChart('chart-evolucion', {
        type: 'line',
        data: {
            labels: fechas,
            datasets: [
                { label: 'Productivas', data: fechas.map(f => horasPorFecha[f].productivas), borderColor: C.verde, backgroundColor: C.verde + '30', fill: true, tension: .3, pointRadius: 2 },
                { label: 'Muda (formación)', data: fechas.map(f => horasPorFecha[f].muda), borderColor: C.rojo, backgroundColor: C.rojo + '30', fill: true, tension: .3, pointRadius: 2 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: GRID, stacked: false, ticks: { callback: v => v + ' h' } }, x: { grid: { display: false } } },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function renderETT(stulz, ett) {
    makeChart('chart-ett', {
        type: 'doughnut',
        data: {
            labels: ['STULZ', 'ETT'],
            datasets: [{ data: [stulz, ett], backgroundColor: [C.azul + 'cc', C.ambar + 'cc'], borderColor: '#1e293b', borderWidth: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €` } }
            }
        }
    });
}

function renderTopOFs(sorted) {
    makeChart('chart-top-ofs', {
        type: 'bar',
        data: {
            labels: sorted.map(d => d[0]),
            datasets: [{ label: 'Coste Muda (€)', data: sorted.map(d => d[1]), backgroundColor: C.rojo + 'cc', borderColor: C.rojo, borderWidth: 1, borderRadius: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: GRID, ticks: { callback: v => v + ' €' } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €` } } }
        }
    });
}

function renderSecciones(horasPorSeccion) {
    const secs = Object.keys(horasPorSeccion).sort((a, b) => (horasPorSeccion[b].muda + horasPorSeccion[b].productivas) - (horasPorSeccion[a].muda + horasPorSeccion[a].productivas));
    makeChart('chart-secciones', {
        type: 'bar',
        data: {
            labels: secs.map(s => s.length > 18 ? s.slice(0, 16) + '…' : s),
            datasets: [
                { label: 'Productivas', data: secs.map(s => horasPorSeccion[s].productivas), backgroundColor: C.verde + 'cc', borderRadius: 4 },
                { label: 'Muda', data: secs.map(s => horasPorSeccion[s].muda), backgroundColor: C.rojo + 'cc', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            scales: { x: { grid: GRID, stacked: true, ticks: { callback: v => v + ' h' } }, y: { grid: { display: false }, stacked: true } },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function renderIluoDist(dist) {
    makeChart('chart-iluo-dist', {
        type: 'bar',
        data: {
            labels: ['I — Instruido (1)', 'L — Con ayuda (2)', 'U — Autónomo (3)', 'O — Enseña (4)'],
            datasets: [{
                data: [dist[1], dist[2], dist[3], dist[4]],
                backgroundColor: [C.rojo + 'cc', C.ambar + 'cc', C.verde + 'cc', C.azul + 'cc'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: GRID }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderCobertura(cob) {
    const secs = Object.keys(cob).sort();
    const pct = secs.map(s => cob[s].total > 0 ? Math.round(cob[s].cubiertas / cob[s].total * 100) : 0);
    makeChart('chart-cobertura', {
        type: 'bar',
        data: {
            labels: secs.map(s => s.length > 18 ? s.slice(0, 16) + '…' : s),
            datasets: [{
                label: '% tareas cubiertas',
                data: pct,
                backgroundColor: pct.map(p => p >= 75 ? C.verde + 'cc' : p >= 50 ? C.ambar + 'cc' : C.rojo + 'cc'),
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            scales: { x: { grid: GRID, max: 100, ticks: { callback: v => v + '%' } }, y: { grid: { display: false } } },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}% (${cob[secs[ctx.dataIndex]].cubiertas}/${cob[secs[ctx.dataIndex]].total} tareas)` } }
            }
        }
    });
}

// -------------------------------------------------------
// TABLAS
// -------------------------------------------------------
function renderRiesgo(criticas) {
    const tbody = document.getElementById('table-riesgo-body');
    if (!tbody) return;
    if (!criticas.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#10b981;">
            <i class="ph ph-check-circle"></i> Sin tareas críticas: todas tienen ≥2 operarios autónomos</td></tr>`;
        return;
    }
    tbody.innerHTML = criticas.map(t => `
        <tr>
            <td>${t.seccion}</td>
            <td><strong>${t.tarea}</strong></td>
            <td style="text-align:center"><span class="risk-pill ${t.autonomos === 0 ? 'risk-0' : 'risk-1'}">${t.autonomos}</span></td>
            <td style="text-align:center">${t.formacion}</td>
            <td style="text-align:center">${t.autonomos === 0
                ? '<span class="badge badge-danger">NADIE AUTÓNOMO</span>'
                : '<span class="badge badge-warning">PERSONA ÚNICA</span>'}</td>
        </tr>`).join('');
}

function renderDetalles(details) {
    const tbody = document.getElementById('table-details-body');
    if (!tbody) return;
    details.sort((a, b) => parseFloat(b.coste) - parseFloat(a.coste));
    const top = details.slice(0, 20);
    if (!top.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Sin costes de formación en el periodo seleccionado</td></tr>`;
        return;
    }
    tbody.innerHTML = top.map(r => `
        <tr>
            <td><strong>${r.operario}</strong></td>
            <td>${r.of}</td>
            <td>${r.seccion}</td>
            <td><span class="badge ${parseFloat(r.nivel) > 1.5 ? 'badge-warning' : 'badge-danger'}">Lvl ${r.nivel}</span></td>
            <td>${r.horas} h</td>
            <td style="color:#ef4444;font-weight:700;">${parseFloat(r.coste).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</td>
        </tr>`).join('');
}
