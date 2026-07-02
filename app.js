// Firebase y funciones compartidas (updateClock, updateDbStatus) ahora están en shared.js

let trainingRecords = [];
let validWorkerIds = []; // Poka-yoke para validar IDs

const lines = ['', 'L1', 'L2', 'L3', 'L4', 'L5', 'BOX 1'];
const departamentos = ['', 'Montaje Mecánico', 'Montaje Eléctrico', 'Baterías', 'Transformación Metálica', 'Perfilería y Soldadura', 'Logística', 'TEST FINAL', 'REFRIGERACIÓN', 'HIDRÁULICO'];
window.iluoData = []; // Caché global de la matriz ILUO
const shifts = ['Mañana', 'Tarde'];

// Calcular la fecha laboral del turno (con 2 horas de retraso)
function getShiftDate() {
    const now = new Date(Date.now() - 2 * 60 * 60 * 1000);
    return now.toISOString().split('T')[0];
}

// Calcular el turno correspondiente según la hora actual
function getShiftName() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 14) {
        return 'Mañana';
    }
    return 'Tarde';
}

// (updateClock movido a shared.js)

// Notificaciones y Modales centralizados en shared.js

// Inicializar la aplicación
async function initApp() {
    // Lógica para Modo Administrador
    const urlParams = new URLSearchParams(window.location.search);
    let isAdmin = urlParams.get('admin') === '1';
    window.lockedLinea = urlParams.get('linea') || null;

    const enableAdminMode = () => {
        isAdmin = true;
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = '';
        });
    };

    if (isAdmin) {
        enableAdminMode();
    }

    // POKA-YOKE: Auto-importación de Calendario Laboral 2026 (Se ejecuta solo 1 vez)
    if (!localStorage.getItem('calendario2026_importado')) {
        const holidays2026 = [
            { fecha: "2026-01-01", motivo: "AÑO NUEVO" }, { fecha: "2026-01-06", motivo: "EPIFANÍA DEL SEÑOR" },
            { fecha: "2026-04-02", motivo: "JUEVES SANTO" }, { fecha: "2026-04-03", motivo: "VIERNES SANTO" },
            { fecha: "2026-04-06", motivo: "SUSTITUCIÓN DE SAN JOSÉ" }, { fecha: "2026-05-01", motivo: "DÍA DEL TRABAJO" },
            { fecha: "2026-06-04", motivo: "CORPUS CHRISTI" }, { fecha: "2026-08-15", motivo: "ASUNCIÓN DE LA VIRGEN" },
            { fecha: "2026-10-12", motivo: "DÍA DE LA HISPANIDAD" }, { fecha: "2026-11-02", motivo: "SUSTITUCIÓN DE TODOS LOS SANTOS" },
            { fecha: "2026-12-07", motivo: "SUSTITUCIÓN CONSTITUCIÓN ESPAÑOLA" }, { fecha: "2026-12-08", motivo: "DÍA DE LA INMACULADA CONCEPCIÓN" },
            { fecha: "2026-12-25", motivo: "NAVIDAD" }, { fecha: "2026-01-02", motivo: "PUENTE" },
            { fecha: "2026-06-05", motivo: "PUENTE" }, { fecha: "2026-12-24", motivo: "PUENTE (NOCHEBUENA)" },
            { fecha: "2026-12-31", motivo: "PUENTE (NOCHEVIEJA)" }, { fecha: "2026-03-30", motivo: "VACACIONES" },
            { fecha: "2026-03-31", motivo: "VACACIONES" }, { fecha: "2026-04-01", motivo: "VACACIONES" },
            { fecha: "2026-12-28", motivo: "VACACIONES" }, { fecha: "2026-12-29", motivo: "VACACIONES" },
            { fecha: "2026-12-30", motivo: "VACACIONES" }
        ];
        
        // [FIX ARQUITECTO] Usar for...of en lugar de forEach(async) para garantizar escrituras ordenadas
        try {
            for (const h of holidays2026) {
                await db.collection('festivos').add({ fecha: h.fecha, motivo: h.motivo, createdAt: Date.now() });
            }
            localStorage.setItem('calendario2026_importado', 'true');
        } catch (e) {
            console.error("Error al importar festivos automáticamente:", e);
        }
        showToast("Calendario Laboral 2026 importado automáticamente", "success");
    }

    // Cargar Configuración Global
    if (typeof getGlobalConfig === 'function') {
        getGlobalConfig().then(cfg => {
            window.globalConfig = cfg;
        });
    }

    // (Easter Egg eliminado por seguridad - Bug #1 Auditoria QA)

    updateClock();
    setInterval(updateClock, 1000);
    
    // Escuchar el estado de red local
    updateDbStatus(navigator.onLine);
    window.addEventListener('online', () => {
        updateDbStatus(true);
        showToast("Conexión de red restablecida", "success");
    });
    window.addEventListener('offline', () => {
        updateDbStatus(false);
        showToast("Se ha perdido la conexión de red", "error");
    });

    // Vincular botones del modal de confirmación
    document.getElementById('modal-btn-cancel').addEventListener('click', () => closeConfirmModal(false));
    document.getElementById('modal-btn-confirm').addEventListener('click', () => closeConfirmModal(true));

    // Configurar modal de alta de operarios
    setupWorkerModal();
    
    // Configurar modal de festivos
    // setupHolidayModal(); // Eliminado temporalmente por truncamiento
    
    // Modales de ILUO movidos a configuración/polivalencia

    // Escuchar en tiempo real la colección de polivalencia (Matriz ILUO)
    window.skillMatrices = [];
    window.skillScores = {};

    db.collection("skill_matrices").onSnapshot(snap => {
        window.skillMatrices = [];
        snap.forEach(doc => window.skillMatrices.push(doc.data()));
        document.querySelectorAll('.cell-input[data-field="departamento"], .cell-input[data-field="linea"]').forEach(select => {
            const tr = select.closest('tr');
            if (tr) {
                const event = new Event('change');
                select.dispatchEvent(event);
            }
        });
    }, error => console.error("Error cargando skill_matrices: ", error));

    db.collection("skill_scores").onSnapshot(snap => {
        window.skillScores = {};
        snap.forEach(doc => {
            const data = doc.data();
            const wId = data.idTrabajador;
            if (!window.skillScores[wId]) window.skillScores[wId] = [];
            window.skillScores[wId].push(data);
        });
        document.querySelectorAll('#table-body tr').forEach(tr => {
            const id = tr.getAttribute('data-id');
            const record = trainingRecords.find(r => r.id === id);
            if (record) updateSkillIndicator(tr, record);
        });
    }, error => console.error("Error cargando skill_scores: ", error));


    // Escuchar en tiempo real la lista de operarios oficiales
    db.collection("operarios").orderBy("nombre").onSnapshot((snapshot) => {
        const datalist = document.getElementById('workers-list');
        if (datalist) {
            datalist.innerHTML = '';
            validWorkerIds = ['PAVONI'];
            
            // Inyectar PAVONI de forma genérica para el MVP
            const pavoniOpt = document.createElement('option');
            pavoniOpt.value = 'PAVONI';
            pavoniOpt.textContent = 'ESCUELA PAVONI (Genérico)';
            datalist.appendChild(pavoniOpt);
            snapshot.forEach(doc => {
                const opt = document.createElement('option');
                const data = doc.data();
                // Usar el ID como valor principal. No mostramos el nombre para mantener privacidad.
                const displayValue = data.idTrabajador ? data.idTrabajador : data.nombre;
                
                if (data.idTrabajador) validWorkerIds.push(data.idTrabajador.toUpperCase());
                
                opt.value = displayValue;
                opt.textContent = displayValue;
                datalist.appendChild(opt);
            });
        }
    }, (error) => {
        console.error("Error cargando lista de operarios: ", error);
    });

    // Escuchar cambios en la colección filtrando por la fecha del turno
    const q = db.collection("fichajes").where("fecha", "==", getShiftDate());
    
    let isInitialLoad = true;
    q.onSnapshot((snapshot) => {
        updateDbStatus(true); // Sincronizado correctamente
        
        if (isInitialLoad) {
            trainingRecords = [];
            snapshot.forEach(doc => {
                trainingRecords.push({ id: doc.id, ...doc.data() });
            });
            trainingRecords.sort((a, b) => a.createdAt - b.createdAt);
            document.getElementById('table-body').innerHTML = '';
            trainingRecords.forEach(record => appendRowToTable(record));
            // (isInitialLoad se actualiza más abajo ahora)
        } else {
            snapshot.docChanges().forEach((change) => {
                const data = { id: change.doc.id, ...change.doc.data() };
                
                if (change.type === "added") {
                    if (!trainingRecords.find(r => r.id === data.id)) {
                        trainingRecords.push(data);
                        appendRowToTable(data);
                    }
                }
                if (change.type === "modified") {
                    const index = trainingRecords.findIndex(r => r.id === data.id);
                    if (index !== -1) {
                        trainingRecords[index] = data;
                        updateRowInTable(data);
                    }
                }
                if (change.type === "removed") {
                    trainingRecords = trainingRecords.filter(r => r.id !== data.id);
                    removeRowFromTable(data.id);
                }
            });
        }
        
        if (isInitialLoad) {
            if (trainingRecords.length === 0) {
                addRow();
            }
            isInitialLoad = false; // Move isInitialLoad = false here
        }
        
        calculateTotal();
    }, (error) => {
        console.error("Error en Firestore onSnapshot: ", error);
        updateDbStatus(false);
        showToast("Error de sincronización con base de datos: " + error.message, "error");
    });

    document.getElementById('btn-add-row').addEventListener('click', addRow);
}

// Lógica para el Modal de Alta de Operario
function setupWorkerModal() {
    const btnAddWorker = document.getElementById('btn-add-worker');
    const modal = document.getElementById('worker-modal');
    const btnCancel = document.getElementById('worker-btn-cancel');
    const btnConfirm = document.getElementById('worker-btn-confirm');
    const nameInput = document.getElementById('new-worker-name');
    const idInput = document.getElementById('new-worker-id');

    if (!btnAddWorker || !modal || !btnCancel || !btnConfirm || !nameInput || !idInput) return;

    const seccionSelect = document.getElementById('new-worker-seccion');
    const lineaContainer = document.getElementById('linea-select-container');
    const lineaSelect = document.getElementById('new-worker-linea');
    
    if (seccionSelect && lineaContainer) {
        seccionSelect.addEventListener('change', (e) => {
            if (e.target.value === 'MONTAJE') {
                lineaContainer.style.display = 'block';
            } else {
                lineaContainer.style.display = 'none';
                if (lineaSelect) lineaSelect.value = 'PENDIENTE DE VALIDACIÓN';
            }
        });
    }

    btnAddWorker.addEventListener('click', () => {
        nameInput.value = '';
        idInput.value = '';
        
        const turnoEl = document.getElementById('new-worker-turno');
        const seccionEl = document.getElementById('new-worker-seccion');
        if (turnoEl) turnoEl.value = '';
        if (seccionEl) seccionEl.value = '';

        if (lineaContainer) lineaContainer.style.display = 'none';
        if (lineaSelect) lineaSelect.value = 'PENDIENTE DE VALIDACIÓN';

        modal.classList.add('show');
        setTimeout(() => nameInput.focus(), 150);
    });

    const closeModal = () => {
        modal.classList.remove('show');
    };

    btnCancel.addEventListener('click', closeModal);

    btnConfirm.addEventListener('click', async () => {
        const nombre = nameInput.value.trim().toUpperCase();
        const prefixSelect = document.getElementById('new-worker-prefix');
        const prefix = prefixSelect ? prefixSelect.value : "00";
        let rawId = idInput.value.trim().toUpperCase();
        
        let idTrabajador = rawId;
        if (/^\d{3}$/.test(rawId)) {
            idTrabajador = prefix + rawId;
        }
        
        if (nombre.length < 3) {
            showToast("Introduce el nombre y apellido completo del operario", "warning");
            return;
        }

        // [POKA-YOKE QA] Validación de ID: exactamente 5 dígitos numéricos y prefijo válido
        if (!/^\d{5}$/.test(idTrabajador)) {
            showToast("El ID debe tener exactamente 5 dígitos numéricos.", "warning");
            idInput.focus();
            return;
        }
        if (!idTrabajador.startsWith("00") && !idTrabajador.startsWith("04") && !idTrabajador.startsWith("06") && !idTrabajador.startsWith("08")) {
            showToast("El ID debe empezar por 00 (Empresa), 04/06 (ETT) o 08 (PAVONI).", "warning");
            return;
        }

        try {
            btnConfirm.disabled = true;
            btnConfirm.textContent = 'Registrando...';
            
            // Comprobar si ya existe el nombre
            const existsNameQuery = await db.collection('operarios').where('nombre', '==', nombre).get();
            if (!existsNameQuery.empty) {
                showToast("Ya existe un operario con ese nombre", "warning");
                btnConfirm.disabled = false;
                btnConfirm.textContent = 'Registrar';
                return;
            }

            const existsIdQuery = await db.collection('operarios').where('idTrabajador', '==', idTrabajador).get();
            if (!existsIdQuery.empty) {
                showToast("Ya existe un operario con ese ID", "warning");
                btnConfirm.disabled = false;
                btnConfirm.textContent = 'Registrar';
                return;
            }

            const turnoBase = document.getElementById('new-worker-turno').value;
            const seccionBase = document.getElementById('new-worker-seccion').value;
            const calendarioBase = 'Lunes a Viernes';

            if (!turnoBase || !seccionBase) {
                showToast("Por favor, selecciona el Turno y la Sección Base.", "warning");
                btnConfirm.disabled = false;
                btnConfirm.textContent = 'Registrar';
                return;
            }

            // Regla de Negocio: Montaje -> Línea
            let lineaReferente = "N/A";
            if (seccionBase === "MONTAJE") {
                const lineaSelect = document.getElementById('new-worker-linea');
                lineaReferente = lineaSelect ? lineaSelect.value : "PENDIENTE DE VALIDACIÓN";
            }

            await db.collection('operarios').add({
                nombre: nombre,
                idTrabajador: idTrabajador,
                turnoBase: turnoBase,
                seccionBase: seccionBase,
                calendarioBase: calendarioBase,
                lineaReferente: lineaReferente,
                createdAt: Date.now()
            });

            showToast(`Operario ${nombre} registrado con éxito`, "success");
            closeModal();
        } catch (e) {
            console.error("Error al registrar operario: ", e);
            showToast("Error al guardar en base de datos: " + e.message, "error");
        } finally {
            btnConfirm.disabled = false;
            btnConfirm.textContent = 'Registrar';
        }
    });

    // Enter en input para confirmar
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btnConfirm.click();
        }
    });
}

// Ejecutar initApp una vez listo el DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function addRow() {
    const today = getShiftDate();
    const currentShift = getShiftName();
    
    const newDocRef = db.collection('fichajes').doc();
    
    const newRecord = {
        id: newDocRef.id,
        trabajador: '',
        turno: currentShift,
        of: '',
        departamento: '',
        maquina: '',
        linea: window.lockedLinea || '',
        fecha: today,
        tiempo: 0,
        createdAt: Date.now()
    };
    
    try {
        await newDocRef.set(newRecord);
        showToast("Fila añadida", "success");
    } catch (e) {
        console.error("Error añadiendo registro: ", e);
        showToast("Error al añadir fila: " + e.message, "error");
    }
}

async function removeRow(id) {
    const confirmed = await showConfirmModal();
    if (confirmed) {
        try {
            await db.collection('fichajes').doc(id).delete();
            showToast("Registro eliminado", "info");
        } catch (e) {
            console.error("Error eliminando registro: ", e);
            showToast("Error al eliminar registro: " + e.message, "error");
        }
    }
}

async function updateRecordToFirebase(id, field, value) {
    let parsedValue = value;
    if (field === 'tiempo') {
        parsedValue = Math.max(0, parseFloat(value)) || 0;
        
        // POKA-YOKE: Máximo de horas por turno según config
        const maxHoras = (window.globalConfig && window.globalConfig.maxHorasFichaje) ? window.globalConfig.maxHorasFichaje : 10;
        
        if (parsedValue > maxHoras) {
            showToast(`⚠️ Poka-Yoke: Máximo ${maxHoras} horas permitidas por turno.`, "error");
            parsedValue = maxHoras;
            // Actualizar visualmente el input si es posible (en el siguiente refresco se arreglará, pero forzamos por si acaso)
            const row = document.querySelector(`tr[data-id="${id}"]`);
            if(row) {
                const input = row.querySelector('.calc-time');
                if(input) input.value = maxHoras;
            }
        }
    } else if (field === 'trabajador') {
        parsedValue = value.trim().toUpperCase();
        // POKA-YOKE desactivado temporalmente para el MVP (ID manual o select)
        /*
        if (parsedValue !== "" && validWorkerIds.length > 0 && !validWorkerIds.includes(parsedValue)) {
            showToast("⚠️ Poka-Yoke: ID Trabajador no existe en la BD.", "error");
            parsedValue = "";
            const row = document.querySelector(`tr[data-id="${id}"]`);
            if(row) {
                const input = row.querySelector('[data-field="trabajador"]');
                if(input) input.value = "";
            }
        }
        */
    } else if (field === 'of') {
        // [POKA-YOKE Industria 4.0] Normalizar OF: mayúsculas, sin espacios, sin caracteres extraños
        parsedValue = value.trim().toUpperCase().replace(/\s+/g, '');
    }
    
    try {
        await db.collection('fichajes').doc(id).update({
            [field]: parsedValue
        });
        // [UX Industria 4.0] Indicador visual: la fila parpadea en verde al guardar
        const row = document.querySelector(`tr[data-id="${id}"]`);
        if (row) {
            row.classList.add('row-saved');
            setTimeout(() => row.classList.remove('row-saved'), 1500);
        }
    } catch (e) {
        console.error("Error actualizando registro: ", e);
        showToast("Error al guardar cambio: " + e.message, "error");
    }
}

// Evaluar e indicar visualmente la validez de los campos obligatorios
function validateCell(input) {
    const field = input.getAttribute('data-field');
    if (field === 'trabajador' || field === 'of' || field === 'linea' || field === 'departamento' || field === 'maquina') {
        const val = (input.value || '').trim();
        if (val === '') {
            input.classList.add('invalid-cell');
            input.classList.remove('valid-cell');
        } else {
            input.classList.add('valid-cell');
            input.classList.remove('invalid-cell');
        }
    }
}

// Función pura para obtener máquinas disponibles según la matriz
function getAvailableMachines(linea, departamento) {
    if (!departamento || !window.skillMatrices) return [];
    
    // Normalizar para evitar problemas de mayúsculas o acentos
    const normalize = (str) => String(str).trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    const recDepto = normalize(departamento);
    
    if (linea) {
        const recLinea = normalize(linea);
        const matchMatrix = window.skillMatrices.find(m => 
            normalize(m.linea) === recLinea && 
            normalize(m.seccion) === recDepto
        );
        if (matchMatrix && matchMatrix.tareas && matchMatrix.tareas.length > 0) {
            return matchMatrix.tareas;
        }
    }
    
    // Fallback: Si no ha elegido línea aún, o si la línea elegida no tiene matriz propia importada,
    // agrupar todas las tareas de ese departamento de cualquier matriz que sí esté subida.
    const matchingMatrices = window.skillMatrices.filter(m => normalize(m.seccion) === recDepto);
    const allTasks = new Set();
    matchingMatrices.forEach(m => {
        if (m.tareas) m.tareas.forEach(t => allTasks.add(t));
    });
    return Array.from(allTasks).sort();
}

function appendRowToTable(record) {
    const tbody = document.getElementById('table-body');
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', record.id);
    
    const availableTasks = getAvailableMachines(record.linea, record.departamento);
    
    tr.innerHTML = `
        <td class="td-input">
            <select class="cell-input" data-field="trabajador">
                <option value="">SELECCIONE...</option>
                <option value="EMPRESA" ${record.trabajador === 'EMPRESA' ? 'selected' : ''}>EMPRESA</option>
                <option value="ETT - AURA" ${record.trabajador === 'ETT - AURA' ? 'selected' : ''}>ETT - AURA</option>
                <option value="ETT - EUROFIRM" ${record.trabajador === 'ETT - EUROFIRM' ? 'selected' : ''}>ETT - EUROFIRM</option>
                ${(record.trabajador && !['EMPRESA', 'ETT - AURA', 'ETT - EUROFIRM'].includes(record.trabajador)) ? `<option value="${record.trabajador}" selected>${record.trabajador}</option>` : ''}
            </select>
        </td>
        <td class="td-input"><input type="text" class="cell-input" data-field="of" value="${record.of || ''}" placeholder="Nº OF..."></td>
        <td class="td-input">
            <select class="cell-input" data-field="departamento">
                ${departamentos.map(d => `<option value="${d}" ${record.departamento === d ? 'selected' : (d==='' && !record.departamento ? 'selected' : '')}>${d || 'SELECCIONE...'}</option>`).join('')}
            </select>
        </td>
        <td class="td-input">
            <select class="cell-input" data-field="maquina">
                <option value="">SELECCIONE...</option>
                ${availableTasks.map(t => `<option value="${t}" ${record.maquina === t ? 'selected' : ''}>${t}</option>`).join('')}
                ${(record.maquina && !availableTasks.includes(record.maquina)) ? `<option value="${record.maquina}" selected>${record.maquina}</option>` : ''}
            </select>
        </td>
        <td class="td-input">
            <select class="cell-input" data-field="linea" ${window.lockedLinea ? 'disabled style="background-color: rgba(0,0,0,0.05); cursor: not-allowed; border-style: dashed;"' : ''}>
                ${lines.map(l => `<option value="${l}" ${record.linea === l ? 'selected' : (l==='' && !record.linea ? 'selected' : '')}>${l || 'SELECCIONE...'}</option>`).join('')}
            </select>
        </td>
        <td class="td-input"><input type="date" class="cell-input" data-field="fecha" value="${record.fecha || ''}" disabled title="Fecha automática calculada por el sistema"></td>
        <td class="td-input"><input type="number" step="0.5" min="0" class="cell-input calc-time" data-field="tiempo" value="${record.tiempo || ''}" placeholder="0.0"></td>
        <td class="td-input" style="text-align: center; vertical-align: middle;">
            <div class="skill-indicator skill-unknown" data-worker-id="${record.trabajador || ''}" data-machine-id="${record.maquina || ''}">-</div>
        </td>
        <td class="td-actions">
            <button class="btn-delete" title="Eliminar fila">
                <i class="ph ph-trash"></i>
            </button>
        </td>
    `;
    
    tbody.appendChild(tr);
    attachEventListenersToRow(tr, record.id);
}

function updateRowInTable(record) {
    const tr = document.querySelector(`tr[data-id="${record.id}"]`);
    if (!tr) return;
    
    const inputs = tr.querySelectorAll('.cell-input');
    inputs.forEach(input => {
        // POKA-YOKE UX: No sobrescribir el valor si el elemento tiene el foco
        if (document.activeElement !== input) {
            const field = input.getAttribute('data-field');
            if (input.value != record[field] && record[field] !== undefined) {
                input.value = record[field];
            }
            validateCell(input);
        }
    });
    
    // Sincronizar también el indicador visual ILUO
    updateSkillIndicator(tr, record);
}

function removeRowFromTable(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (tr) {
        tr.classList.add('row-fade-out');
        setTimeout(() => {
            tr.remove();
        }, 300);
    }
}

function updateSkillIndicator(tr, record) {
    try {
        const indicator = tr.querySelector('.skill-indicator');
        if (!indicator) return;
        
        if (!record || !record.trabajador || !record.linea || !record.departamento) {
            indicator.className = 'status-indicator status-incomplete';
            indicator.title = 'Falta ID, Línea o Sección';
            return;
        }

        const workerData = window.skillScores[record.trabajador.toUpperCase()];
        let nivel = null;
        if (workerData) {
            const match = workerData.find(d => 
                d.linea === record.linea && 
                d.seccion.toUpperCase() === record.departamento.toUpperCase()
            );
            if (match && match.scores && match.scores[record.maquina] !== undefined) {
                nivel = match.scores[record.maquina];
            }
        }
        
        if (nivel !== null && nivel > 0) {
            indicator.className = `skill-indicator skill-lvl-${nivel}`;
            indicator.textContent = nivel;
            indicator.title = `Nivel ILUO: ${nivel}`;
        } else {
            indicator.className = 'skill-indicator skill-unknown';
            indicator.textContent = '?';
            indicator.title = 'No hay datos en la matriz para este operario en esta máquina';
        }
    } catch (e) {
        console.error("Error en updateSkillIndicator", e);
    }
}

function attachEventListenersToRow(tr, id) {
    const record = trainingRecords.find(r => r.id === id);
    if (record) updateSkillIndicator(tr, record);

    tr.querySelectorAll('.cell-input').forEach(input => {
        validateCell(input);

        // Al editar cualquier campo
        if (input.type === 'number' || input.type === 'text' || input.type === 'date') {
            input.addEventListener('input', (e) => {
                const field = e.target.getAttribute('data-field');
                const record = trainingRecords.find(r => r.id === id);
                if (record) {
                    record[field] = field === 'tiempo' ? (parseFloat(e.target.value) || 0) : e.target.value;
                    if (field === 'tiempo') calculateTotal();
                }
                validateCell(e.target);
            });
        }
        
        // Atajo teclado: Enter en campo de tiempo
        if (input.type === 'number') {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const record = trainingRecords.find(r => r.id === id);
                    if (record && (record.trabajador||'').trim() !== '' && (record.of||'').trim() !== '' && record.tiempo > 0 && (record.linea||'') !== '' && (record.departamento||'') !== '') {
                        addRow();
                    } else {
                        showToast("Faltan campos obligatorios (Operario, OF, Línea, Departamento, Horas)", "warning");
                    }
                }
            });
        }

        // Al cambiar valor o perder el foco
        input.addEventListener('change', (e) => {
            const field = e.target.getAttribute('data-field');
            let val = e.target.value;
            
            if (field === 'trabajador') {
                val = val.trim().toUpperCase();
                if (/^\d{3}$/.test(val)) {
                    val = "00" + val;
                }
                e.target.value = val;
            } else if (field === 'of') {
                val = val.trim();
                e.target.value = val;
            } else if (field === 'tiempo') {
                let num = Math.max(0, parseFloat(val)) || 0;
                val = num;
                e.target.value = val === 0 ? '' : val;
            }
            
            updateRecordToFirebase(id, field, val);
            validateCell(e.target);
            
            const record = trainingRecords.find(r => r.id === id);
            if (record) {
                record[field] = val; // Actualizar memoria local rápido
                
                // Si cambia departamento o línea, actualizar lista de máquinas
                if (field === 'departamento' || field === 'linea') {
                    const maquinaSelect = tr.querySelector('select[data-field="maquina"]');
                    if (maquinaSelect && window.skillMatrices) {
                        const availableTasks = getAvailableMachines(record.linea, record.departamento);
                        const currentValue = record.maquina;
                        
                        maquinaSelect.innerHTML = `<option value="">SELECCIONE...</option>` + 
                            availableTasks.map(t => `<option value="${t}">${t}</option>`).join('');
                        
                        if (availableTasks.includes(currentValue)) {
                            maquinaSelect.value = currentValue;
                        } else {
                            maquinaSelect.value = '';
                            record.maquina = '';
                            updateRecordToFirebase(id, 'maquina', '');
                        }
                    }
                }
                
                // Si cambia operario o máquina, recalcular indicador ILUO
                if (field === 'trabajador' || field === 'maquina' || field === 'departamento' || field === 'linea') {
                    updateSkillIndicator(tr, record);
                }
            }
        });
    });
    
    // Enfocar el input de trabajador en las filas nuevas
    const firstInput = tr.querySelector('input[data-field="trabajador"]');
    if (firstInput && trainingRecords.length > 1) {
        firstInput.focus();
    }
    
    tr.querySelector('.btn-delete').addEventListener('click', () => {
        removeRow(id);
    });
}

function calculateTotal() {
    const total = trainingRecords.reduce((sum, r) => sum + (parseFloat(r.tiempo) || 0), 0);
    const totalElement = document.getElementById('total-horas-formacion');
    if (totalElement) {
        totalElement.textContent = total.toFixed(2);
    }

} 
// FIN app.js
