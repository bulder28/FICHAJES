/**
 * excel.js - Parser de Matrices ILUO para STULZ
 * 
 * PATRÓN REAL DEL EXCEL (descubierto por inspección directa):
 *  - Fila 10: [col 2] = "Habilidades", [col 5] = "Nombre"
 *  - Fila 11: Nombres de operarios en cols 5, 9, 13, 17... (paso = 4 columnas, celdas fusionadas)
 *  - Fila 13+: cada TAREA ocupa un bloque de 4 filas:
 *      tarea_fila+0: [col 2] = nombre de la tarea
 *      tarea_fila+3: [col 5] = nivel ILUO (1-4) de operario 1, [col 9] = nivel de op2, etc.
 *  - Las tareas van de fila en fila con un paso de 4 filas (13, 17, 21, 25...)
 */

/**
 * Convierte "APELLIDO1 APELLIDO2, NOMBRE" → iniciales de 3 letras (NAS)
 * o "NOMBRE APELLIDO1 APELLIDO2" → iniciales (NAA)
 */
 * Normaliza nombres para hacer "fuzzy match" con la base de datos
 */
function normalizeName(name) {
    if (!name) return '';
    return name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Adivina la sección del nombre del archivo
 */
function guessSeccionFromFileName(fileName) {
    const f = (fileName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (f.includes('ELECTRICO') || f.includes('ELECTR')) return 'MONTAJE ELÉCTRICO';
    if (f.includes('MECANICO') || f.includes('MECAN')) return 'MONTAJE MECÁNICO';
    if (f.includes('BATERIA')) return 'BATERÍAS';
    if (f.includes('PERFILERIA') || f.includes('SOLDADURA')) return 'PERFILERÍA Y SOLDADURA';
    if (f.includes('LOGISTICA')) return 'LOGÍSTICA';
    if (f.includes('TRANSFORMACION') || f.includes('METALICA') || f.includes('METALI')) return 'TRANSFORMACIÓN METÁLICA';
    return null; // Desconocida → usar el selector manual
}

/**
 * Parser principal: recibe un workbook de SheetJS y lista de operarios de la BBDD
 * 
 * scores = { "RAL": { "PREPARACIÓN CONECTORES": 3, "CORTE MANGUERAS": 2 }, ... }
 */
function parseILUOMatrix(workbook, dbOperarios) {
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convertir a matriz 2D (1-indexed simulado con array 0-indexed)
    // Usamos range para saber límites
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const totalRows = range.e.r + 1;
    const totalCols = range.e.c + 1;
    
    function cellVal(row0, col0) {
        // row0 y col0 son 0-indexed
        const addr = XLSX.utils.encode_cell({ r: row0, c: col0 });
        const cell = worksheet[addr];
        if (!cell) return '';
        return String(cell.v || cell.w || '').trim();
    }
    
    // --- PASO 1: Encontrar la fila de "Habilidades" (col B = columna índice 1) ---
    let headerRow = -1;
    for (let r = 0; r < Math.min(25, totalRows); r++) {
        const val = cellVal(r, 1); // Col B (índice 1)
        if (val.toUpperCase().includes('HABILIDAD')) {
            headerRow = r;
            break;
        }
    }
    
    if (headerRow === -1) {
        throw new Error('No se encontró la celda "Habilidades" en la columna B. Verifica el formato del Excel.');
    }
    
    // --- PASO 2: Leer nombres de operarios ---
    const namesRow = headerRow + 1;
    const NAME_START_COL = 4;
    const NAME_STEP = 4;
    
    // Buscar el ID numérico más alto en la base de datos actual para seguir la secuencia
    let maxId = 0;
    if (dbOperarios && dbOperarios.length > 0) {
        dbOperarios.forEach(w => {
            const num = parseInt(w.id, 10);
            if (!isNaN(num) && num > maxId) {
                maxId = num;
            }
        });
    }
    
    const colToWorker = {};
    const newOperarios = []; // Guardaremos los creados automáticamente
    
    for (let c = NAME_START_COL; c < totalCols; c += NAME_STEP) {
        const rawName = cellVal(namesRow, c);
        if (rawName && rawName.length > 0) {
            const normalizedExcelName = normalizeName(rawName);
            // Buscamos coincidencia en nombre o nombre normalizado
            const foundWorker = dbOperarios.find(w => normalizeName(w.nombre) === normalizedExcelName || normalizeName(w.name) === normalizedExcelName);
            
            if (foundWorker) {
                colToWorker[c] = foundWorker.id;
            } else {
                // AUTO-GENERAR ID
                maxId++;
                const newId = String(maxId).padStart(3, '0');
                colToWorker[c] = newId;
                
                newOperarios.push({
                    id: newId,
                    nombre: rawName,
                    tipo: 'STULZ', // Por defecto
                    seccionAsignada: 'Producción'
                });
            }
        }
    }
    
    if (Object.keys(colToWorker).length === 0) {
        throw new Error(`No se encontraron nombres de operarios válidos en la fila ${namesRow + 1}.`);
    }
    
    // --- PASO 3: Leer tareas y niveles ---
    const TASK_START_ROW = headerRow + 3;
    const TASK_STEP = 4;
    const SCORE_OFFSET = 3;
    
    const tareas = [];
    const scores = {};
    
    for (let r = TASK_START_ROW; r < totalRows - SCORE_OFFSET; r += TASK_STEP) {
        const taskName = cellVal(r, 1);
        if (!taskName || taskName.length < 2) continue;
        
        const taskUpper = taskName.toUpperCase();
        if (taskUpper.includes('GRADO DE FORMACI') || 
            taskUpper.includes('TOTAL') ||
            taskUpper.includes('PROMEDIO') ||
            taskUpper.includes('MEDIA')) {
            break;
        }
        
        tareas.push(taskName);
        
        const scoreRow = r + SCORE_OFFSET;
        for (const [col, workerId] of Object.entries(colToWorker)) {
            const raw = cellVal(scoreRow, parseInt(col));
            const nivel = parseInt(raw, 10);
            if (nivel >= 1 && nivel <= 4) {
                if (!scores[workerId]) scores[workerId] = {};
                scores[workerId][taskName] = nivel;
            }
        }
    }
    
    if (tareas.length === 0) {
        throw new Error('No se encontraron tareas en el Excel. Verifica el formato.');
    }
    
    return {
        tareas,
        scores,
        totalOperarios: Object.keys(colToWorker).length,
        operarios: colToWorker,
        newOperarios // <-- Exportamos los nuevos operarios creados
    };
}

/**
 * Función principal llamada desde configuracion/js/app.js
 * Sube los datos parseados a Firebase
 */
async function importarMatrizILUO(file, linea, seccionOverride) {
    return new Promise(async (resolve, reject) => {
        try {
            // 1. Descargar plantilla maestra para hacer match de nombres a IDs
            const opSnapshot = await db.collection('operarios').get();
            const dbOperarios = opSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            if (typeof XLSX === 'undefined') {
                reject(new Error('SheetJS no está cargado. Revisa tu conexión a internet.'));
                return;
            }
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    const seccion = seccionOverride || guessSeccionFromFileName(file.name);
                    if (!seccion) {
                        reject(new Error(`No se pudo determinar la sección del archivo "${file.name}". Selecciónala manualmente.`));
                        return;
                    }
                    
                    const { tareas, scores, totalOperarios, newOperarios } = parseILUOMatrix(workbook, dbOperarios);
                    
                    const seccionKey = seccion.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_').toUpperCase();
                    const matrixId = `${linea}_${seccionKey}`;
                    
                    // 2. Guardar matrices
                    await db.collection('skill_matrices').doc(matrixId).set({
                        linea,
                        seccion,
                        tareas,
                        totalOperarios,
                        updatedAt: new Date().toISOString(),
                        sourceFile: file.name
                    });

                    // 3. Guardar los nuevos operarios auto-generados (si los hay)
                    if (newOperarios && newOperarios.length > 0) {
                        const batchOperarios = db.batch();
                        for (const op of newOperarios) {
                            const docRef = db.collection('operarios').doc(op.id);
                            batchOperarios.set(docRef, {
                                nombre: op.nombre,
                                tipo: op.tipo,
                                seccionAsignada: op.seccionAsignada,
                                updatedAt: new Date().toISOString()
                            }, { merge: true });
                        }
                        await batchOperarios.commit();
                        console.log(`Auto-creados ${newOperarios.length} nuevos operarios.`);
                    }
                    
                    // 4. Guardar Scores
                    const BATCH_SIZE = 400;
                    const entries = Object.entries(scores);
                    
                    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = entries.slice(i, i + BATCH_SIZE);
                        for (const [workerId, workerScores] of chunk) {
                            const docId = `${workerId}_${matrixId}`;
                            const ref = db.collection('skill_scores').doc(docId);
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
                    
                    resolve({
                        matrixId,
                        seccion,
                        totalTareas: tareas.length,
                        totalOperarios,
                        totalScores: entries.length
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
