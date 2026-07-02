/**
 * polivalencia/js/app.js
 * Matriz de Competencias ILUO — Carga dinámica desde Firestore
 * Permite ver y editar manualmente los niveles por operario
 */

let workersData = [];        // Lista de operarios de la colección 'operarios'
let matrixSchema = null;     // { linea, seccion, tareas: [] }
let currentScores = {};      // { idTrabajador: { tarea: nivel } }

// -------------------------------------------------------
// INIT
// -------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    document.getElementById('filter-linea')?.addEventListener('change', onFilterChange);
    document.getElementById('filter-seccion')?.addEventListener('change', onFilterChange);
    document.getElementById('filter-turno')?.addEventListener('change', () => { if(matrixSchema) renderMatrix(); else onFilterChange(); });
    document.getElementById('search-matrix')?.addEventListener('input', () => { if(matrixSchema) renderMatrix(); else onFilterChange(); });

    await loadWorkers();
    onFilterChange();
});

async function loadWorkers() {
    try {
        const snap = await db.collection('operarios').orderBy('idTrabajador').get();
        workersData = [];
        snap.forEach(doc => {
            const d = doc.data();
            workersData.push({
                docId: doc.id,
                id: d.idTrabajador || doc.id,
                seccionBase: (d.seccionBase || '').toUpperCase(),
                lineaBase: (d.lineaBase || '').toUpperCase(),
                turnoBase: d.turnoBase || 'SIN TURNO',
                isETT: d.isETT || false
            });
        });
    } catch (e) {
        console.error('Error cargando operarios:', e);
    }
}

async function onFilterChange() {
    const linea = document.getElementById('filter-linea')?.value || '';
    const seccion = document.getElementById('filter-seccion')?.value || '';
    const thead = document.getElementById('matrix-head');
    const tbody = document.getElementById('matrix-body');

    if (!linea || !seccion) {
        thead.innerHTML = '<th class="sticky-col">OPERARIO</th>';
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:3rem;color:#64748b;">
            <i class="ph ph-funnel" style="font-size:2rem;display:block;margin-bottom:0.5rem;"></i>
            Selecciona Línea y Sección para cargar la matriz</td></tr>`;
        matrixSchema = null;
        return;
    }

    await loadMatrixData(linea, seccion);
}

async function loadMatrixData(linea, seccion) {
    const thead = document.getElementById('matrix-head');
    const tbody = document.getElementById('matrix-body');

    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:2rem;">
        <i class="ph ph-spinner" style="font-size:1.5rem;"></i> Cargando matriz...</td></tr>`;

    // El ID del documento en skill_matrices
    const seccionKey = seccion.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toUpperCase();
    const matrixId = `${linea}_${seccionKey}`;

    try {
        if (typeof updateDbStatus === 'function') updateDbStatus(false);

        let matrixDoc = await db.collection('skill_matrices').doc(matrixId).get();

        // FALLBACK: Si no existe la matriz específica para esta línea, buscar cualquiera de esa sección
        if (!matrixDoc.exists) {
            const fallbackSnap = await db.collection('skill_matrices')
                .where('seccion', '==', seccion)
                .limit(1)
                .get();
            
            if (!fallbackSnap.empty) {
                matrixDoc = fallbackSnap.docs[0];
            }
        }

        if (!matrixDoc.exists) {
            thead.innerHTML = '<th class="sticky-col">OPERARIO</th>';
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:3rem;color:#ef4444;">
                <i class="ph ph-file-x" style="font-size:2rem;display:block;margin-bottom:0.5rem;"></i>
                No hay matriz importada para <strong>cualquier línea de la sección ${seccion}</strong><br>
                <small style="color:#94a3b8;margin-top:0.5rem;display:block;">Ve a <b>Configuración</b> e importa el Excel correspondiente dejándolo en Línea 1.</small>
            </td></tr>`;
            matrixSchema = null;
            if (typeof updateDbStatus === 'function') updateDbStatus(true);
            return;
        }

        matrixSchema = matrixDoc.data();

        // Cargar todos los scores de esta sección (ignorando en qué línea se subió el Excel)
        const scoresSnap = await db.collection('skill_scores')
            .where('seccion', '==', seccion)
            .get();

        currentScores = {};
        const preferPrefix = `${matrixSchema.linea}_`;
        scoresSnap.forEach(doc => {
            const d = doc.data();
            const prev = currentScores[d.idTrabajador];
            if (!prev) {
                currentScores[d.idTrabajador] = { docId: doc.id, scores: { ...(d.scores || {}) } };
            } else {
                // Duplicado (mismo operario, misma sección, distinta línea): fusionar niveles
                // y quedarse con el docId que corresponde a la línea de la matriz cargada.
                Object.assign(prev.scores, d.scores || {});
                if (doc.id.includes(preferPrefix)) prev.docId = doc.id;
            }
        });

        // Construir cabecera dinámica
        thead.innerHTML = '<th class="sticky-col">OPERARIO</th>';
        matrixSchema.tareas.forEach(tarea => {
            const th = document.createElement('th');
            th.textContent = tarea;
            th.title = tarea;
            th.style.maxWidth = '120px';
            th.style.overflow = 'hidden';
            th.style.textOverflow = 'ellipsis';
            th.style.whiteSpace = 'nowrap';
            thead.appendChild(th);
        });

        if (typeof updateDbStatus === 'function') updateDbStatus(true);
        renderMatrix();

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:2rem;color:red;">Error: ${err.message}</td></tr>`;
    }
}

// -------------------------------------------------------
// RENDER
// -------------------------------------------------------
function renderMatrix() {
    if (!matrixSchema) return;

    const tbody = document.getElementById('matrix-body');
    tbody.innerHTML = '';

    const linea = document.getElementById('filter-linea')?.value || '';
    const seccion = (document.getElementById('filter-seccion')?.value || '').toUpperCase();
    const turno = document.getElementById('filter-turno')?.value || '';
    const search = (document.getElementById('search-matrix')?.value || '').toUpperCase().trim();

    // Filtrar operarios: SIEMPRE se respeta la línea seleccionada.
    // Dentro de la línea: los asignados a esta sección + los que tengan
    // niveles registrados en ella (polivalentes con otra sección base).
    let filtered = workersData.filter(w => {
        const hasScore = currentScores[w.id] !== undefined;
        const matchLinea = !linea || w.lineaBase.includes(linea);
        const matchSeccion = !seccion || w.seccionBase.includes(seccion);
        return matchLinea && (matchSeccion || hasScore);
    });

    if (turno) filtered = filtered.filter(w => w.turnoBase === turno);
    if (search) filtered = filtered.filter(w => w.id.includes(search));

    if (filtered.length === 0) {
        const razon = turno ? `no hay operarios del turno <strong>${turno}</strong>` : 'no hay operarios para estos filtros';
        tbody.innerHTML = `<tr><td colspan="${matrixSchema.tareas.length + 1}" style="text-align:center;padding:2rem;color:#64748b;">
            ℹ️ ${razon}</td></tr>`;
        return;
    }

    filtered.forEach(worker => {
        const tr = document.createElement('tr');

        // Celda fija: ID operario
        const nameCell = document.createElement('td');
        nameCell.className = 'sticky-col';
        const badge = worker.isETT
            ? `<span style="font-size:0.65rem;background:#f59e0b20;color:#f59e0b;border-radius:4px;padding:1px 4px;margin-left:4px;">ETT</span>`
            : '';
        nameCell.innerHTML = `<strong style="cursor:pointer; color:var(--stulz-red); text-decoration:underline;" title="Ver Ficha Premium FIFA" onclick="openFUTCard('${worker.id}')">${worker.id}</strong>${badge}`;
        tr.appendChild(nameCell);

        const workerData = currentScores[worker.id] || { docId: null, scores: {} };

        matrixSchema.tareas.forEach(tarea => {
            const td = document.createElement('td');
            td.style.padding = '4px 6px';
            const nivel = workerData.scores[tarea] || 0;
            td.innerHTML = buildCellHTML(nivel);

            // Clic para editar el nivel
            td.style.cursor = 'pointer';
            td.title = `${worker.id} · ${tarea} · Click para editar`;
            td.addEventListener('click', () => openIluoEditor(worker, tarea, nivel, workerData.docId));
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}

// -------------------------------------------------------
// CELDA ILUO
// -------------------------------------------------------
const ILUO_COLORS = {
    0: { bg: '#1e293b', text: '#475569', label: '—' },
    1: { bg: '#ef444420', text: '#ef4444', label: 'I' },
    2: { bg: '#f59e0b20', text: '#f59e0b', label: 'L' },
    3: { bg: '#22c55e20', text: '#22c55e', label: 'U' },
    4: { bg: '#3b82f620', text: '#3b82f6', label: 'O' }
};

function buildCellHTML(nivel) {
    const c = ILUO_COLORS[nivel] || ILUO_COLORS[0];
    const pct = nivel * 25;
    return `
        <div style="display:flex;align-items:center;gap:6px;min-width:60px;">
            <div style="
                width:32px;height:32px;border-radius:8px;
                background:${c.bg};color:${c.text};
                display:flex;align-items:center;justify-content:center;
                font-weight:800;font-size:1rem;border:1px solid ${c.text}40;
                flex-shrink:0;
            ">${c.label}</div>
            <div style="flex:1;">
                <div style="height:4px;background:#334155;border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${c.text};border-radius:2px;transition:width 0.3s;"></div>
                </div>
                <div style="font-size:0.7rem;color:#64748b;margin-top:1px;">${pct > 0 ? pct + '%' : 'Sin eval'}</div>
            </div>
        </div>`;
}

// -------------------------------------------------------
// EDITOR DE NIVEL ILUO (Modal inline)
// -------------------------------------------------------
function openIluoEditor(worker, tarea, nivelActual, scoreDocId) {
    // Eliminar editor anterior si existe
    document.getElementById('iluo-inline-editor')?.remove();

    // Usar la línea REAL de la matriz cargada (puede venir por fallback de otra línea);
    // así las ediciones siempre caen en el mismo documento que la importación.
    const linea = (matrixSchema && matrixSchema.linea) || document.getElementById('filter-linea')?.value || '';
    const seccion = (matrixSchema && matrixSchema.seccion) || document.getElementById('filter-seccion')?.value || '';
    const seccionKey = seccion.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toUpperCase();
    const matrixId = `${linea}_${seccionKey}`;

    const overlay = document.createElement('div');
    overlay.id = 'iluo-inline-editor';
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;
        display:flex;align-items:center;justify-content:center;
        backdrop-filter:blur(4px);
    `;

    overlay.innerHTML = `
        <div style="
            background:#1e293b;border:1px solid #334155;border-radius:16px;
            padding:2rem;min-width:360px;box-shadow:0 25px 50px rgba(0,0,0,0.5);
        ">
            <h3 style="color:#f8fafc;margin:0 0 0.25rem 0;font-size:1.1rem;">Editar Nivel ILUO</h3>
            <p style="color:#94a3b8;margin:0 0 1.5rem 0;font-size:0.85rem;">
                <strong style="color:#f8fafc;">${worker.id}</strong> · ${tarea}
            </p>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0.75rem;margin-bottom:1.5rem;">
                ${[0, 1, 2, 3, 4].map(n => {
        const c = ILUO_COLORS[n];
        const labels = ['Sin evaluación', 'I - Instruido', 'L - Lo hace con ayuda', 'U - Autónomo', 'O - Enseña a otros'];
        return `<button 
                        data-nivel="${n}"
                        onclick="selectIluoLevel(this, ${n})"
                        style="
                            padding:0.75rem 0;border-radius:10px;border:2px solid ${n === nivelActual ? c.text : '#334155'};
                            background:${n === nivelActual ? c.bg : 'transparent'};color:${c.text};
                            font-weight:800;font-size:1.1rem;cursor:pointer;transition:all 0.15s;
                        "
                        title="${labels[n]}"
                    >${n === 0 ? '—' : n}</button>`;
    }).join('')}
            </div>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                <button onclick="document.getElementById('iluo-inline-editor').remove()" 
                    style="padding:0.6rem 1.25rem;border:1px solid #475569;background:transparent;color:#94a3b8;border-radius:8px;cursor:pointer;">
                    Cancelar
                </button>
                <button id="btn-save-iluo" onclick="saveIluoLevel('${worker.id}', '${tarea}', '${matrixId}', '${scoreDocId || ''}', '${linea}', '${seccion}')"
                    style="padding:0.6rem 1.25rem;border:none;background:#ef4444;color:white;border-radius:8px;cursor:pointer;font-weight:600;">
                    Guardar
                </button>
            </div>
        </div>
    `;

    // Marcar nivel actual
    overlay._selectedNivel = nivelActual;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function selectIluoLevel(btn, nivel) {
    const overlay = document.getElementById('iluo-inline-editor');
    if (!overlay) return;
    overlay._selectedNivel = nivel;

    // Resetear estilos de todos los botones
    overlay.querySelectorAll('[data-nivel]').forEach(b => {
        const n = parseInt(b.dataset.nivel);
        const c = ILUO_COLORS[n];
        b.style.border = `2px solid #334155`;
        b.style.background = 'transparent';
    });

    // Destacar el seleccionado
    const c = ILUO_COLORS[nivel];
    btn.style.border = `2px solid ${c.text}`;
    btn.style.background = c.bg;
}

async function saveIluoLevel(workerId, tarea, matrixId, scoreDocId, linea, seccion) {
    const overlay = document.getElementById('iluo-inline-editor');
    if (!overlay) return;

    const nivel = overlay._selectedNivel;
    const btn = document.getElementById('btn-save-iluo');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        // El docId del score: workerId_matrixId
        const docId = scoreDocId || `${workerId}_${matrixId}`;
        const ref = db.collection('skill_scores').doc(docId);

        // IMPORTANTE: la notación con punto ('scores.tarea') solo funciona en update();
        // en set(..., {merge:true}) crearía un campo basura en la raíz del documento.
        // El merge anidado sí fusiona el mapa scores preservando el resto de tareas.
        await ref.set({
            scores: { [tarea]: nivel },
            updatedAt: new Date().toISOString(),
            linea: linea,
            seccion: seccion,
            idTrabajador: workerId
        }, { merge: true });

        // Actualizar el estado local
        if (!currentScores[workerId]) {
            currentScores[workerId] = { docId, scores: {} };
        }
        currentScores[workerId].scores[tarea] = nivel;
        currentScores[workerId].docId = docId;

        overlay.remove();
        renderMatrix();

        if (typeof showToast === 'function') {
            showToast(`Nivel actualizado: ${workerId} · ${tarea} → ${nivel === 0 ? 'Sin evaluación' : `Nivel ${nivel}`}`, 'success');
        }

    } catch (err) {
        console.error(err);
        if (typeof showToast === 'function') showToast('Error guardando: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
}

/* =========================================================
   FIFA CARD LOGIC
   ========================================================= */
let fifaRadarChartInstance = null;

window.closeFifaModal = function() {
    document.getElementById('fifa-modal').classList.remove('show');
};

window.openFUTCard = async function(workerId) {
    try {
        if (typeof showToast === 'function') showToast('Cargando ficha FIFA...', 'info');
        
        // 1. Obtener todos los scores del trabajador de Firebase y su foto
        const snapshot = await db.collection('skill_scores').where('idTrabajador', '==', workerId).get();
        const photoDoc = await db.collection('operario_photos').doc(workerId).get();
        
        // Cargar Foto si existe
        const cardImageContainer = document.querySelector('.card-image');
        if (photoDoc.exists && photoDoc.data().photoBase64) {
            cardImageContainer.innerHTML = `<img src="${photoDoc.data().photoBase64}" alt="Foto ${workerId}">`;
        } else {
            cardImageContainer.innerHTML = '<i class="ph-fill ph-user"></i>';
        }
        
        // Objeto para acumular sumas y conteos por seccion
        const sectionStats = {
            'MONTAJE ELÉCTRICO': { sum: 0, count: 0 },
            'MONTAJE MECÁNICO': { sum: 0, count: 0 },
            'BATERÍAS': { sum: 0, count: 0 },
            'LOGÍSTICA': { sum: 0, count: 0 },
            'TRANSFORMACIÓN METÁLICA': { sum: 0, count: 0 },
            'PERFILERÍA Y SOLDADURA': { sum: 0, count: 0 }
        };

        let totalSum = 0;
        let totalCount = 0;
        let isFormadorGlobal = false;
        let radarLabels = [];
        let radarData = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const seccion = (data.seccion || '').toUpperCase();
            if (!sectionStats[seccion]) {
                sectionStats[seccion] = { sum: 0, count: 0 };
            }
            if (data.scores) {
                Object.entries(data.scores).forEach(([tarea, val]) => {
                    if (val > 0) {
                        sectionStats[seccion].sum += val;
                        sectionStats[seccion].count++;
                        totalSum += val;
                        totalCount++;
                    }
                    
                    if (val === 4) isFormadorGlobal = true;

                    // Para que el texto largo se vea bien en Chart.js, lo dividimos en un array si es mayor a 15 caracteres
                    let label = tarea;
                    if (tarea.length > 15) {
                        const words = tarea.split(' ');
                        let currentLine = '';
                        const lines = [];
                        words.forEach(w => {
                            if ((currentLine + w).length > 15) {
                                lines.push(currentLine.trim());
                                currentLine = w + ' ';
                            } else {
                                currentLine += w + ' ';
                            }
                        });
                        lines.push(currentLine.trim());
                        label = lines;
                    }
                    
                    radarLabels.push(label);
                    radarData.push(val || 0);
                });
            }
        });

        if (radarLabels.length === 0) {
            radarLabels = ['Sin Datos'];
            radarData = [0];
        }

        // 2. Calcular los OVRs (Max ILUO = 4 -> 99)
        // Sin evaluaciones en la sección -> null (se muestra '—'), para no
        // confundir "no evaluado" con un nivel bajo real.
        const calculateStat = (sum, count) => {
            if (count === 0) return null;
            const avg = sum / count;
            const stat = Math.round((avg / 4) * 99);
            return Math.min(99, Math.max(30, stat));
        };

        const globalOVR = calculateStat(totalSum, totalCount);
        const mel = calculateStat(sectionStats['MONTAJE ELÉCTRICO']?.sum || 0, sectionStats['MONTAJE ELÉCTRICO']?.count || 0);
        const mmc = calculateStat(sectionStats['MONTAJE MECÁNICO']?.sum || 0, sectionStats['MONTAJE MECÁNICO']?.count || 0);
        const bat = calculateStat(sectionStats['BATERÍAS']?.sum || 0, sectionStats['BATERÍAS']?.count || 0);
        const log = calculateStat(sectionStats['LOGÍSTICA']?.sum || 0, sectionStats['LOGÍSTICA']?.count || 0);
        const met = calculateStat(sectionStats['TRANSFORMACIÓN METÁLICA']?.sum || 0, sectionStats['TRANSFORMACIÓN METÁLICA']?.count || 0);
        const pys = calculateStat(sectionStats['PERFILERÍA Y SOLDADURA']?.sum || 0, sectionStats['PERFILERÍA Y SOLDADURA']?.count || 0);

        // 3. Actualizar DOM y Tiers
        document.getElementById('fifa-name').textContent = workerId;
        
        // Animación del número OVR (si no hay ningún dato ILUO, mostrar '—' sin animar)
        const ovrElement = document.getElementById('fifa-ovr');
        if (globalOVR === null) {
            ovrElement.textContent = '—';
        } else {
        ovrElement.textContent = '0';
        let currentCount = 0;
        const duration = 1000;
        const intervalTime = 30;
        const steps = duration / intervalTime;
        const increment = globalOVR / steps;

        const countInterval = setInterval(() => {
            currentCount += increment;
            if (currentCount >= globalOVR) {
                ovrElement.textContent = globalOVR;
                clearInterval(countInterval);
            } else {
                ovrElement.textContent = Math.round(currentCount);
            }
        }, intervalTime);
        }

        // Aplicar estilos de la carta según OVR
        const cardElement = document.querySelector('.fifa-card');
        cardElement.className = 'fifa-card'; // reset
        if (globalOVR === null || globalOVR < 50) cardElement.classList.add('bronze-card');
        else if (globalOVR <= 75) cardElement.classList.add('silver-card');
        else if (globalOVR <= 90) cardElement.classList.add('gold-card');
        else cardElement.classList.add('icon-card');

        // Mostrar u ocultar la Corona de Formador
        const clubIconContainer = document.querySelector('.card-club');
        if (isFormadorGlobal) {
            clubIconContainer.innerHTML = '<i class="ph-fill ph-crown" style="color:#fbbf24; font-size:2rem; filter: drop-shadow(0 0 5px #fbbf24);"></i>';
        } else {
            clubIconContainer.innerHTML = '<i class="ph-fill ph-factory"></i>';
        }
        
        // Stats por sección: '—' atenuado si no hay evaluaciones
        const setStat = (id, val) => {
            const el = document.getElementById(id);
            el.textContent = val === null ? '—' : val;
            el.style.opacity = val === null ? '0.35' : '1';
        };
        setStat('stat-mel', mel);
        setStat('stat-mmc', mmc);
        setStat('stat-bat', bat);
        setStat('stat-log', log);
        setStat('stat-met', met);
        setStat('stat-pys', pys);

        // 4. Lógica de Pestañas (Chunking) para el Radar Chart
        const CHUNK_SIZE = 6;
        const radarChunks = [];
        for (let i = 0; i < radarLabels.length; i += CHUNK_SIZE) {
            radarChunks.push({
                labels: radarLabels.slice(i, i + CHUNK_SIZE),
                data: radarData.slice(i, i + CHUNK_SIZE)
            });
        }

        // Renderizar las pestañas
        const tabsContainer = document.getElementById('fifa-radar-tabs');
        tabsContainer.innerHTML = '';
        
        if (fifaRadarChartInstance) {
            fifaRadarChartInstance.destroy();
        }

        const ctx = document.getElementById('fifaRadarChart').getContext('2d');
        
        // Función para renderizar un bloque específico
        const renderRadarBlock = (blockIndex) => {
            // Actualizar clases de las pestañas
            Array.from(tabsContainer.children).forEach((btn, idx) => {
                if (idx === blockIndex) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            const chunk = radarChunks[blockIndex] || radarChunks[0];
            
            if (fifaRadarChartInstance) {
                fifaRadarChartInstance.data.labels = chunk.labels;
                fifaRadarChartInstance.data.datasets[0].data = chunk.data;
                fifaRadarChartInstance.update();
            } else {
                fifaRadarChartInstance = new Chart(ctx, {
                    type: 'radar',
                    data: {
                        labels: chunk.labels,
                        datasets: [{
                            label: 'Nivel ILUO',
                            data: chunk.data,
                            backgroundColor: 'rgba(212, 175, 55, 0.4)',
                            borderColor: 'rgba(212, 175, 55, 1)',
                            pointBackgroundColor: 'rgba(255, 255, 255, 1)',
                            pointBorderColor: 'rgba(212, 175, 55, 1)',
                            pointHoverBackgroundColor: '#fff',
                            pointHoverBorderColor: 'rgba(212, 175, 55, 1)',
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            r: {
                                min: 0,
                                max: 4,
                                ticks: { display: false, stepSize: 1 },
                                grid: { color: 'rgba(255, 255, 255, 0.1)', circular: true },
                                angleLines: { color: 'rgba(255, 255, 255, 0.2)' },
                                pointLabels: {
                                    color: 'rgba(255, 255, 255, 0.8)',
                                    font: { size: 10, family: 'Outfit', weight: 'bold' }
                                }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(0,0,0,0.8)',
                                titleFont: { family: 'Outfit', size: 14 },
                                bodyFont: { family: 'Inter', size: 14 },
                                padding: 10,
                                displayColors: false,
                                callbacks: {
                                    label: function(context) {
                                        const val = context.raw;
                                        const labels = {0: 'Sin Eval', 1: 'I (Instruido)', 2: 'L (Con ayuda)', 3: 'U (Autónomo)', 4: 'O (Formador)'};
                                        return `Nivel: ${labels[val] || val}`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        };

        // Crear botones de pestañas
        if (radarChunks.length > 1) {
            radarChunks.forEach((_, idx) => {
                const btn = document.createElement('button');
                btn.className = 'radar-tab' + (idx === 0 ? ' active' : '');
                btn.textContent = `Bloque ${idx + 1}`;
                btn.onclick = () => renderRadarBlock(idx);
                tabsContainer.appendChild(btn);
            });
        }

        // Renderizar el primer bloque
        if (radarChunks.length > 0) {
            renderRadarBlock(0);
        }

        // Efecto 3D Holográfico en la carta
        const cardContainer = document.querySelector('.fifa-card-container');
        const card = document.querySelector('.fifa-card');
        
        // Limpiamos listeners previos clonando el nodo si es necesario, o simplemente sobrescribiendo eventos:
        cardContainer.onmousemove = (e) => {
            const rect = cardContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = ((y - centerY) / centerY) * -15; // Inclinación max 15 grados
            const rotateY = ((x - centerX) / centerX) * 15;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        };
        
        cardContainer.onmouseleave = () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg)`;
        };

        // 5. Mostrar Modal
        document.getElementById('fifa-modal').classList.add('show');
        
    } catch (error) {
        console.error("Error abriendo FUT Card:", error);
        if (typeof showToast === 'function') showToast('Error abriendo Ficha: ' + error.message, 'error');
    }
};
