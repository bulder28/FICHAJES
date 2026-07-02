// planificador/js/app.js — Planificador de Formación Inteligente v2
// Roadmap automático con priorización, matriz bus factor × muda, simulador ROI

let charts = {};
let TARIFA = 20;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#94a3b8';

    document.getElementById('btn-generar')?.addEventListener('click', generar);
    document.getElementById('filter-prioridad')?.addEventListener('change', filtrar);
    document.getElementById('filter-agencia')?.addEventListener('change', filtrar);

    await loadConfig();
    await generar();
});

async function loadConfig() {
    try {
        const doc = await db.collection('configuracion').doc('global').get();
        if (doc.exists && doc.data().tarifaETT) {
            TARIFA = parseFloat(doc.data().tarifaETT) || 20;
        }
    } catch (e) { console.error('Error cargando config:', e); }
}

let DATOS = {}; // Cache de datos para filtrado rápido

async function generar() {
    const btn = document.getElementById('btn-generar');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Generando...'; }

    try {
        // ---------- 1. CARGA PARALELA ----------
        const [opSnap, scoresSnap, fichajesSnap, matSnap] = await Promise.all([
            db.collection('operarios').get(),
            db.collection('skill_scores').get(),
            db.collection('fichajes').get(),
            db.collection('skill_matrices').get()
        ]);

        // ---------- 2. CENSO Y COMPETENCIA ----------
        const censo = {};
        const workerAvg = {};
        const tareasPorSeccion = {};   // SECCION -> Set de tareas

        opSnap.forEach(d => {
            const x = d.data();
            const id = x.idTrabajador || d.id;
            censo[id] = {
                nombre: x.nombre || x.name || id,
                isETT: !!x.isETT,
                agencia: x.agencia || 'STULZ',
                seccionesDominadas: 0
            };
        });

        // Agregar competencia
        scoresSnap.forEach(d => {
            const data = d.data();
            const wId = data.idTrabajador;
            const sec = (data.seccion || '').toUpperCase();
            if (!wId || !sec) return;

            Object.values(data.scores || {}).forEach(v => {
                const nivel = Number(v) || 0;
                if (nivel < 1) return;
                if (!workerAvg[wId]) workerAvg[wId] = {};
                if (!workerAvg[wId][sec]) {
                    workerAvg[wId][sec] = nivel;
                } else {
                    workerAvg[wId][sec] = (workerAvg[wId][sec] + nivel) / 2;
                }
                if (workerAvg[wId][sec] >= 3) {
                    censo[wId].seccionesDominadas++;
                }
            });
        });

        // Catálogo de tareas
        matSnap.forEach(d => {
            const data = d.data();
            const sec = (data.seccion || '').toUpperCase();
            (tareasPorSeccion[sec] ||= new Set()).push(...(data.tareas || []));
        });

        // ---------- 3. BUS FACTOR Y MUDA ----------
        const busFactor = {};    // id -> count de tareas donde es el único
        const mudaAnual = {};    // id -> coste

        // Detectar bus factor
        Object.entries(tareasPorSeccion).forEach(([sec, tareas]) => {
            tareas.forEach(tarea => {
                const autonomos = Object.entries(census)
                    .filter(([id, c]) => (workerAvg[id]?.[sec] || 0) >= 3)
                    .map(([id]) => id);
                if (autonomos.length === 1) {
                    busFactor[autonomos[0]] = (busFactor[autonomos[0]] || 0) + 1;
                }
            });
        });

        // Muda: sumar horas de persona no autónoma en cada sección × tarifa
        fichajesSnap.forEach(d => {
            const data = d.data();
            const wId = String(data.trabajador || data.operario || '').toUpperCase();
            const dept = (data.departamento || '').toUpperCase();
            const horas = parseFloat(data.tiempo) || 0;
            if (!wId || horas <= 0) return;

            const nivel = workerAvg[wId]?.[dept] || 1;
            if (nivel <= 2) {
                mudaAnual[wId] = (mudaAnual[wId] || 0) + (horas * TARIFA);
            }
        });

        // ---------- 4. RANKING Y PRIORIZACIÓN ----------
        const candidatos = [];
        Object.keys(censo).forEach(id => {
            const c = censo[id];
            const bf = busFactor[id] || 0;
            const muda = mudaAnual[id] || 0;
            const polivalencia = c.seccionesDominadas;

            // Score combinado: (bus factor × peso alto) + (muda × peso) - (polivalencia × peso bajo)
            const score = (bf * 100) + (muda / 100) - (polivalencia * 10);

            let prioridad = 3;   // default media
            if (bf >= 2) prioridad = 1;    // crítica
            else if (muda > TARIFA * 160) prioridad = 2;   // alta (40 horas/mes)

            candidatos.push({
                id, nombre: c.nombre, agencia: c.agencia, isETT: c.isETT,
                busFactor: bf, muda: muda,
                seccionesDominadas: polivalencia,
                prioridad: prioridad,
                score: score,
                roiPotencial: muda * 0.6   // si sube 1 nivel, reduce 60% muda
            });
        });

        candidatos.sort((a, b) => b.score - a.score);
        DATOS = { candidatos, censo, workerAvg, tareasPorSeccion, busFactor, mudaAnual };

        // ---------- 5. KPIs ----------
        const criticas = candidatos.filter(c => c.prioridad === 1).length;
        const mudaTotal = Object.values(mudaAnual).reduce((s, v) => s + v, 0);
        const roiTotal = Object.values(mudaAnual).reduce((s, v) => s + v * 0.6, 0);

        setText('kpi-criticas', criticas);
        setText('kpi-muda-acum', mudaTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' €');
        setText('kpi-roi-potencial', roiTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' €');
        setText('kpi-iniciativas', candidatos.length);

        // ---------- 6. GRÁFICOS ----------
        renderMatriz(candidatos);
        renderSimulacion(candidatos, mudaTotal);
        renderCobertura(tareasPorSeccion, workerAvg);
        renderDistribucion(candidatos);

        // ---------- 7. ROADMAP Y TABLA ----------
        filtrar();

    } catch (e) {
        console.error('Error generando roadmap:', e);
        if (typeof showToast === 'function') showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-lightning"></i> Generar Roadmap'; }
    }
}

function filtrar() {
    const prioridad = document.getElementById('filter-prioridad')?.value || '';
    const agencia = document.getElementById('filter-agencia')?.value || '';

    let filtered = DATOS.candidatos || [];
    if (prioridad) filtered = filtered.filter(c => c.prioridad === parseInt(prioridad));
    if (agencia === 'STULZ') filtered = filtered.filter(c => !c.isETT);
    else if (agencia) filtered = filtered.filter(c => c.agencia === agencia);

    renderRoadmap(filtered);
    renderTabla(filtered);
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

const C = { rojo: '#ef4444', ambar: '#f59e0b', azul: '#3b82f6', verde: '#10b981' };
const GRID = { color: 'rgba(51,65,85,.5)' };

function renderMatriz(cand) {
    const dataset = cand.map(c => ({ x: c.busFactor, y: c.muda / 1000, label: c.id }));
    makeChart('chart-matriz', {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Candidatos',
                data: dataset,
                backgroundColor: dataset.map(d => {
                    let idx = cand.findIndex(c => c.id === d.label);
                    return [C.rojo, C.ambar, C.azul][cand[idx].prioridad - 1] + 'cc';
                }),
                pointRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: GRID, title: { display: true, text: 'Bus Factor (tareas únicas)' }, min: 0 },
                y: { grid: GRID, title: { display: true, text: 'Muda Anual (k€)' }, min: 0 }
            },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw.label}: ${ctx.raw.x} tareas, ${ctx.raw.y.toFixed(1)}k€` } } }
        }
    });
}

function renderSimulacion(cand, mudaTotal) {
    const pcts = [0, 25, 50, 75, 100];
    const ahorros = pcts.map(p => mudaTotal * (p / 100) * 0.6);   // si se forma el 25%, 50%, etc.
    makeChart('chart-simulacion', {
        type: 'line',
        data: {
            labels: pcts.map(p => `${p}% formados`),
            datasets: [{
                label: 'ROI Esperado (€)',
                data: ahorros,
                borderColor: C.verde,
                backgroundColor: C.verde + '30',
                fill: true,
                tension: .3,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: GRID, ticks: { callback: v => v + ' €' } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderCobertura(tareasPorSec, workerAvg) {
    const secs = Object.keys(tareasPorSec);
    const antes = secs.map(sec => {
        let cubiertas = 0, total = tareasPorSec[sec].length;
        tareasPorSec[sec].forEach(tarea => {
            const auts = Object.entries(workerAvg).filter(([_, avg]) => avg[sec] >= 3).length;
            if (auts >= 2) cubiertas++;
        });
        return Math.round(cubiertas / total * 100);
    });
    const despues = antes.map(p => Math.min(100, p + 20));   // proxy: mejora 20%
    makeChart('chart-cobertura', {
        type: 'bar',
        data: {
            labels: secs.map(s => s.length > 15 ? s.slice(0, 12) + '...' : s),
            datasets: [
                { label: 'Ahora', data: antes, backgroundColor: C.azul + '88', borderRadius: 4 },
                { label: 'Post-formación', data: despues, backgroundColor: C.verde + '88', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            scales: { x: { grid: GRID, max: 100, ticks: { callback: v => v + '%' } }, y: { grid: { display: false } } },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function renderDistribucion(cand) {
    const cnt = { 1: 0, 2: 0, 3: 0 };
    cand.forEach(c => cnt[c.prioridad]++);
    makeChart('chart-distribucion', {
        type: 'doughnut',
        data: {
            labels: ['🔴 Crítica (bus factor)', '🟠 Alta (Muda)', '🔵 Media (polivalencia)'],
            datasets: [{ data: [cnt[1], cnt[2], cnt[3]], backgroundColor: [C.rojo + 'cc', C.ambar + 'cc', C.azul + 'cc'], borderColor: '#1e293b', borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom' } } }
    });
}

// -------------------------------------------------------
// ROADMAP E TABLA
// -------------------------------------------------------
function renderRoadmap(cand) {
    const container = document.getElementById('roadmap-container');
    if (!container) return;
    container.innerHTML = cand.slice(0, 10).map((c, i) => `
        <div class="roadmap-card priority-${c.prioridad}">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div>
                    <div class="roadmap-persona">#${i + 1} ${c.nombre} (${c.id})</div>
                    <div class="roadmap-tarea">${c.agencia}${c.isETT ? ' · ETT' : ''}</div>
                    <div class="roadmap-score">
                        <div class="score-item">🚨 Bus: ${c.busFactor}</div>
                        <div class="score-item">💰 Muda: ${(c.muda / 1000).toFixed(1)}k€</div>
                        <div class="score-item">📚 Poliv: ${c.seccionesDominadas}</div>
                    </div>
                </div>
                <div class="roadmap-roi">ROI: ${(c.roiPotencial / 1000).toFixed(1)}k€</div>
            </div>
        </div>`).join('') || '<p style="color: #64748b;">Sin candidatos con los filtros actuales.</p>';
}

function renderTabla(cand) {
    const tbody = document.getElementById('table-candidatos-body');
    if (!tbody) return;
    tbody.innerHTML = cand.slice(0, 20).map(c => `
        <tr>
            <td><strong>${c.id}</strong><br><span style="color: #64748b; font-size: .8rem;">${c.nombre}</span></td>
            <td>${c.agencia}${c.isETT ? ' (ETT)' : ''}</td>
            <td style="text-align: center"><span class="badge ${c.prioridad === 1 ? 'badge-danger' : c.prioridad === 2 ? 'badge-warning' : 'badge-info'}">P${c.prioridad}</span></td>
            <td><span style="color: #94a3b8; font-size: .8rem;">${c.seccionesDominadas} dominadas (agregar más)</span></td>
            <td style="text-align: center"><strong style="color: ${c.busFactor > 0 ? '#ef4444' : '#10b981'};">${c.busFactor}</strong></td>
            <td style="text-align: right"><strong>${(c.muda).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €</strong></td>
            <td style="text-align: center"><span style="background: #10b98120; color: #10b981; padding: .2rem .6rem; border-radius: 4px; font-size: .75rem; font-weight: 700;">${(c.roiPotencial / 1000).toFixed(1)}k€</span></td>
        </tr>`).join('');
}
