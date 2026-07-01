// Firebase y funciones compartidas (updateClock, updateDbStatus) ahora están en shared.js

let trainingRecords = [];
let validWorkerIds = []; // Poka-yoke para validar IDs

const lines = ['', 'L1', 'L2', 'L3', 'L4', 'L5', 'BOX 1'];
const departamentos = ['', 'Montaje Mecánico', 'Montaje Eléctrico', 'Baterías', 'Transformación Metálica', 'Perfilería y Soldadura', 'Logística'];
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
        for (const h of holidays2026) {
            await db.collection('festivos').add({ fecha: h.fecha, motivo: h.motivo, createdAt: Date.now() });
        }
        localStorage.setItem('calendario2026_importado', 'true');
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
    setupHolidayModal();
    
    // Configurar modal ILUO
    setupIluoModal();
    
    // Configurar Visor de Matriz ILUO
    setupIluoViewer();

    // Escuchar en tiempo real la colección de polivalencia (Matriz ILUO)
    db.collection("polivalencia").onSnapshot((snapshot) => {
        window.iluoData = [];
        snapshot.forEach(doc => window.iluoData.push(doc.data()));
        // Actualizar selectores de máquinas si ya están renderizados
        document.querySelectorAll('.cell-input[data-field="departamento"]').forEach(select => {
            const tr = select.closest('tr');
            if (tr) {
                const event = new Event('change');
                select.dispatchEvent(event);
            }
        });
    }, (error) => {
        console.error("Error cargando matriz ILUO: ", error);
    });

    // Escuchar en tiempo real la lista de operarios oficiales
    db.collection("operarios").orderBy("nombre").onSnapshot((snapshot) => {
        const datalist = document.getElementById('workers-list');
        if (datalist) {
            datalist.innerHTML = '';
            validWorkerIds = [];
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
        let idTrabajador = idInput.value.trim().toUpperCase();
        
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
        if (!idTrabajador.startsWith("00") && !idTrabajador.startsWith("04") && !idTrabajador.startsWith("06")) {
            showToast("El ID debe empezar por 00 (Empresa), o por 04/06 (ETT).", "warning");
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
        linea: '',
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
        // POKA-YOKE: Validar que el trabajador existe
        if (parsedValue !== "" && validWorkerIds.length > 0 && !validWorkerIds.includes(parsedValue)) {
            showToast("⚠️ Poka-Yoke: ID Trabajador no existe en la BD.", "error");
            parsedValue = "";
            const row = document.querySelector(`tr[data-id="${id}"]`);
            if(row) {
                const input = row.querySelector('input[data-field="trabajador"]');
                if(input) input.value = "";
            }
        }
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

function appendRowToTable(record) {
    const tbody = document.getElementById('table-body');
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', record.id);
    
    tr.innerHTML = `
        <td class="td-input"><input type="text" class="cell-input" data-field="trabajador" list="workers-list" value="${record.trabajador || ''}" placeholder="ID Trabajador..."></td>
        <td class="td-input"><input type="text" class="cell-input" data-field="of" value="${record.of || ''}" placeholder="Nº OF..."></td>
        <td class="td-input">
            <select class="cell-input" data-field="departamento">
                ${departamentos.map(d => `<option value="${d}" ${record.departamento === d ? 'selected' : (d==='' && !record.departamento ? 'selected' : '')}>${d || 'SELECCIONE...'}</option>`).join('')}
            </select>
        </td>
        <td class="td-input">
            <select class="cell-input" data-field="maquina">
                <!-- Se rellena dinámicamente -->
                <option value="${record.maquina || ''}">${record.maquina || 'SELECCIONE DEPTO...'}</option>
            </select>
        </td>
        <td class="td-input">
            <select class="cell-input" data-field="linea">
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
        if (document.activeElement !== input) {
            const field = input.getAttribute('data-field');
            if (input.value != record[field] && record[field] !== undefined) {
                input.value = record[field];
            }
            validateCell(input);
        }
    });
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
        
        if (!record || !record.trabajador || !record.maquina || !window.iluoData) {
            indicator.className = 'skill-indicator skill-unknown';
            indicator.textContent = '-';
            indicator.title = 'Falta ID o Máquina';
            return;
        }
        
        // Buscar en caché global ILUO (usando String para prevenir crash con números)
        const match = window.iluoData.find(d => 
            d.trabajador != null && 
            String(d.trabajador).trim().toUpperCase() === String(record.trabajador).trim().toUpperCase() && 
            d.maquina === record.maquina
        );
        
        if (match) {
            indicator.className = `skill-indicator skill-lvl-${match.nivel}`;
            indicator.textContent = match.nivel;
            indicator.title = `Nivel ILUO: ${match.nivel}`;
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
                    if (record && (record.trabajador||'').trim() !== '' && (record.of||'').trim() !== '' && record.tiempo > 0 && (record.linea||'') !== '' && (record.departamento||'') !== '' && (record.maquina||'') !== '') {
                        addRow();
                    } else {
                        showToast("Faltan campos obligatorios (Operario, OF, Línea, Departamento, Máquina, Horas)", "warning");
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
                
                // Si cambia departamento, actualizar lista de máquinas
                if (field === 'departamento') {
                    const maquinaSelect = tr.querySelector('select[data-field="maquina"]');
                    if (maquinaSelect && window.iluoData) {
                        const deptoMachines = [...new Set(window.iluoData
                            .filter(d => d.departamento === val)
                            .map(d => d.maquina))].sort();
                        
                        const currentValue = record.maquina;
                        maquinaSelect.innerHTML = `<option value="">SELECCIONE...</option>` + 
                            deptoMachines.map(m => `<option value="${m}">${m}</option>`).join('');
                        
                        if (deptoMachines.includes(currentValue)) {
                            maquinaSelect.value = currentValue;
                        } else {
                            // Resetear maquina si no pertenece al nuevo departamento
                            maquinaSelect.value = '';
                            record.maquina = '';
                            updateRecordToFirebase(id, 'maquina', '');
                        }
                    }
                }
                
                // Si cambia operario o máquina, recalcular indicador ILUO
                if (field === 'trabajador' || field === 'maquina' || field === 'departamento') {
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

    // Lógica de KPI Cards eliminada por redundancia en interfaz
}

// Lógica para el Modal de Festivos (Calendario Laboral)
function setupHolidayModal() {
    const btnManage = document.getElementById('btn-manage-holidays');
    const modal = document.getElementById('holiday-modal');
    const btnClose = document.getElementById('holiday-btn-close');
    const btnSave = document.getElementById('btn-save-holiday');
    const inputDate = document.getElementById('new-holiday-date');
    const inputName = document.getElementById('new-holiday-name');
    const tbody = document.getElementById('holidays-table-body');
    let unsubscribeHolidays = null;

    if (!btnManage || !modal) return;

    const renderHolidays = (snapshot) => {
        if (!tbody) return;
        tbody.innerHTML = '';
        
        const holidays = [];
        snapshot.forEach(doc => {
            holidays.push({ id: doc.id, ...doc.data() });
        });
        
        holidays.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
        
        if (holidays.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 1rem;">No hay festivos configurados</td></tr>`;
            return;
        }
        
        holidays.forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-family: monospace;">${h.fecha}</td>
                <td>${h.motivo}</td>
                <td style="text-align: center;">
                    <button class="btn-delete" onclick="deleteHoliday('${h.id}')" title="Eliminar festivo">
                        <i class="ph ph-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    btnManage.addEventListener('click', () => {
        modal.classList.add('show');
        inputDate.value = '';
        inputName.value = '';
        
        if (!unsubscribeHolidays) {
            unsubscribeHolidays = db.collection('festivos').onSnapshot(renderHolidays, error => {
                console.error("Error cargando festivos: ", error);
                showToast("Error al cargar festivos", "error");
            });
        }
    });

    btnClose.addEventListener('click', () => {
        modal.classList.remove('show');
        if (unsubscribeHolidays) {
            unsubscribeHolidays();
            unsubscribeHolidays = null;
        }
    });

    btnSave.addEventListener('click', async () => {
        const fecha = inputDate.value;
        const motivo = inputName.value.trim().toUpperCase();
        
        if (!fecha || !motivo) {
            showToast("Introduce una fecha y un motivo válido", "warning");
            return;
        }
        
        try {
            btnSave.disabled = true;
            await db.collection('festivos').add({
                fecha: fecha,
                motivo: motivo,
                createdAt: Date.now()
            });
            inputDate.value = '';
            inputName.value = '';
            showToast("Día festivo añadido", "success");
        } catch(e) {
            console.error(e);
            showToast("Error al guardar festivo", "error");
        } finally {
            btnSave.disabled = false;
        }
    });
}

// [FIX BUG-03] Reemplazado confirm() nativo por el modal corporativo showConfirmModal()
window.deleteHoliday = async function(id) {
    const confirmed = await showConfirmModal();
    if (confirmed) {
        try {
            await db.collection('festivos').doc(id).delete();
            showToast("Festivo eliminado", "info");
        } catch(e) {
            console.error(e);
            showToast("Error al eliminar festivo", "error");
        }
    }
}

// Lógica para el Modal de Importación ILUO
function setupIluoModal() {
    const btnImport = document.getElementById('btn-import-matrix');
    const modal = document.getElementById('iluo-modal');
    const btnClose = document.getElementById('iluo-btn-close');
    const btnConfirmImport = document.getElementById('iluo-btn-import');
    
    if (!btnImport || !modal) return;
    
    btnImport.addEventListener('click', () => {
        modal.classList.add('show');
    });
    
    btnClose.addEventListener('click', () => {
        modal.classList.remove('show');
        document.getElementById('iluo-csv-file').value = '';
    });
    
    btnConfirmImport.addEventListener('click', async () => {
        const fileInput = document.getElementById('iluo-csv-file');
        const deptSelect = document.getElementById('iluo-dept-select');
        
        if (!fileInput.files || fileInput.files.length === 0) {
            showToast("Selecciona un archivo Excel (.xlsx o .xls) primero", "warning");
            return;
        }
        
        const file = fileInput.files[0];
        const departamento = deptSelect.value;
        const reader = new FileReader();
        
        btnConfirmImport.disabled = true;
        btnConfirmImport.textContent = "Procesando...";
        
        reader.onload = async (e) => {
            try {
                if (typeof XLSX === 'undefined') {
                    throw new Error("Librería SheetJS no cargada. Puede que el cortafuegos corporativo esté bloqueando el CDN.");
                }
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Usar la primera hoja
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convertir a matriz 2D (Array de Arrays)
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
                
                if (jsonData.length < 2) {
                    showToast("El archivo no tiene el formato correcto o está vacío", "error");
                    btnConfirmImport.disabled = false;
                    btnConfirmImport.textContent = "Importar Datos";
                    return;
                }
                
                // Encontrar la fila ancla ("Habilidades")
                let anchorRowIndex = -1;
                for (let i = 0; i < jsonData.length; i++) {
                    const firstCell = String(jsonData[i][0]).trim().toLowerCase();
                    if (firstCell.includes("habilidad")) {
                        anchorRowIndex = i;
                        break;
                    }
                }
                
                if (anchorRowIndex === -1) {
                    showToast("No se encontró la celda 'Habilidades' en la primera columna.", "error");
                    btnConfirmImport.disabled = false;
                    btnConfirmImport.textContent = "Importar Datos";
                    return;
                }
                
                // Determinar qué fila tiene los nombres de los operarios (probamos H y H+1)
                const rowH = jsonData[anchorRowIndex].map(c => String(c).trim());
                const rowH1 = (anchorRowIndex + 1 < jsonData.length) ? jsonData[anchorRowIndex + 1].map(c => String(c).trim()) : [];
                
                let operariosRow = rowH;
                let machinesStartIndex = anchorRowIndex + 1;
                
                // Contar cuántas celdas no vacías hay a partir de la columna 1
                const countNonEmpty = (row) => row.slice(1).filter(c => c !== '').length;
                
                if (countNonEmpty(rowH1) > countNonEmpty(rowH)) {
                    operariosRow = rowH1;
                    machinesStartIndex = anchorRowIndex + 2; // Las máquinas empiezan debajo de los operarios
                }
                
                const operarios = operariosRow.slice(1);
                
                let count = 0;
                // Procesar las filas de máquinas
                for (let i = machinesStartIndex; i < jsonData.length; i++) {
                    const row = jsonData[i].map(c => String(c).trim());
                    if (row.length === 0) continue;
                    
                    const maquina = row[0];
                    if (maquina === '') continue; // Ignorar filas vacías
                    
                    // Condición de parada (fin de la tabla ILUO)
                    if (maquina.toLowerCase().includes("grado de formación") || maquina.toLowerCase().includes("total")) {
                        break;
                    }
                    
                    for (let j = 1; j < row.length; j++) {
                        const operarioId = operarios[j-1];
                        const nivelRaw = row[j];
                        const nivel = parseInt(nivelRaw, 10);
                        
                        // Solo procesar si el operario no está vacío y el nivel es un número válido (1 al 4)
                        if (operarioId && operarioId !== '' && !isNaN(nivel) && nivel >= 1 && nivel <= 4) {
                            // Sanitizar docId para Firebase (sin barras ni espacios)
                            const sanitize = (str) => String(str).replace(/[\\s/\\\\.]+/g, '_');
                            const docId = `${sanitize(departamento)}_${sanitize(maquina)}_${sanitize(operarioId)}`;
                            
                            await db.collection('polivalencia').doc(docId).set({
                                departamento: departamento,
                                maquina: maquina,
                                trabajador: operarioId,
                                nivel: nivel,
                                updatedAt: Date.now()
                            });
                            count++;
                        }
                    }
                }
                
                showToast(`¡Matriz importada con éxito! ${count} registros guardados.`, "success");
                modal.classList.remove('show');
                fileInput.value = '';
            } catch (error) {
                console.error("Error procesando Excel: ", error);
                showToast("Error importando: " + error.message, "error");
            } finally {
                btnConfirmImport.disabled = false;
                btnConfirmImport.textContent = "Importar Datos";
            }
        };
        
        reader.onerror = () => {
            showToast("Error al leer el archivo", "error");
            btnConfirmImport.disabled = false;
            btnConfirmImport.textContent = "Importar Datos";
        };
        
        reader.readAsArrayBuffer(file);
    });
}

// Lógica para el Visor Global Matriz ILUO
function setupIluoViewer() {
    const btnView = document.getElementById('btn-view-matrix');
    const modal = document.getElementById('iluo-viewer-modal');
    const btnClose = document.getElementById('iluo-viewer-btn-close');
    const deptSelect = document.getElementById('iluo-viewer-dept');
    const thead = document.getElementById('iluo-viewer-thead');
    const tbody = document.getElementById('iluo-viewer-tbody');
    
    if (!btnView || !modal) return;
    
    btnView.addEventListener('click', () => {
        modal.classList.add('show');
        if (deptSelect.value) {
            renderIluoTable(deptSelect.value);
        }
    });
    
    btnClose.addEventListener('click', () => {
        modal.classList.remove('show');
    });
    
    deptSelect.addEventListener('change', (e) => {
        renderIluoTable(e.target.value);
    });
    
    function renderIluoTable(departamento) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        
        if (!departamento || !window.iluoData || window.iluoData.length === 0) return;
        
        // Filtrar datos por departamento
        const deptData = window.iluoData.filter(d => d.departamento === departamento);
        if (deptData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="100%" style="text-align: center; padding: 2rem;">No hay datos para este departamento</td></tr>';
            return;
        }
        
        // Extraer operarios (columnas) y máquinas (filas) únicos
        const operarios = [...new Set(deptData.map(d => d.trabajador))].sort();
        const maquinas = [...new Set(deptData.map(d => d.maquina))].sort();
        
        // Generar Cabecera (Thead)
        const trHead = document.createElement('tr');
        trHead.innerHTML = `<th style="background: var(--surface-hover); color: var(--text-primary); text-align: left; min-width: 200px; position: sticky; left: 0; z-index: 2;">MÁQUINA / PUESTO</th>`;
        operarios.forEach(op => {
            trHead.innerHTML += `<th style="text-align: center; width: 80px;">${op}</th>`;
        });
        thead.appendChild(trHead);
        
        // Generar Cuerpo (Tbody)
        maquinas.forEach(maquina => {
            const tr = document.createElement('tr');
            
            // Columna sticky para la máquina
            let html = `<td style="font-weight: bold; position: sticky; left: 0; background: var(--bg-primary); z-index: 1;">${maquina}</td>`;
            
            operarios.forEach(op => {
                // Buscar nivel para esta intersección
                const match = deptData.find(d => d.maquina === maquina && d.trabajador === op);
                if (match) {
                    html += `<td style="text-align: center;">
                        <div class="skill-indicator skill-lvl-${match.nivel}" style="margin: 0 auto;">${match.nivel}</div>
                    </td>`;
                } else {
                    html += `<td style="text-align: center;">
                        <div class="skill-indicator skill-unknown" style="margin: 0 auto; opacity: 0.3;">-</div>
                    </td>`;
                }
            });
            
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    }
}
