// js/app.js para Control de Presencia (Zucchetti Mock)

let workersData = [];
let attendanceData = []; // Array of objects with worker id and simulated presence status

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    setupEventListeners();
    await loadWorkersFromFirebase();
    simulateZucchettiSync();
});

function setupEventListeners() {
    const btnSync = document.getElementById('btn-sync');
    if (btnSync) {
        btnSync.addEventListener('click', () => {
            btnSync.classList.add('btn-sync-active');
            btnSync.innerHTML = '<i class="ph ph-spinner"></i> SINCRONIZANDO API...';
            
            setTimeout(() => {
                simulateZucchettiSync();
                btnSync.classList.remove('btn-sync-active');
                btnSync.innerHTML = '<i class="ph ph-check-circle" style="color:#10b981;"></i> SINCRONIZADO';
                
                setTimeout(() => {
                    btnSync.innerHTML = '<i class="ph ph-arrows-clockwise"></i> SINCRONIZAR AHORA';
                }, 3000);
            }, 1500); // Simulamos 1.5s de latencia de red
        });
    }

    const searchInput = document.getElementById('search-attendance');
    if (searchInput) {
        searchInput.addEventListener('input', renderTable);
    }

    const filterStatus = document.getElementById('filter-status');
    if (filterStatus) {
        filterStatus.addEventListener('change', renderTable);
    }
}

async function loadWorkersFromFirebase() {
    if (typeof updateDbStatus === 'function') updateDbStatus(false);
    
    try {
        const snapshot = await db.collection('operarios').orderBy('nombre').get();
        workersData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            workersData.push({
                id: doc.id,
                idTrabajador: data.idTrabajador || '-',
                nombre: data.nombre || 'Desconocido',
                zona: data.zona || 'Planta Principal'
            });
        });
        if (typeof updateDbStatus === 'function') updateDbStatus(true);
    } catch (error) {
        console.error("Error cargando operarios:", error);
        showToast("Error al conectar con la base de datos de operarios", "error");
    }
}

// Simulador de Respuesta de API de Zucchetti
function simulateZucchettiSync() {
    attendanceData = workersData.map(worker => {
        // Simulamos que un ~80% de la plantilla está presente hoy
        const isPresent = Math.random() < 0.8;
        
        // Simulamos la última hora de fichaje si está presente
        let lastPunch = '-';
        if (isPresent) {
            const now = new Date();
            // Restamos entre 1 y 4 horas para simular entrada de turno
            now.setHours(now.getHours() - (Math.floor(Math.random() * 4) + 1));
            lastPunch = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + ' (Entrada)';
        }

        return {
            ...worker,
            status: isPresent ? 'PRESENT' : 'ABSENT',
            lastPunch: lastPunch
        };
    });

    updateKPIs();
    renderTable();
}

function updateKPIs() {
    const total = attendanceData.length;
    const present = attendanceData.filter(w => w.status === 'PRESENT').length;
    const absent = total - present;

    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-present').textContent = present;
    document.getElementById('kpi-absent').textContent = absent;
}

function renderTable() {
    const tbody = document.getElementById('attendance-body');
    const searchTerm = (document.getElementById('search-attendance').value || '').trim().toUpperCase();
    const filterStatus = document.getElementById('filter-status').value;

    tbody.innerHTML = '';

    const filteredData = attendanceData.filter(w => {
        const matchesSearch = w.nombre.toUpperCase().includes(searchTerm) || w.idTrabajador.toUpperCase().includes(searchTerm);
        const matchesStatus = filterStatus === 'ALL' || w.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #64748b;">No se encontraron operarios con los filtros actuales.</td></tr>`;
        return;
    }

    filteredData.forEach(w => {
        const tr = document.createElement('tr');
        
        let statusBadge = '';
        if (w.status === 'PRESENT') {
            statusBadge = `
                <div class="status-badge present">
                    <div class="status-indicator present"></div> EN PLANTA
                </div>
            `;
        } else {
            statusBadge = `
                <div class="status-badge absent">
                    <div class="status-indicator absent"></div> AUSENTE
                </div>
            `;
        }

        tr.innerHTML = `
            <td>${statusBadge}</td>
            <td style="font-family: monospace; font-weight: 600; color: #475569;">${w.idTrabajador}</td>
            <td style="font-weight: 600; color: var(--text-primary);">${w.nombre}</td>
            <td style="color: #64748b; font-size: 0.85rem;">${w.lastPunch}</td>
            <td style="color: #64748b;">${w.zona}</td>
        `;

        tbody.appendChild(tr);
    });
}

// Notificaciones Toast (fallback)
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
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
