// analytics/js/app.js - Analytics & Business Intelligence

let ofBarChartInstance = null;
let trainingPieChartInstance = null;

const OPERATIONS = ['MONTAJE MECÁNICO', 'MONTAJE ELÉCTRICO', 'MONTAJE HIDRÁULICO', 'REFRIGERACIÓN', 'TEST FINAL'];

document.addEventListener('DOMContentLoaded', async () => {
    // Iniciar reloj (shared.js) si existe
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    // Configurar el buscador de OF
    const btnSearch = document.getElementById('btn-search-of');
    const inputSearch = document.getElementById('of-search-input');
    
    if (btnSearch && inputSearch) {
        btnSearch.addEventListener('click', () => searchOF(inputSearch.value));
        inputSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchOF(inputSearch.value);
        });
    }

    // Cargar los datos globales de formación al iniciar
    await loadGlobalTrainingData();
});

// Estilos globales Chart.js
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#64748b';

/**
 * MÓDULO 1: Distribución Global de Formación
 */
async function loadGlobalTrainingData() {
    try {
        if (typeof updateDbStatus === 'function') updateDbStatus(false);
        
        const fichajesSnap = await db.collection('fichajes').get();
        
        let totalGlobal = 0;
        const horasPorOp = {
            'MONTAJE MECÁNICO': 0,
            'MONTAJE ELÉCTRICO': 0,
            'MONTAJE HIDRÁULICO': 0,
            'REFRIGERACIÓN': 0,
            'TEST FINAL': 0
        };

        fichajesSnap.forEach(doc => {
            const data = doc.data();
            const op = data.operacion;
            const h = parseFloat(data.tiempo) || 0;
            
            if (op && horasPorOp[op] !== undefined) {
                horasPorOp[op] += h;
                totalGlobal += h;
            }
        });

        // Actualizar UI
        document.getElementById('res-global-hours').textContent = totalGlobal.toFixed(1) + 'h';
        renderTrainingPieChart(horasPorOp);
        
        if (typeof updateDbStatus === 'function') updateDbStatus(true);
    } catch (e) {
        console.error("Error al cargar datos globales:", e);
    }
}

function renderTrainingPieChart(horasPorOp) {
    const ctx = document.getElementById('trainingPieChart').getContext('2d');
    
    if (trainingPieChartInstance) trainingPieChartInstance.destroy();

    const dataValues = OPERATIONS.map(op => horasPorOp[op] || 0);
    const backgroundColors = [
        '#ef4444', // Red
        '#f59e0b', // Yellow
        '#10b981', // Green
        '#3b82f6', // Blue
        '#8b5cf6'  // Purple
    ];

    trainingPieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: OPERATIONS,
            datasets: [{
                data: dataValues,
                backgroundColor: backgroundColors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        font: {
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed;
                            return ` ${value.toFixed(1)} horas`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * MÓDULO 2: Coste por Orden de Fabricación (OF)
 */
async function searchOF(ofValue) {
    const ofName = ofValue.trim().toUpperCase();
    if (!ofName) return;
    
    const inputEl = document.getElementById('of-search-input');
    const btnEl = document.getElementById('btn-search-of');
    
    try {
        inputEl.disabled = true;
        btnEl.textContent = "Buscando...";
        
        const fichajesRef = db.collection('fichajes');
        const snapshot = await fichajesRef.where('of', '==', ofName).get();
        
        const emptyState = document.getElementById('of-empty-state');
        const resultsContainer = document.getElementById('of-results-container');
        
        if (snapshot.empty) {
            alert(`No se han encontrado costes imputados para la OF: ${ofName}`);
            emptyState.style.display = 'block';
            resultsContainer.style.display = 'none';
            return;
        }

        let totalOF = 0;
        const horasPorOp = {
            'MONTAJE MECÁNICO': 0,
            'MONTAJE ELÉCTRICO': 0,
            'MONTAJE HIDRÁULICO': 0,
            'REFRIGERACIÓN': 0,
            'TEST FINAL': 0
        };

        snapshot.forEach(doc => {
            const data = doc.data();
            const op = data.operacion;
            const h = parseFloat(data.tiempo) || 0;
            
            if (op && horasPorOp[op] !== undefined) {
                horasPorOp[op] += h;
                totalOF += h;
            }
        });

        // Actualizar UI
        document.getElementById('res-of-name').textContent = ofName;
        document.getElementById('res-of-hours').textContent = totalOF.toFixed(1) + 'h';
        
        emptyState.style.display = 'none';
        resultsContainer.style.display = 'block';
        
        renderOFBarChart(horasPorOp);

    } catch (e) {
        console.error("Error buscando OF:", e);
        alert("Ocurrió un error al buscar la Orden de Fabricación.");
    } finally {
        inputEl.disabled = false;
        btnEl.textContent = "Buscar Costes";
    }
}

function renderOFBarChart(horasPorOp) {
    const ctx = document.getElementById('ofBarChart').getContext('2d');
    
    if (ofBarChartInstance) ofBarChartInstance.destroy();

    const dataValues = OPERATIONS.map(op => horasPorOp[op] || 0);

    ofBarChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: OPERATIONS,
            datasets: [{
                label: 'Horas Imputadas',
                data: dataValues,
                backgroundColor: 'rgba(192, 27, 34, 0.8)', // Stulz Red
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    title: {
                        display: true,
                        text: 'Horas Totales'
                    }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}
