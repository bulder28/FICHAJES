// js/app.js para el módulo de Polivalencia

// [FIX BUG-01] Columnas de la matriz alineadas con el campo 'departamento' del registro de formación
const OPERATIONS = [
    'Montaje Mecánico', 
    'Montaje Eléctrico', 
    'Baterías', 
    'Transformación Metálica',
    'Perfilería y Soldadura',
    'Logística'
];

let workersData = [];
let matrixData = {}; // idTrabajador -> { operacion -> horas }

document.addEventListener('DOMContentLoaded', async () => {
    // Configuración de la hora en el header compartida (de shared.js)
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    try {
        const config = typeof getGlobalConfig === 'function' ? await getGlobalConfig() : { umbralAutonomia: 10 };
        window.umbralAutonomia = config.umbralAutonomia || 10;
        await loadMatrixData();
    } catch (error) {
        console.error("Error cargando la matriz:", error);
        document.getElementById('matrix-body').innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 2rem;">Error al cargar la base de datos: ${error.message}</td></tr>`;
        if (typeof updateDbStatus === 'function') updateDbStatus(false);
    }

    // Buscador y filtros
    const searchInput = document.getElementById('search-matrix');
    const seccionSelect = document.getElementById('filter-seccion');
    const turnoSelect = document.getElementById('filter-turno');
    
    const applyFilters = () => {
        const searchTerm = searchInput ? searchInput.value.trim().toUpperCase() : '';
        const seccion = seccionSelect ? seccionSelect.value : '';
        const turno = turnoSelect ? turnoSelect.value : '';
        renderMatrix(searchTerm, seccion, turno);
    };

    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (seccionSelect) seccionSelect.addEventListener('change', applyFilters);
    if (turnoSelect) turnoSelect.addEventListener('change', applyFilters);
});

async function loadMatrixData() {
    if (typeof updateDbStatus === 'function') updateDbStatus(false);
    document.getElementById('matrix-body').innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">Conectando con base de datos de recursos humanos...</td></tr>`;
    
    // 1. Cargar todos los operarios
    const operariosSnapshot = await db.collection('operarios').orderBy('nombre').get();
    workersData = [];
    operariosSnapshot.forEach(doc => {
        const data = doc.data();
        workersData.push({
            id: doc.id,
            nombre: data.nombre || 'Desconocido',
            idTrabajador: data.idTrabajador || '-',
            seccionBase: data.seccionBase || '',
            turnoBase: data.turnoBase || ''
        });
    });

    // 2. Cargar todos los fichajes (historico completo) y escuchar cambios en tiempo real
    db.collection('fichajes').onSnapshot((snapshot) => {
        // Reinicializar matriz
        matrixData = {};
        workersData.forEach(w => {
            matrixData[w.idTrabajador] = {};
            OPERATIONS.forEach(op => {
                matrixData[w.idTrabajador][op] = 0.0;
            });
        });

        // Sumar horas por departamento
        snapshot.forEach(doc => {
            const f = doc.data();
            const idT = f.trabajador;
            // [FIX BUG-01] Campo correcto: 'departamento' (antes era 'operacion')
            const dept = (f.departamento || '').trim();
            const horas = parseFloat(f.tiempo) || 0;
            
            if (idT && dept && matrixData[idT] !== undefined && matrixData[idT][dept] !== undefined) {
                matrixData[idT][dept] += horas;
            }
        });

        if (typeof updateDbStatus === 'function') updateDbStatus(true);
        
        // Disparar los filtros actuales
        const searchInput = document.getElementById('search-matrix');
        const seccionSelect = document.getElementById('filter-seccion');
        const turnoSelect = document.getElementById('filter-turno');
        
        const searchTerm = searchInput ? searchInput.value.trim().toUpperCase() : '';
        const seccion = seccionSelect ? seccionSelect.value : '';
        const turno = turnoSelect ? turnoSelect.value : '';
        
        renderMatrix(searchTerm, seccion, turno);
    }, (error) => {
        console.error("Error en realtime fichajes:", error);
        if (typeof updateDbStatus === 'function') updateDbStatus(false);
    });
}

function getStatusClass(horas) {
    if (horas <= 0) return 'status-red';
    
    const umbral = window.umbralAutonomia || 10;
    if (horas < umbral) return 'status-yellow';
    if (horas < 40) return 'status-green';
    return 'status-blue';
}

function renderMatrix(searchTerm = '', seccion = '', turno = '') {
    const tbody = document.getElementById('matrix-body');
    tbody.innerHTML = '';

    const filteredWorkers = workersData.filter(w => {
        let matches = true;
        
        if (searchTerm) {
            matches = matches && (w.nombre.toUpperCase().includes(searchTerm) || w.idTrabajador.toUpperCase().includes(searchTerm));
        }
        if (seccion) {
            matches = matches && (w.seccionBase === seccion);
        }
        if (turno) {
            matches = matches && (w.turnoBase === turno);
        }
        
        return matches;
    });

    if (filteredWorkers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: #64748b;">No se encontraron operarios.</td></tr>`;
        return;
    }

    filteredWorkers.forEach(w => {
        const tr = document.createElement('tr');
        
        // Celda fija: Nombre y Código
        const nameCell = document.createElement('td');
        nameCell.className = 'sticky-col';
        nameCell.innerHTML = `
            <div style="font-weight: 700;">${w.nombre}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">ID: ${w.idTrabajador}</div>
        `;
        tr.appendChild(nameCell);

        // Celdas de Operaciones
        OPERATIONS.forEach(op => {
            const td = document.createElement('td');
            const horas = matrixData[w.idTrabajador] ? (matrixData[w.idTrabajador][op] || 0) : 0;
            const statusClass = getStatusClass(horas);
            
            // Lógica de porcentaje para la barra (Max 40h = 100%)
            let porcentaje = (horas / 40) * 100;
            if (porcentaje > 100) porcentaje = 100;
            
            const displayHoras = horas > 0 ? parseFloat(horas.toFixed(1)) + 'h' : '-';
            const displayTexto = horas > 0 ? Math.round(porcentaje) + '%' : '-';
            
            td.innerHTML = `
                <div class="matrix-cell" title="${w.nombre} - ${op}: ${displayHoras}">
                    <div class="matrix-progress ${statusClass}" style="width: ${porcentaje}%;"></div>
                    <div class="matrix-text">${displayTexto}</div>
                </div>
            `;
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });
}
