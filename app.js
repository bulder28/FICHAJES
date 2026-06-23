// Tu configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCyDAOSXzvQkBiOiCpLdqqwPxqphhR7e94",
  authDomain: "fichajes-formaci.firebaseapp.com",
  projectId: "fichajes-formaci",
  storageBucket: "fichajes-formaci.firebasestorage.app",
  messagingSenderId: "799065210074",
  appId: "1:799065210074:web:a5a08917a983364fdfb9e3"
};

// Inicializar Firebase usando la API Compat
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let trainingRecords = [];

const lines = ['L1', 'L2', 'L3', 'L4', 'L5', 'BOX 1'];
const operations = ['MONTAJE MECÁNICO', 'MONTAJE ELÉCTRICO', 'MONTAJE HIDRÁULICO', 'REFRIGERACIÓN', 'TEST FINAL'];
const shifts = ['Mañana', 'Tarde'];

// Calcular la fecha laboral del turno (con 2 horas de retraso)
function getShiftDate() {
    const now = new Date();
    now.setHours(now.getHours() - 2);
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

// Actualización en tiempo real del reloj
function updateClock() {
    const clockElement = document.getElementById('clock-time');
    if (clockElement) {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        clockElement.textContent = `${hours}:${minutes}:${seconds}`;
    }
}

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

// Control visual del indicador de red de Firestore
function updateDbStatus(online) {
    const badge = document.getElementById('db-status');
    if (badge) {
        badge.className = 'db-status-badge ' + (online ? 'connected' : 'disconnected');
        const text = badge.querySelector('.status-text');
        if (text) text.textContent = online ? 'Conectado' : 'Offline';
    }
}

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
function initApp() {
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
            isInitialLoad = false;
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
        
        if (trainingRecords.length === 0) {
            addRow();
        }
        
        calculateTotal();
    }, (error) => {
        console.error("Error en Firestore onSnapshot: ", error);
        updateDbStatus(false);
        showToast("Error de sincronización con base de datos: " + error.message, "error");
    });

    document.getElementById('btn-add-row').addEventListener('click', addRow);
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
    } else if (field === 'trabajador') {
        parsedValue = value.trim().toUpperCase();
    } else if (field === 'of') {
        parsedValue = value.trim();
    }
    
    try {
        await db.collection('fichajes').doc(id).update({
            [field]: parsedValue
        });
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
        <td class="td-input"><input type="text" class="cell-input" data-field="trabajador" value="${record.trabajador || ''}" placeholder="Trabajador..."></td>
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
                Eliminar
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
}
