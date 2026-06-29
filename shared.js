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
