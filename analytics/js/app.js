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

// Variables de los gráficos y datos
let workerChartInstance = null;
let lineChartInstance = null;
let ofChartInstance = null;
let operationChartInstance = null;
let shiftChartInstance = null;
let rawRecords = [];
let currentFilterRange = 'all';

// Configuración global de Chart.js para Modo Claro Corporativo (Power BI Style)
Chart.defaults.color = '#605e5c'; // Gris neutro
Chart.defaults.font.family = "'Segoe UI', 'Outfit', sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(255, 255, 255, 0.95)';
Chart.defaults.plugins.tooltip.titleColor = '#252423';
Chart.defaults.plugins.tooltip.bodyColor = '#605e5c';
Chart.defaults.plugins.tooltip.borderColor = '#e1dfdd';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.boxPadding = 4;
Chart.defaults.plugins.tooltip.usePointStyle = true;

// Paleta clásica de Power BI
const colors = [
    '#118DFF', // Azul claro
    '#12239E', // Azul oscuro
    '#E66C37', // Naranja
    '#6B007B', // Púrpura
    '#E044A7', // Rosa
    '#744EC2', // Violeta
    '#D9B300', // Amarillo
    '#D64550', // Rojo
    '#197278', // Verde azulado
    '#1AAB40'  // Verde
];

// Reloj en tiempo real
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

// Conexión visual
function updateDbStatus(online) {
    const badge = document.getElementById('db-status');
    if (badge) {
        badge.className = 'db-status-badge ' + (online ? 'connected' : 'disconnected');
        const text = badge.querySelector('.status-text');
        if (text) text.textContent = online ? 'Conectado' : 'Offline';
    }
}

// Comprobar rango de fechas
function isDateInRange(dateStr, range) {
    if (range === 'all' || !dateStr) return true;
    
    const recordDate = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (range === 'today') {
        const todayStr = today.toISOString().split('T')[0];
        return dateStr === todayStr;
    }
    
    if (range === 'week') {
        const dayOfWeek = today.getDay(); // 0 es Domingo
        const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        const monday = new Date(today.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        return recordDate >= monday;
    }
    
    if (range === 'month') {
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return recordDate >= firstDayOfMonth;
    }
    
    return true;
}

let currentSelectedLinea = 'all';
let currentSelectedOf = 'all';

function populateFilterDropdowns(records) {
    const lineaSelect = document.getElementById('filter-linea');
    if (!lineaSelect) return;
    
    const prevLinea = lineaSelect.value || 'all';
    
    const uniqueLineas = new Set();
    
    records.forEach(r => {
        if (r.linea) uniqueLineas.add(r.linea.toString().trim());
    });
    
    const sortedLineas = Array.from(uniqueLineas).sort();
    
    lineaSelect.innerHTML = '<option value="all">Todas las Líneas</option>';
    sortedLineas.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        lineaSelect.appendChild(opt);
    });
    
    if (sortedLineas.includes(prevLinea)) {
        lineaSelect.value = prevLinea;
        currentSelectedLinea = prevLinea;
    } else {
        lineaSelect.value = 'all';
        currentSelectedLinea = 'all';
    }
}

// Aplicar filtros
function applyFilterAndRender() {
    let filtered = rawRecords;
    
    // 1. Filtrar por fecha
    filtered = filtered.filter(r => isDateInRange(r.fecha, currentFilterRange));
    
    // 2. Filtrar por Línea
    const lineaSelect = document.getElementById('filter-linea');
    if (lineaSelect && lineaSelect.value !== 'all') {
        filtered = filtered.filter(r => r.linea && r.linea.toString().trim() === lineaSelect.value);
    }
    
    // 3. Filtrar por OF (Búsqueda de texto)
    const ofInput = document.getElementById('filter-of');
    if (ofInput && ofInput.value.trim() !== '') {
        const searchTerm = ofInput.value.trim().toUpperCase();
        filtered = filtered.filter(r => r.of && r.of.toString().toUpperCase().includes(searchTerm));
    }
    
    processDataAndRender(filtered);
}

document.addEventListener('DOMContentLoaded', () => {
    // Ajustar enlace de "Fichajes Planta" si se navega localmente desde la carpeta standalone
    const navInput = document.getElementById('nav-input');
    if (navInput && window.location.protocol === 'file:') {
        navInput.href = '../index.html';
    }

    updateClock();
    setInterval(updateClock, 1000);
    
    // Conectividad inicial
    updateDbStatus(navigator.onLine);
    window.addEventListener('online', () => updateDbStatus(true));
    window.addEventListener('offline', () => updateDbStatus(false));

    // Escucha en tiempo real de Firebase
    const q = db.collection("fichajes");
    q.onSnapshot((snapshot) => {
        updateDbStatus(true);
        rawRecords = [];
        snapshot.forEach(doc => {
            rawRecords.push({ id: doc.id, ...doc.data() });
        });
        
        populateFilterDropdowns(rawRecords);
        applyFilterAndRender();
    }, (error) => {
        console.error("Error cargando estadísticas en tiempo real: ", error);
        updateDbStatus(false);
    });

    // Configurar selectores de filtro
    const lineaSelect = document.getElementById('filter-linea');
    if (lineaSelect) {
        lineaSelect.addEventListener('change', (e) => {
            currentSelectedLinea = e.target.value;
            applyFilterAndRender();
        });
    }

    const ofInput = document.getElementById('filter-of');
    if (ofInput) {
        ofInput.addEventListener('input', (e) => {
            currentSelectedOf = e.target.value.trim();
            applyFilterAndRender();
        });
    }

    // Configurar botones de filtro temporal
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentFilterRange = e.currentTarget.getAttribute('data-range');
            applyFilterAndRender();
        });
    });

    // Configurar botón de exportación Excel (.xlsx)
    const exportBtn = document.getElementById('btn-export-excel');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportExcel);
    }


});

function processDataAndRender(records) {
    // Si no hay datos
    if(records.length === 0) {
        document.getElementById('kpi-linea-value').textContent = '0.0h';
        document.getElementById('kpi-linea-sub').textContent = '-';
        document.getElementById('kpi-of-value').textContent = '0.0h';
        document.getElementById('kpi-of-sub').textContent = '-';
        document.getElementById('total-records').textContent = '0';
        document.getElementById('total-hours').textContent = '0.0';
        renderRecentTable([]);
        if(workerChartInstance) workerChartInstance.destroy();
        if(lineChartInstance) lineChartInstance.destroy();
        if(ofChartInstance) ofChartInstance.destroy();
        if(operationChartInstance) operationChartInstance.destroy();
        if(shiftChartInstance) shiftChartInstance.destroy();
        return;
    }

    // 1. KPIs Básicos
    const totalRecords = records.length;
    const totalHours = records.reduce((sum, r) => sum + (parseFloat(r.tiempo) || 0), 0);
    
    document.getElementById('total-records').textContent = totalRecords;
    document.getElementById('total-hours').textContent = totalHours.toFixed(1);

    // 2. Agrupar Datos
    const hoursByWorker = {};
    const hoursByLine = {};
    const hoursByOf = {};
    const hoursByOp = {};
    const hoursByShift = {};
    const uniqueWorkers = new Set();

    records.forEach(r => {
        const worker = (r.trabajador || '').trim().toUpperCase();
        const line = r.linea || 'Sin línea';
        const ofNum = r.of || 'Sin OF';
        const op = r.operacion || 'Sin operación';
        const shift = r.turno || 'Sin Turno';
        const hours = parseFloat(r.tiempo) || 0;

        if (worker && worker !== 'DESCONOCIDO') {
            uniqueWorkers.add(worker);
        }
        hoursByWorker[worker || 'DESCONOCIDO'] = (hoursByWorker[worker || 'DESCONOCIDO'] || 0) + hours;
        hoursByLine[line] = (hoursByLine[line] || 0) + hours;
        hoursByOf[ofNum] = (hoursByOf[ofNum] || 0) + hours;
        hoursByOp[op] = (hoursByOp[op] || 0) + hours;
        hoursByShift[shift] = (hoursByShift[shift] || 0) + hours;
    });

    // 3. KPIs Avanzados
    // Calcular Línea Top / Horas por Línea
    const lineaSelect = document.getElementById('filter-linea');
    let displayLineHours = 0;
    let displayLineName = 'Todas';
    
    if (lineaSelect && lineaSelect.value !== 'all') {
        displayLineName = lineaSelect.value;
        displayLineHours = hoursByLine[lineaSelect.value] || 0;
    } else {
        let topLine = '-';
        let maxLineHours = 0;
        Object.entries(hoursByLine).forEach(([line, hours]) => {
            if (hours > maxLineHours) {
                maxLineHours = hours;
                topLine = line;
            }
        });
        displayLineName = topLine !== '-' ? `Top: ${topLine}` : 'Ninguna';
        displayLineHours = maxLineHours;
    }
    
    document.getElementById('kpi-linea-value').textContent = displayLineHours.toFixed(1) + 'h';
    document.getElementById('kpi-linea-sub').textContent = displayLineName;

    // Calcular OF Top / Horas por OF
    const ofSelect = document.getElementById('filter-of');
    let displayOfHours = 0;
    let displayOfName = 'Todas';
    
    if (ofSelect && ofSelect.value !== 'all') {
        displayOfName = `OF: ${ofSelect.value}`;
        displayOfHours = hoursByOf[ofSelect.value] || 0;
    } else {
        let topOf = '-';
        let maxOfHours = 0;
        Object.entries(hoursByOf).forEach(([ofNum, hours]) => {
            if (hours > maxOfHours) {
                maxOfHours = hours;
                topOf = ofNum;
            }
        });
        displayOfName = topOf !== '-' ? `Top: OF ${topOf}` : 'Ninguna';
        displayOfHours = maxOfHours;
    }
    
    document.getElementById('kpi-of-value').textContent = displayOfHours.toFixed(1) + 'h';
    document.getElementById('kpi-of-sub').textContent = displayOfName;



    // 4. Renderizar la tabla de registros recientes
    renderRecentTable(records);

    // 5. Renderizar Gráficos
    renderWorkerChart(hoursByWorker);
    renderLineChart(hoursByLine);
    renderOfChart(hoursByOf);
    renderOperationChart(hoursByOp);
    renderShiftChart(hoursByShift);
}

function renderRecentTable(records) {
    const tbody = document.getElementById('recent-table-body');
    if (!tbody) return;
    
    // Ordenar de más reciente a más antiguo
    const sorted = [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    tbody.innerHTML = '';
    
    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-td">No hay fichajes en el período seleccionado.</td></tr>';
        return;
    }
    
    // Mostrar máximo 10 registros
    const top10 = sorted.slice(0, 10);
    top10.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 700; color: var(--text-primary);">${(r.trabajador || 'DESCONOCIDO').toUpperCase()}</td>
            <td>${r.turno || '-'}</td>
            <td style="font-family: monospace; font-weight: 600;">${r.of || '-'}</td>
            <td style="color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;">${r.operacion || ''}</td>
            <td style="font-weight: 700; color: var(--text-primary);">${r.linea || ''}</td>
            <td>${r.fecha || ''}</td>
            <td style="font-weight: 700; color: var(--accent); text-align: right; padding-right: 1.5rem;">${(parseFloat(r.tiempo) || 0).toFixed(1)} h</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderWorkerChart(data) {
    const ctx = document.getElementById('workerChart').getContext('2d');
    const sortedData = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const labels = sortedData.map(d => d[0]);
    const values = sortedData.map(d => d[1]);

    if(workerChartInstance) workerChartInstance.destroy();

    workerChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Horas Acumuladas',
                data: values,
                backgroundColor: '#118DFF', // Color base Power BI
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    grid: { 
                        color: '#f3f2f1',
                        drawBorder: false
                    }
                },
                x: {
                    grid: { display: false, drawBorder: false }
                }
            }
        }
    });
}

function renderLineChart(data) {
    const ctx = document.getElementById('lineChart').getContext('2d');
    const labels = Object.keys(data);
    const values = Object.values(data);

    if(lineChartInstance) lineChartInstance.destroy();

    lineChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'right',
                    labels: { usePointStyle: true, boxWidth: 8 }
                }
            },
            cutout: '75%'
        }
    });
}

function renderOfChart(data) {
    const ctx = document.getElementById('ofChart').getContext('2d');
    const sortedData = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const labels = sortedData.map(d => d[0]);
    const values = sortedData.map(d => d[1]);

    if(ofChartInstance) ofChartInstance.destroy();

    ofChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Horas',
                data: values,
                backgroundColor: '#118DFF', // Mismo azul que trabajador
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { 
                    beginAtZero: true,
                    grid: { 
                        color: '#f3f2f1',
                        drawBorder: false
                    }
                },
                y: {
                    grid: { display: false, drawBorder: false }
                }
            }
        }
    });
}

function renderOperationChart(data) {
    const ctx = document.getElementById('operationChart').getContext('2d');
    const sortedData = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const labels = sortedData.map(d => d[0]);
    const values = sortedData.map(d => d[1]);

    if(operationChartInstance) operationChartInstance.destroy();

    operationChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'right',
                    labels: { usePointStyle: true, boxWidth: 8 }
                }
            }
        }
    });
}

function renderShiftChart(data) {
    const ctx = document.getElementById('shiftChart').getContext('2d');
    const labels = Object.keys(data);
    const values = Object.values(data);

    if(shiftChartInstance) shiftChartInstance.destroy();

    shiftChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { usePointStyle: true, boxWidth: 8 }
                }
            },
            cutout: '75%'
        }
    });
}

function exportExcel() {
    const filteredRecords = rawRecords.filter(r => isDateInRange(r.fecha, currentFilterRange));
    
    // Aplicar filtros adicionales de línea y OF a la exportación
    let dataToExport = filteredRecords;
    
    const lineaSelect = document.getElementById('filter-linea');
    if (lineaSelect && lineaSelect.value !== 'all') {
        dataToExport = dataToExport.filter(r => r.linea && r.linea.toString().trim() === lineaSelect.value);
    }
    
    const ofSelect = document.getElementById('filter-of');
    if (ofSelect && ofSelect.value !== 'all') {
        dataToExport = dataToExport.filter(r => r.of && r.of.toString().trim() === ofSelect.value);
    }

    if (dataToExport.length === 0) {
        alert('No hay datos para exportar con los filtros seleccionados.');
        return;
    }
    
    // Mapear los datos a formato tabular limpio para Excel
    const worksheetData = dataToExport.map(r => ({
        "TRABAJADOR": (r.trabajador || '').toUpperCase(),
        "TURNO": r.turno || '',
        "Nº OF": r.of || '',
        "TIPO OPERACIÓN": r.operacion || '',
        "LÍNEA": r.linea || '',
        "FECHA FORMACIÓN": r.fecha || '',
        "TIEMPO (HORAS)": parseFloat(r.tiempo) || 0
    }));
    
    // Crear libro de trabajo y hoja
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fichajes Formacion");
    
    // Ajustar los anchos de columna de forma automática
    const max_len = worksheetData.reduce((acc, row) => {
        Object.keys(row).forEach((key, i) => {
            const val = row[key] ? row[key].toString() : "";
            acc[i] = Math.max(acc[i] || 10, val.length, key.length);
        });
        return acc;
    }, []);
    worksheet["!cols"] = max_len.map(len => ({ wch: len + 3 }));
    
    // Generar y descargar el archivo Excel nativo (.xlsx)
    const fileName = `Reporte_Formacion_${currentFilterRange}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}
