// shared.js
// Configuración centralizada de Firebase y funciones compartidas

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

// POKA-YOKE: Forzar Long Polling para evitar bloqueos CORS por proxies corporativos (Stulz)
db.settings({
    experimentalForceLongPolling: true,
    useFetchStreams: false
});

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

// Control visual del indicador de red de Firestore
function updateDbStatus(online) {
    const badge = document.getElementById('db-status');
    if (badge) {
        badge.className = 'db-status-badge ' + (online ? 'connected' : 'disconnected');
        const text = badge.querySelector('.status-text');
        if (text) text.textContent = online ? 'Conectado' : 'Offline';
    }
}

// Gestión Centralizada de Configuración Global
let cachedConfig = null;

async function getGlobalConfig() {
    // Retornamos caché si ya se cargó en esta sesión para no saturar lecturas
    if (cachedConfig) return cachedConfig;
    
    try {
        const doc = await db.collection('config').doc('global').get();
        if (doc.exists) {
            cachedConfig = doc.data();
        } else {
            // Valores Hardcoded de fallback por seguridad (Poka-Yoke)
            cachedConfig = {
                tarifaETT: 18.0,
                maxHorasFichaje: 10,
                umbralAutonomia: 10,
                margenAbsentismoMinutos: 10
            };
        }
    } catch (e) {
        console.error("Error leyendo config global:", e);
        cachedConfig = { tarifaETT: 18.0, maxHorasFichaje: 10, umbralAutonomia: 10, margenAbsentismoMinutos: 10 };
    }
    
    return cachedConfig;
}

// [FIX BUG-09] showToast centralizado en shared.js para todos los módulos
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
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
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Modal personalizado de eliminación de registros (Inyección Dinámica)
let modalResolveCallback = null;

function ensureConfirmModalExists() {
    if (!document.getElementById('confirm-modal')) {
        const html = `
        <div id="confirm-modal" class="modal-backdrop">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Confirmar Eliminación</h2>
                </div>
                <div class="modal-body">
                    <p>¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer.</p>
                </div>
                <div class="modal-footer">
                    <button id="modal-btn-cancel-shared" class="btn-modal btn-modal-cancel">Cancelar</button>
                    <button id="modal-btn-confirm-shared" class="btn-modal btn-modal-confirm">Sí, eliminar</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        
        document.getElementById('modal-btn-cancel-shared').addEventListener('click', () => closeConfirmModal(false));
        document.getElementById('modal-btn-confirm-shared').addEventListener('click', () => closeConfirmModal(true));
    }
}

function showConfirmModal() {
    ensureConfirmModalExists();
    const modal = document.getElementById('confirm-modal');
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
