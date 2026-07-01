// configuracion/js/app.js - Lógica del Panel de Configuración Global

let operariosData = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Iniciar reloj (shared.js)
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    // Listener para el buscador
    const searchInput = document.getElementById('search-worker');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderWorkersTable(searchInput.value.toLowerCase());
        });
    }

    // Modal forms
    const formWorker = document.getElementById('worker-form');
    if (formWorker) {
        formWorker.addEventListener('submit', handleWorkerSubmit);
    }
    
    const syncLineas = document.getElementById('sync-lineas-file');
    if (syncLineas) {
        syncLineas.addEventListener('change', handleSyncLineas);
    }
    
    // Importador ILUO (usando el nuevo excel.js)
    const btnImportIluo = document.getElementById('btn-import-iluo');
    if (btnImportIluo) {
        btnImportIluo.addEventListener('click', handleImportIluo);
    }

    // Importador Masivo de Operarios
    const inputImportOperarios = document.getElementById('import-operarios-file');
    if (inputImportOperarios) {
        inputImportOperarios.addEventListener('change', handleImportOperariosMasivo);
    }

    await loadData();
});

async function handleImportOperariosMasivo(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast("Librería SheetJS no cargada.", "error");
        e.target.value = '';
        return;
    }

    try {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                showToast("Procesando plantilla de operarios...", "info");
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Detección automática: si el libro trae las hojas "ETT" y/o "Personal fabrica"
                // usamos el parser específico del formato real (Operarios_Lineas_ETT_*.xlsx)
                const sheetNames = workbook.SheetNames;
                const esFormatoLineasETT = sheetNames.includes('ETT') || sheetNames.includes('Personal fabrica');

                let count = 0;

                if (esFormatoLineasETT) {
                    const opSnapshot = await db.collection('operarios').get();
                    const dbOperarios = opSnapshot.docs.map(d => ({ id_doc: d.id, ...d.data() }));

                    const registros = parseOperariosLineasWorkbook(workbook, dbOperarios);

                    if (registros.length === 0) {
                        showToast("No se encontraron operarios válidos en las hojas 'ETT' / 'Personal fabrica'.", "warning");
                        return;
                    }

                    const BATCH_SIZE = 400;
                    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = registros.slice(i, i + BATCH_SIZE);
                        chunk.forEach(reg => {
                            const docRef = db.collection('operarios').doc(reg.docId);
                            batch.set(docRef, reg.payload, { merge: true });
                        });
                        await batch.commit();
                        count += chunk.length;
                    }

                    showToast(`Se han importado/actualizado ${count} operarios (ETT + Personal fábrica).`, "success");
                    await loadData();
                    return;
                }

                // --- Formato genérico simple: columnas ID | Nombre | Tipo | Sección ---
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

                if (rows.length < 2) {
                    showToast("El archivo está vacío o no tiene datos.", "warning");
                    e.target.value = '';
                    return;
                }

                // Empezamos desde la fila 1 (ignoramos la 0 que es cabecera)
                const batch = db.batch();

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    
                    let rawId = String(row[0] || '').trim();
                    const nombre = String(row[1] || '').trim();
                    const tipo = String(row[2] || '').toUpperCase().trim();
                    const seccion = String(row[3] || '').trim();

                    if (!rawId || !nombre) continue; // Si no hay ID o Nombre, saltamos
                    
                    // Forzamos el ID a 3 dígitos (ej: "42" -> "042")
                    const cleanId = rawId.padStart(3, '0');

                    const docRef = db.collection('operarios').doc(cleanId);
                    
                    const payload = {
                        nombre: nombre,
                        tipo: (tipo === 'ETT') ? 'ETT' : 'STULZ',
                        seccionAsignada: seccion || 'No Definida',
                        updatedAt: new Date().toISOString()
                    };

                    batch.set(docRef, payload, { merge: true });
                    count++;
                }

                if (count > 0) {
                    await batch.commit();
                    showToast(`Se han importado/actualizado ${count} operarios con éxito.`, "success");
                    await loadData(); // Recargamos la tabla
                } else {
                    showToast("No se encontraron filas válidas para importar.", "warning");
                }

            } catch (err) {
                console.error("Error al procesar excel de operarios:", err);
                showToast("Error procesando Excel: " + err.message, "error");
            }
        };
        reader.onerror = () => {
            showToast("Error leyendo archivo local.", "error");
        };
        reader.readAsArrayBuffer(file);
    } catch (error) {
        console.error("Error de inicialización de lectura:", error);
        showToast("Error: " + error.message, "error");
    } finally {
        e.target.value = ''; // Reset
    }
}

// ----------------------------------------------------
// Parser específico para el formato real "Operarios_Lineas_ETT_*.xlsx"
// Hoja "Personal fabrica" -> plantilla propia STULZ (prefijo ID 00XXX)
// Hoja "ETT"              -> personal de agencia (Aura -> 04XXX, EuroFirms -> 06XXX)
// ----------------------------------------------------

function toTitleCase(str) {
    return (str || '')
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function buildIdCounters(dbOperarios) {
    const counters = { '00': 0, '04': 0, '06': 0 };
    dbOperarios.forEach(w => {
        const id = w.idTrabajador || w.id_doc || '';
        if (/^\d{5}$/.test(id)) {
            const prefix = id.slice(0, 2);
            const suffix = parseInt(id.slice(2), 10);
            if (counters[prefix] !== undefined && suffix > counters[prefix]) {
                counters[prefix] = suffix;
            }
        }
    });
    return counters;
}

function nextId(counters, prefix) {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return prefix + String(counters[prefix]).padStart(3, '0');
}

function excelCellVal(ws, r, c) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr];
    if (!cell) return '';
    return String(cell.v !== undefined ? cell.v : '').trim();
}

function parseOperariosLineasWorkbook(workbook, dbOperarios) {
    const registros = [];
    const counters = buildIdCounters(dbOperarios);

    // Mapa de nombres normalizados -> operario existente (para no duplicar en reimportaciones)
    const nameMap = {};
    dbOperarios.forEach(w => {
        const key = normalizeName(w.nombre);
        if (key) nameMap[key] = w;
    });

    // ---------- HOJA "Personal fabrica" (plantilla propia STULZ) ----------
    if (workbook.SheetNames.includes('Personal fabrica')) {
        const ws = workbook.Sheets['Personal fabrica'];
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

        // Localizar la fila/columna de cabecera buscando la celda "Nombre"
        let headerRow = -1, nameCol = -1;
        for (let r = 0; r <= Math.min(10, range.e.r) && headerRow === -1; r++) {
            for (let c = 0; c <= range.e.c; c++) {
                if (excelCellVal(ws, r, c).toUpperCase() === 'NOMBRE') {
                    headerRow = r; nameCol = c; break;
                }
            }
        }

        if (headerRow !== -1) {
            const deptCol = nameCol + 1;
            const checkCol = nameCol + 2;
            const turnoCol = nameCol + 3;
            const lineaCol = nameCol + 4;

            for (let r = headerRow + 1; r <= range.e.r; r++) {
                const nombre = excelCellVal(ws, r, nameCol);
                if (!nombre) continue;

                // Si hay columna "Check" y no dice OK, saltamos la fila (dato incompleto/de baja)
                const check = excelCellVal(ws, r, checkCol);
                if (check && !check.toUpperCase().includes('OK')) continue;

                const departamento = excelCellVal(ws, r, deptCol);
                const turno = excelCellVal(ws, r, turnoCol);
                const linea = excelCellVal(ws, r, lineaCol);

                const key = normalizeName(nombre);
                const existing = nameMap[key];
                const docId = existing ? (existing.idTrabajador || existing.id_doc) : nextId(counters, '00');

                registros.push({
                    docId,
                    payload: {
                        idTrabajador: docId,
                        nombre: nombre,
                        isETT: false,
                        agencia: null,
                        seccionBase: departamento ? departamento.toUpperCase() : '',
                        lineaBase: linea ? linea.toUpperCase() : '',
                        turnoBase: turno || '',
                        updatedAt: new Date().toISOString()
                    }
                });

                if (!existing) nameMap[key] = { idTrabajador: docId };
            }
        }
    }

    // ---------- HOJA "ETT" (personal de agencia) ----------
    if (workbook.SheetNames.includes('ETT')) {
        const ws = workbook.Sheets['ETT'];
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

        // Columnas fijas del formato conocido: B=Empleado, C=Empresa, E=Sección, G=Línea, J=Turno
        const EMPLEADO_COL = 1, EMPRESA_COL = 2, SECCION_COL = 4, LINEA_COL = 6, TURNO_COL = 9;

        for (let r = 1; r <= range.e.r; r++) {
            const empleadoRaw = excelCellVal(ws, r, EMPLEADO_COL);
            if (!empleadoRaw) continue;

            // El nombre viene como "APELLIDOS, NOMBRE" -> lo invertimos a "Nombre Apellidos"
            let nombre;
            if (empleadoRaw.includes(',')) {
                const partes = empleadoRaw.split(',');
                const apellidos = partes[0].trim();
                const nombrePila = partes.slice(1).join(',').trim();
                nombre = toTitleCase(`${nombrePila} ${apellidos}`);
            } else {
                nombre = toTitleCase(empleadoRaw);
            }

            const empresaRaw = excelCellVal(ws, r, EMPRESA_COL).toUpperCase();

            // Filtrar bajas / no incorporados: si en cualquier celda de la fila aparece
            // "BAJA" o "NO INCORPORADO", omitimos la fila
            let esBaja = false;
            for (let c = 0; c <= range.e.c; c++) {
                const v = excelCellVal(ws, r, c).toUpperCase();
                if (v.includes('BAJA') || v.includes('NO INCORPORADO')) { esBaja = true; break; }
            }
            if (esBaja) continue;

            let agencia = 'OTRA', prefix = '06';
            if (empresaRaw.includes('AURA')) { agencia = 'AURA'; prefix = '04'; }
            else if (empresaRaw.includes('EURO')) { agencia = 'EUROFIRMS'; prefix = '06'; }

            const seccion = excelCellVal(ws, r, SECCION_COL);
            const linea = excelCellVal(ws, r, LINEA_COL);
            const turno = excelCellVal(ws, r, TURNO_COL);

            const key = normalizeName(nombre);
            const existing = nameMap[key];
            const docId = existing ? (existing.idTrabajador || existing.id_doc) : nextId(counters, prefix);

            registros.push({
                docId,
                payload: {
                    idTrabajador: docId,
                    nombre: nombre,
                    isETT: true,
                    agencia: agencia,
                    seccionBase: seccion ? seccion.toUpperCase() : '',
                    lineaBase: linea ? linea.toUpperCase() : '',
                    turnoBase: turno || '',
                    updatedAt: new Date().toISOString()
                }
            });

            if (!existing) nameMap[key] = { idTrabajador: docId };
        }
    }

    // Deduplicar por docId (si una persona aparece dos veces en el Excel, gana la última fila)
    const porId = {};
    registros.forEach(reg => { porId[reg.docId] = reg; });
    return Object.values(porId);
}

async function handleImportIluo() {
    const fileInput = document.getElementById('iluo-file');
    const lineaSelect = document.getElementById('iluo-linea');
    const seccionSelect = document.getElementById('iluo-seccion');
    const btn = document.getElementById('btn-import-iluo');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showToast('Selecciona al menos un archivo Excel (.xlsx)', 'warning');
        return;
    }

    if (typeof importarMatrizILUO !== 'function') {
        showToast('Error interno: el módulo excel.js no está cargado.', 'error');
        return;
    }

    const linea = lineaSelect.value;
    const seccionManual = seccionSelect.value; // Siempre hay un valor por defecto

    btn.disabled = true;
    btn.textContent = 'Importando...';

    let totalImported = 0;
    let errors = [];

    for (const file of fileInput.files) {
        try {
            // Primero intentamos adivinar la sección del nombre del archivo
            // Si no se puede, usamos el selector manual
            const result = await importarMatrizILUO(file, linea, seccionManual);
            totalImported++;
            console.log(`✓ ${file.name} → ${result.seccion}: ${result.totalTareas} tareas, ${result.totalScores} operarios`);
        } catch (err) {
            console.error(`✗ Error en ${file.name}:`, err);
            errors.push(`${file.name}: ${err.message}`);
        }
    }

    btn.disabled = false;
    btn.textContent = 'Importar Matriz';
    fileInput.value = '';

    if (errors.length === 0) {
        showToast(`✓ ${totalImported} archivo(s) importados correctamente.`, 'success');
    } else if (totalImported > 0) {
        showToast(`${totalImported} importados, ${errors.length} con errores. Revisa la consola.`, 'warning');
    } else {
        showToast('Error importando: ' + errors[0], 'error');
    }
}



async function loadData() {
    if (typeof updateDbStatus === 'function') updateDbStatus(false);

    try {
        await Promise.all([
            loadGlobalConfig(),
            loadWorkers()
        ]);
        if (typeof updateDbStatus === 'function') updateDbStatus(true);
    } catch (e) {
        console.error("Error cargando configuración:", e);
        showToast("Error crítico conectando a la base de datos.", "error");
    }
}

// ----------------------------------------------------
// 1. GESTIÓN DE VARIABLES GLOBALES (CONFIG)
// ----------------------------------------------------
async function loadGlobalConfig() {
    try {
        const configDoc = await db.collection('config').doc('global').get();
        if (configDoc.exists) {
            const data = configDoc.data();
            if (data.tarifaETT) document.getElementById('config-tarifa').value = data.tarifaETT;
            if (data.maxHorasFichaje) document.getElementById('config-max-horas').value = data.maxHorasFichaje;
            if (data.umbralAutonomia) document.getElementById('config-umbral').value = data.umbralAutonomia;
        } else {
            // Valores por defecto sugeridos por los Agentes
            document.getElementById('config-tarifa').value = 18.0;
            document.getElementById('config-max-horas').value = 10;
            document.getElementById('config-umbral').value = 10;
            
            // Creamos el documento inicial silenciosamente
            await db.collection('config').doc('global').set({
                tarifaETT: 18.0,
                maxHorasFichaje: 10,
                umbralAutonomia: 10,
                updatedAt: new Date().toISOString()
            });
        }
    } catch (e) {
        console.error("Error leyendo config global:", e);
    }
}

async function saveConfig(type) {
    try {
        const updates = { updatedAt: new Date().toISOString() };
        
        if (type === 'tarifa') {
            const val = parseFloat(document.getElementById('config-tarifa').value);
            if (isNaN(val) || val <= 0) return showToast("Por favor, introduce una tarifa válida mayor que 0.", "warning");
            updates.tarifaETT = val;
        } 
        else if (type === 'planta') {
            const maxH = parseFloat(document.getElementById('config-max-horas').value);
            const umbral = parseFloat(document.getElementById('config-umbral').value);
            
            if (isNaN(maxH) || maxH <= 0 || isNaN(umbral) || umbral <= 0) {
                return showToast("Las horas deben ser valores numéricos positivos.", "warning");
            }
            updates.maxHorasFichaje = maxH;
            updates.umbralAutonomia = umbral;
        }

        // Merge actualiza solo los campos enviados
        await db.collection('config').doc('global').set(updates, { merge: true });
        
        showToast("¡Configuración guardada con éxito!", "success");
        
    } catch (e) {
        console.error("Error guardando config:", e);
        showToast("Fallo al guardar la configuración.", "error");
    }
}


// ----------------------------------------------------
// 2. GESTIÓN DE PLANTILLA (CRUD OPERARIOS)
// ----------------------------------------------------
async function loadWorkers() {
    try {
        const snap = await db.collection('operarios').get();
        operariosData = [];
        snap.forEach(doc => {
            operariosData.push({ id_doc: doc.id, ...doc.data() });
        });
        
        // Ordenar numéricamente o alfabéticamente por ID
        operariosData.sort((a, b) => (a.idTrabajador || a.id || '').localeCompare(b.idTrabajador || b.id || ''));
        console.log("Operarios cargados desde Firebase:", operariosData.length);
        
        // Mostrar en la pantalla lo que ve el navegador
        showToast("DEBUG: Encontrados " + operariosData.length + " operarios en Firebase", "info");

        renderWorkersTable();
    } catch (e) {
        console.error("Error cargando operarios:", e);
        showToast("DEBUG ERROR: " + e.message, "error");
    }
}

function renderWorkersTable(filterText = '') {
    const tbody = document.getElementById('workers-body');
    tbody.innerHTML = '';

    const filtered = operariosData.filter(w => {
        const id = (w.idTrabajador || w.id || '').toLowerCase();
        return id.includes(filterText);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No se encontraron operarios.</td></tr>`;
        return;
    }

    filtered.forEach(worker => {
        const isEtt = worker.isETT || worker.agencia === 'EUROFIRMS' || worker.agencia === 'AURA';
        const typeBadge = isEtt 
            ? `<span class="badge badge-ett">ETT</span>` 
            : `<span class="badge badge-stulz">STULZ</span>`;
            
        const agencia = worker.agencia ? worker.agencia : (isEtt ? 'Generica' : '--');
        const seccionBadge = worker.seccionAsignada ? ` <span style="font-size:0.8rem; color:#94a3b8;">/ ${worker.seccionAsignada}</span>` : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500;">${worker.idTrabajador || worker.id || '-'}</td>
            <td style="font-weight: 500; color: #0f172a;">${worker.nombre || '<span style="color:#ef4444; font-size:0.8rem;">Falta Nombre</span>'}</td>
            <td>${typeBadge}</td>
            <td>${agencia}${seccionBadge}</td>
            <td>
                <button class="btn-secondary btn-small" onclick="editWorker('${worker.id_doc}')" style="margin-right: 0.5rem;" title="Editar operario">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="btn-danger" onclick="deleteWorker('${worker.id_doc}', '${worker.idTrabajador || worker.id || ''}')" title="Eliminar definitivamente">
                    <i class="ph ph-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleAgenciaField() {
    const isEtt = document.getElementById('worker-is-ett').value === 'true';
    document.getElementById('group-agencia').style.display = isEtt ? 'block' : 'none';
}

function openWorkerModal() {
    document.getElementById('worker-form').reset();
    document.getElementById('worker-doc-id').value = '';
    document.getElementById('modal-title').innerText = 'Añadir Nuevo Operario';
    toggleAgenciaField();
    document.getElementById('worker-modal').style.display = 'flex';
}

function closeWorkerModal() {
    document.getElementById('worker-modal').style.display = 'none';
}

function editWorker(docId) {
    const worker = operariosData.find(w => w.id_doc === docId);
    if (!worker) return;

    document.getElementById('worker-doc-id').value = docId;
    document.getElementById('worker-id').value = worker.idTrabajador || worker.id || '';
    document.getElementById('worker-name').value = worker.nombre || '';
    
    const isEtt = worker.isETT || worker.agencia === 'EUROFIRMS' || worker.agencia === 'AURA';
    document.getElementById('worker-is-ett').value = isEtt ? 'true' : 'false';
    
    toggleAgenciaField();
    
    if (isEtt) {
        document.getElementById('worker-agencia').value = worker.agencia || 'OTRA';
    }

    document.getElementById('modal-title').innerText = 'Editar Operario';
    document.getElementById('worker-modal').style.display = 'flex';
}

async function handleWorkerSubmit(e) {
    e.preventDefault();
    
    const docId = document.getElementById('worker-doc-id').value;
    const idTrabajador = document.getElementById('worker-id').value.toUpperCase();
    const nombre = document.getElementById('worker-name').value;
    const isEtt = document.getElementById('worker-is-ett').value === 'true';
    const agencia = isEtt ? document.getElementById('worker-agencia').value : null;

    if (!idTrabajador || !nombre) {
        showToast("El ID y el Nombre son obligatorios.", "warning");
        return;
    }

    const payload = {
        idTrabajador: idTrabajador,
        nombre: nombre,
        isETT: isEtt,
        agencia: agencia,
        updatedAt: new Date().toISOString()
    };

    try {
        if (docId) {
            // Edit
            await db.collection('operarios').doc(docId).update(payload);
        } else {
            // Para mantener compatibilidad con algunos sitios que leen 'id', lo forzamos como doc ID
            await db.collection('operarios').doc(idTrabajador).set(payload);
        }
        
        closeWorkerModal();
        await loadWorkers(); // Recargar tabla
        
        // Poka-Yoke Visual QA
        showToast(`Operario con ID ${idTrabajador} guardado correctamente.`, "success");
        
    } catch (e) {
        console.error("Error guardando operario:", e);
        showToast("Fallo al guardar en la base de datos.", "error");
    }
}

async function handleSyncLineas(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast("Librería SheetJS no cargada.", "error");
        e.target.value = '';
        return;
    }

    try {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                showToast("Procesando archivo de líneas...", "info");
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

                if (rows.length < 2) {
                    showToast("El archivo está vacío o mal formado", "error");
                    return;
                }
                
                // Encontrar headers
                const headers = rows[0].map(h => String(h).toUpperCase().trim());
                const nameIdx = headers.findIndex(h => h.includes('NOMBRE') || h.includes('OPERARIO'));
                const lineaIdx = headers.findIndex(h => h.includes('LINEA') || h.includes('LÍNEA'));
                
                if (nameIdx === -1 || lineaIdx === -1) {
                    showToast("No se encontró la columna 'Nombre' o 'Linea'", "error");
                    return;
                }

                // Generar iniciales (3 letras)
                function getInitials(fullName) {
                    let parts = fullName.split(' ');
                    if (parts.length >= 3) {
                        // Formato: Nombre Apellido1 Apellido2
                        return (parts[0].charAt(0) + parts[1].charAt(0) + parts[2].charAt(0)).toUpperCase();
                    } else if (parts.length === 2) {
                        return (parts[0].charAt(0) + parts[1].charAt(0) + parts[1].charAt(1)).toUpperCase();
                    } else if (parts.length === 1) {
                        return parts[0].substring(0, 3).toUpperCase();
                    }
                    return "";
                }
                
                let count = 0;
                let added = 0;
                
                const batches = [db.batch()];
                let currentBatch = 0;
                let opCount = 0;

                const normalize = (str) => {
                    if (!str) return '';
                    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
                };
                
                // Iterar desde la fila 1 (datos)
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const fullName = String(row[nameIdx]).trim();
                    const linea = String(row[lineaIdx]).trim();
                    
                    if (!fullName || !linea) continue;
                    
                    // Convertir el nombre en el ID (3 letras)
                    // Si el nombre viene en "APELLIDO, NOMBRE", hay que ajustarlo, pero parece ser "Luis Moreno Arenas" (Nombre Apellido1 Apellido2)
                    let idTrabajador = "";
                    if (fullName.includes(',')) {
                        let p = fullName.split(',');
                        let nom = (p[1].trim().split(' ')[0] || '').charAt(0);
                        let ap = p[0].trim().split(' ');
                        let a1 = (ap[0] || '').charAt(0);
                        let a2 = ap.length > 1 ? ap[1].charAt(0) : (ap[0] || '').charAt(0);
                        idTrabajador = (nom + a1 + a2).toUpperCase();
                    } else {
                        idTrabajador = getInitials(fullName);
                    }
                    
                    if (!idTrabajador || idTrabajador.length !== 3) continue;
                    
                    // Buscar en operariosData si existe por ID o por nombre
                    const normFullName = normalize(fullName);
                    const existing = operariosData.find(w => 
                        w.idTrabajador === idTrabajador || 
                        w.id_doc === idTrabajador ||
                        normalize(w.nombre) === normFullName
                    );
                    
                    let ref;
                    if (existing) {
                        ref = db.collection('operarios').doc(existing.id_doc);
                        batches[currentBatch].update(ref, { 
                            lineaBase: linea,
                            updatedAt: new Date().toISOString()
                        });
                        count++;
                    } else {
                        // Crear nuevo operario
                        ref = db.collection('operarios').doc(idTrabajador);
                        batches[currentBatch].set(ref, {
                            idTrabajador: idTrabajador,
                            nombre: fullName,
                            isETT: true, // Automáticamente asignado a ETT
                            agencia: 'EUROFIRMS',
                            seccionAsignada: "Producción",
                            lineaBase: linea,
                            updatedAt: new Date().toISOString()
                        }, { merge: true });
                        added++;
                    }

                    opCount++;
                    if (opCount >= 450) { // Límite de seguridad para Firebase (max 500)
                        batches.push(db.batch());
                        currentBatch++;
                        opCount = 0;
                    }
                }
                
                // Ejecutar todos los lotes
                for (let b of batches) {
                    await b.commit();
                }
                
                await loadWorkers();
                showToast(`Sincronización completada: ${added} nuevos y ${count} actualizados.`, "success");

            } catch (err) {
                console.error(err);
                showToast("Error importando: " + err.message, "error");
            }
        };
        reader.readAsArrayBuffer(file);
    } catch (e) {
        showToast("Fallo al leer archivo", "error");
    } finally {
        e.target.value = '';
    }
}

async function deleteWorker(docId, idTrabajador) {
    // Usamos modal corporativo para evitar el warning pero mantenemos lógica
    // Nota: Como no podemos inyectar dinámicamente texto en el shared modal actual fácilmente,
    // usaremos el modal estándar que pregunta "¿Estás seguro...?"
    const confirmed = await showConfirmModal();
    if (confirmed) {
        try {
            await db.collection('operarios').doc(docId).delete();
            showToast(`Operario con ID ${idTrabajador} eliminado.`, "info");
            await loadWorkers(); // Recargar
        } catch (e) {
            console.error("Error borrando:", e);
            showToast("No se pudo eliminar el operario.", "error");
        }
    }
}
