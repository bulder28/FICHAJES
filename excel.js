/**
 * excel.js - Parser de Matrices ILUO para STULZ  (v2 - reimportación con IDs 5 dígitos)
 *
 * CAMBIOS v2:
 *  - Matching por TOKENS (orden-agnóstico): "ABAD GARCÍA, FRANCISCO JAVIER" casa con
 *    "Francisco Javier Abad García". Ignora acentos, comas, guiones y puntos.
 *  - Soporta iniciales ("J. Antonio Hervas") y erratas por prefijo (ESPINA ≈ ESPINOSA).
 *  - ELIMINADO el auto-create de operarios (generaba IDs rotos con el esquema 00XXX/04XXX/06XXX
 *    y duplicaba plantilla). Los nombres sin match se devuelven en `unmatched` para revisión.
 *  - Alias manuales: colección `name_aliases` (docId = nombre normalizado, campo operarioId).
 *    Se consultan antes del matching y se pueden crear desde la UI de revisión.
 *  - LIMPIEZA AUTOMÁTICA: antes de escribir, borra TODOS los skill_scores de esa matriz
 *    (linea + seccion), eliminando así los docs antiguos con IDs de 3 letras.
 *
 * PATRÓN REAL DEL EXCEL (sin cambios):
 *  - Fila con "Habilidades" en col B → cabecera
 *  - Fila siguiente: nombres de operarios en cols E, I, M... (paso 4, celdas fusionadas)
 *  - headerRow+3 en adelante: bloques de 4 filas por tarea; nivel ILUO en fila+3
 */

/* ============================================================
 * NORMALIZACIÓN Y MATCHING
 * ============================================================ */

function normalizeName(name) {
    if (!name) return '';
    return String(name).trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[,\-]/g, ' ')
        .replace(/\./g, '. ')
        .replace(/\s+/g, ' ')
        .trim();
}

function nameTokens(name) {
    return normalizeName(name).split(' ').filter(t => t.length > 0);
}

/**
 * ¿Cada token de `small` está cubierto por algún token de `big`?
 * Cubierto = idéntico, inicial con punto ("J." cubre "JOSE"),
 * o prefijo de >=3 letras en cualquier dirección (ESPINA/ESPINOSA).
 */
function tokensCovered(small, big) {
    return small.every(t => {
        if (big.includes(t)) return true;
        if (t.endsWith('.') && t.length <= 3) {
            return big.some(b => b.startsWith(t[0]));
        }
        if (t.length >= 3) {
            return big.some(b => (b.length >= 3) && (b.startsWith(t) || t.startsWith(b)));
        }
        return false;
    });
}

/**
 * Busca el operario que corresponde a un nombre del Excel ILUO.
 * @param {string} rawName        Nombre tal como viene en la matriz
 * @param {Array}  dbOperarios    [{id, nombre, ...}] de Firestore
 * @param {Object} aliases        { nombreNormalizado: operarioId } de name_aliases
 * @returns {{id: string, method: string}|null}
 */
function matchWorker(rawName, dbOperarios, aliases) {
    const nrm = normalizeName(rawName);
    if (!nrm) return null;

    // 0. Alias manual guardado en importaciones anteriores
    if (aliases && aliases[nrm]) {
        return { id: aliases[nrm], method: 'alias' };
    }

    const itok = nameTokens(rawName);
    const iset = new Set(itok);

    // Pre-calcular tokens del maestro, deduplicando por nombre normalizado
    // (el mismo operario puede aparecer varias veces si hay filas duplicadas)
    const candidates = [];
    const seen = new Set();
    for (const w of dbOperarios) {
        const wname = w.nombre || w.name || '';
        const key = normalizeName(wname) + '|' + w.id;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ id: w.id, tokens: nameTokens(wname), nrm: normalizeName(wname) });
    }

    // 1. Igualdad exacta de conjunto de tokens (mismo nombre, distinto orden)
    const exact = [];
    const seenIds = new Set();
    for (const c of candidates) {
        const cset = new Set(c.tokens);
        if (cset.size === iset.size && [...iset].every(t => cset.has(t))) {
            if (!seenIds.has(c.id)) { exact.push(c); seenIds.add(c.id); }
        }
    }
    if (exact.length === 1) return { id: exact[0].id, method: 'exact' };
    if (exact.length > 1) return null; // dos operarios distintos con el mismo nombre → manual

    // 2. Cobertura por subconjunto (con iniciales y prefijos), exigiendo match ÚNICO
    let best = null, bestScore = 0, tie = false;
    for (const c of candidates) {
        const cset = new Set(c.tokens);
        let inter = 0;
        for (const t of iset) if (cset.has(t)) inter++;
        const minLen = Math.min(iset.size, cset.size);
        const covered = tokensCovered(itok, c.tokens) || tokensCovered(c.tokens, itok);
        if (!covered) continue;
        if (inter < 2 && minLen > 2) continue;      // exigir >=2 tokens comunes salvo nombres muy cortos
        if (inter < 1) continue;

        const score = inter / Math.max(iset.size, cset.size);
        if (score > bestScore) {
            best = c; bestScore = score; tie = false;
        } else if (score === bestScore && best && c.id !== best.id) {
            tie = true;
        }
    }
    if (best && !tie && bestScore >= 0.4) {
        return { id: best.id, method: 'fuzzy' };
    }
    return null; // sin match o ambiguo → revisión manual
}

/* ============================================================
 * DETECCIÓN DE SECCIÓN
 * ============================================================ */

function guessSeccionFromFileName(fileName) {
    const f = (fileName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (f.includes('ELECTRICO') || f.includes('ELECTR')) return 'MONTAJE ELÉCTRICO';
    if (f.includes('MECANICO') || f.includes('MECAN')) return 'MONTAJE MECÁNICO';
    if (f.includes('BATERIA')) return 'BATERÍAS';
    if (f.includes('PERFILERIA') || f.includes('SOLDADURA')) return 'PERFILERÍA Y SOLDADURA';
    if (f.includes('LOGISTICA')) return 'LOGÍSTICA';
    if (f.includes('TRANSFORMACION') || f.includes('METALICA') || f.includes('METALI')) return 'TRANSFORMACIÓN METÁLICA';
    return null;
}

/* ============================================================
 * PARSER
 * ============================================================ */

function parseILUOMatrix(workbook, dbOperarios, aliases) {
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const totalRows = range.e.r + 1;
    const totalCols = range.e.c + 1;

    function cellVal(row0, col0) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row0, c: col0 })];
        if (!cell) return '';
        return String(cell.v ?? cell.w ?? '').trim();
    }

    // --- PASO 1: fila de "Habilidades" en col B ---
    let headerRow = -1;
    for (let r = 0; r < Math.min(25, totalRows); r++) {
        if (cellVal(r, 1).toUpperCase().includes('HABILIDAD')) { headerRow = r; break; }
    }
    if (headerRow === -1) {
        throw new Error('No se encontró la celda "Habilidades" en la columna B. Verifica el formato del Excel.');
    }

    // --- PASO 2: nombres de operarios (cols E, I, M... = índice 4, paso 4) ---
    const namesRow = headerRow + 1;
    const NAME_START_COL = 4;
    const NAME_STEP = 4;

    const colToWorker = {};          // col -> operarioId (solo matcheados)
    const matched = [];              // { excelName, id, method }
    const unmatched = [];            // { excelName, col } → revisión manual

    for (let c = NAME_START_COL; c < totalCols; c += NAME_STEP) {
        const rawName = cellVal(namesRow, c);
        if (!rawName) continue;
        const m = matchWorker(rawName, dbOperarios, aliases);
        if (m) {
            colToWorker[c] = m.id;
            matched.push({ excelName: rawName, id: m.id, method: m.method });
        } else {
            unmatched.push({ excelName: rawName, col: c });
        }
    }

    if (matched.length === 0 && unmatched.length === 0) {
        throw new Error(`No se encontraron nombres de operarios en la fila ${namesRow + 1}.`);
    }

    // --- PASO 3: tareas y niveles ---
    const TASK_START_ROW = headerRow + 3;
    const TASK_STEP = 4;
    const SCORE_OFFSET = 3;

    const tareas = [];
    const scores = {};               // operarioId -> { tarea: nivel }
    const unmatchedScores = {};      // excelNameNormalizado -> { tarea: nivel } (por si se asignan luego)

    for (let r = TASK_START_ROW; r < totalRows - SCORE_OFFSET; r += TASK_STEP) {
        const taskName = cellVal(r, 1);
        if (!taskName || taskName.length < 2) continue;

        const tu = taskName.toUpperCase();
        if (tu.includes('GRADO DE FORMACI') || tu.includes('TOTAL') || tu.includes('PROMEDIO') || tu.includes('MEDIA')) break;

        tareas.push(taskName);
        const scoreRow = r + SCORE_OFFSET;

        for (const [col, workerId] of Object.entries(colToWorker)) {
            const nivel = parseInt(cellVal(scoreRow, parseInt(col)), 10);
            if (nivel >= 1 && nivel <= 4) {
                (scores[workerId] ||= {})[taskName] = nivel;
            }
        }
        for (const u of unmatched) {
            const nivel = parseInt(cellVal(scoreRow, u.col), 10);
            if (nivel >= 1 && nivel <= 4) {
                (unmatchedScores[normalizeName(u.excelName)] ||= {})[taskName] = nivel;
            }
        }
    }

    if (tareas.length === 0) {
        throw new Error('No se encontraron tareas en el Excel. Verifica el formato.');
    }

    return { tareas, scores, matched, unmatched, unmatchedScores };
}

/* ============================================================
 * LIMPIEZA DE SCORES ANTIGUOS DE UNA MATRIZ
 * ============================================================ */

async function limpiarScoresDeMatriz(linea, seccion) {
    // Borra TODOS los skill_scores de esta línea+sección, incluidos
    // los antiguos con idTrabajador de 3 letras (ADL, ACR...).
    const snap = await db.collection('skill_scores')
        .where('linea', '==', linea)
        .where('seccion', '==', seccion)
        .get();
    if (snap.empty) return 0;

    const BATCH_SIZE = 400;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    return docs.length;
}

/* ============================================================
 * IMPORTACIÓN PRINCIPAL
 * ============================================================ */

/**
 * Importa una matriz ILUO. Devuelve además `matched`/`unmatched` para
 * que la UI muestre el informe y permita asignaciones manuales.
 * Los scores de nombres sin match se cachean en window._iluoPending
 * para poder aplicarlos después con aplicarAsignacionManual().
 */
async function importarMatrizILUO(file, linea, seccionOverride) {
    return new Promise(async (resolve, reject) => {
        try {
            if (typeof XLSX === 'undefined') {
                reject(new Error('SheetJS no está cargado. Revisa tu conexión a internet.'));
                return;
            }

            // 1. Operarios y alias actuales
            const [opSnapshot, aliasSnapshot] = await Promise.all([
                db.collection('operarios').get(),
                db.collection('name_aliases').get().catch(() => ({ docs: [] }))
            ]);
            const dbOperarios = opSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            const aliases = {};
            aliasSnapshot.docs.forEach(d => { aliases[d.id] = d.data().operarioId; });

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });

                    const seccion = seccionOverride || guessSeccionFromFileName(file.name);
                    if (!seccion) {
                        reject(new Error(`No se pudo determinar la sección del archivo "${file.name}". Selecciónala manualmente.`));
                        return;
                    }

                    const { tareas, scores, matched, unmatched, unmatchedScores } =
                        parseILUOMatrix(workbook, dbOperarios, aliases);

                    const seccionKey = seccion.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toUpperCase();
                    const matrixId = `${linea}_${seccionKey}`;

                    // 2. LIMPIEZA: borrar scores antiguos de esta matriz (IDs de 3 letras incluidos)
                    const deleted = await limpiarScoresDeMatriz(linea, seccion);

                    // 3. Guardar cabecera de la matriz
                    await db.collection('skill_matrices').doc(matrixId).set({
                        linea,
                        seccion,
                        tareas,
                        totalOperarios: matched.length,
                        unmatchedNames: unmatched.map(u => u.excelName),
                        updatedAt: new Date().toISOString(),
                        sourceFile: file.name
                    });

                    // 4. Guardar scores (solo operarios matcheados, con IDs 5 dígitos)
                    const BATCH_SIZE = 400;
                    const entries = Object.entries(scores);
                    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        for (const [workerId, workerScores] of entries.slice(i, i + BATCH_SIZE)) {
                            const ref = db.collection('skill_scores').doc(`${workerId}_${matrixId}`);
                            batch.set(ref, {
                                idTrabajador: workerId,
                                linea,
                                seccion,
                                scores: workerScores,
                                updatedAt: new Date().toISOString()
                            });
                        }
                        await batch.commit();
                    }

                    // 5. Cachear pendientes para asignación manual posterior
                    window._iluoPending = window._iluoPending || {};
                    window._iluoPending[matrixId] = { linea, seccion, unmatched, unmatchedScores };

                    resolve({
                        matrixId,
                        seccion,
                        totalTareas: tareas.length,
                        totalOperarios: matched.length,
                        totalScores: entries.length,
                        deleted,
                        matched,
                        unmatched
                    });
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Error leyendo el archivo'));
            reader.readAsArrayBuffer(file);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Asigna manualmente un nombre del Excel a un operario existente.
 * Escribe el alias (para futuras reimportaciones) y sube sus scores pendientes.
 */
async function aplicarAsignacionManual(matrixId, excelName, operarioId) {
    const pending = window._iluoPending && window._iluoPending[matrixId];
    if (!pending) throw new Error('No hay importación pendiente para esta matriz. Reimporta el Excel.');

    const nrm = normalizeName(excelName);

    // 1. Guardar alias para siempre
    await db.collection('name_aliases').doc(nrm).set({
        operarioId,
        excelName,
        createdAt: new Date().toISOString()
    });

    // 2. Subir sus scores si los hay
    const workerScores = pending.unmatchedScores[nrm];
    if (workerScores && Object.keys(workerScores).length > 0) {
        await db.collection('skill_scores').doc(`${operarioId}_${matrixId}`).set({
            idTrabajador: operarioId,
            linea: pending.linea,
            seccion: pending.seccion,
            scores: workerScores,
            updatedAt: new Date().toISOString()
        });
    }

    // 3. Quitar de la lista de pendientes y actualizar cabecera
    pending.unmatched = pending.unmatched.filter(u => normalizeName(u.excelName) !== nrm);
    await db.collection('skill_matrices').doc(matrixId).set({
        unmatchedNames: pending.unmatched.map(u => u.excelName),
        totalOperarios: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });

    return true;
}
