// Firebase y funciones compartidas (updateClock, updateDbStatus) ahora están en shared.js

let trainingRecords = [];
let validWorkerIds = []; // Poka-yoke para validar IDs

const lines = ['L1', 'L2', 'L3', 'L4', 'L5', 'BOX 1'];
const operations = ['MONTAJE MECÁNICO', 'MONTAJE ELÉCTRICO', 'MONTAJE HIDRÁULICO', 'REFRIGERACIÓN', 'TEST FINAL'];
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

// Notificaciones Toast Corporativas
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'ph-check-circle';
    if (type === 'info') iconClass = 'ph-info';
    else if (type === 'warning') iconClass = 'ph-warning-circle';
    else if (type === 'error') iconClass = 'ph-x-circle';
    
    toast.innerHTML = `
        <i class="ph ${iconClass} toast-icon"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// (updateDbStatus movido a shared.js)

// Modal personalizado de eliminación de registros
let modalResolveCallback = null;

function showConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return Promise.resolve(false);
    
    modal.classList.add('show');
    
    return new Promise((resolve) => {
        modalResolveCallback = resolve;
    });
}

function closeConfirmModal(result) {
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        modal.classList.remove('show');
    }
    if (modalResolveCallback) {
        modalResolveCallback(result);
        modalResolveCallback = null;
    }
}

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
        operacion: 'MONTAJE MECÁNICO',
        linea: 'L1',
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
    if (field === 'trabajador' || field === 'of') {
        const val = input.value.trim();
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
        <td class="td-input">
            <select class="cell-input" data-field="turno" title="Turno (cambio manual permitido)">
                ${shifts.map(s => `<option value="${s}" ${record.turno === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </td>
        <td class="td-input"><input type="text" class="cell-input" data-field="of" value="${record.of || ''}" placeholder="Nº OF..."></td>
        <td class="td-input">
            <select class="cell-input" data-field="operacion">
                ${operations.map(o => `<option value="${o}" ${record.operacion === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
        </td>
        <td class="td-input">
            <select class="cell-input" data-field="linea">
                ${lines.map(l => `<option value="${l}" ${record.linea === l ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
        </td>
        <td class="td-input"><input type="date" class="cell-input" data-field="fecha" value="${record.fecha || ''}" disabled title="Fecha automática calculada por el sistema"></td>
        <td class="td-input"><input type="number" step="0.5" min="0" class="cell-input calc-time" data-field="tiempo" value="${record.tiempo || ''}" placeholder="0.0"></td>
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

function attachEventListenersToRow(tr, id) {
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
                    if (record && record.trabajador.trim() !== '' && record.of.trim() !== '' && record.tiempo > 0) {
                        addRow();
                    } else {
                        showToast("Rellena el operario, OF y horas antes de crear otra fila", "warning");
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

    // Actualizar KPI Cards en tiempo real
    const kpiHoras = document.getElementById('kpi-total-horas');
    if (kpiHoras) {
        kpiHoras.textContent = total.toFixed(1);
    }

    const kpiRegistros = document.getElementById('kpi-total-registros');
    if (kpiRegistros) {
        // Contamos filas reales que tengan tiempo > 0 o algún dato (o simplemente total de filas)
        kpiRegistros.textContent = trainingRecords.length;
    }

    const kpiOperarios = document.getElementById('kpi-total-operarios');
    if (kpiOperarios) {
        // Filtrar operarios únicos que tengan introducido un ID de trabajador válido
        const uniqueWorkers = new Set(trainingRecords.map(r => r.trabajador).filter(id => id && id.trim() !== ''));
        kpiOperarios.textContent = uniqueWorkers.size;
    }
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

window.deleteHoliday = async function(id) {
    if(confirm("¿Seguro que quieres eliminar este festivo?")) {
        try {
            await db.collection('festivos').doc(id).delete();
            showToast("Festivo eliminado", "info");
        } catch(e) {
            console.error(e);
            showToast("Error al eliminar", "error");
        }
    }
}
