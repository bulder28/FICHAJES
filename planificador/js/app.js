// js/app.js para el Planificador de Formación

// HOURS_FOR_AUTONOMOUS será sobreescrito por la config global

let currentCompetences = {}; // operacion -> numero de operarios autónomos/expertos
let goals = []; // { id, operacion, target, deadline, createdAt }

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    try {
        const config = typeof getGlobalConfig === 'function' ? await getGlobalConfig() : { umbralAutonomia: 10 };
        window.HOURS_FOR_AUTONOMOUS = config.umbralAutonomia || 10;
    } catch(e) {
        window.HOURS_FOR_AUTONOMOUS = 10;
    }

    setupFormLogic();
    await loadData();
});

function setupFormLogic() {
    const btnNew = document.getElementById('btn-new-goal');
    const formPanel = document.getElementById('goal-form-panel');
    const btnCancel = document.getElementById('btn-cancel-goal');
    const btnSave = document.getElementById('btn-save-goal');

    btnNew.addEventListener('click', () => {
        formPanel.style.display = 'block';
        // Set default date to 1 month from now
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        document.getElementById('goal-deadline').value = nextMonth.toISOString().split('T')[0];
    });

    btnCancel.addEventListener('click', () => {
        formPanel.style.display = 'none';
    });

    btnSave.addEventListener('click', async () => {
        const operacion = document.getElementById('goal-operation').value;
        const target = parseInt(document.getElementById('goal-target').value);
        const deadline = document.getElementById('goal-deadline').value;

        if (!deadline) {
            showToast("Por favor, selecciona una fecha límite.", "warning");
            return;
        }

        try {
            btnSave.disabled = true;
            btnSave.textContent = 'Guardando...';

            await db.collection('training_goals').add({
                operacion,
                target,
                deadline,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast("Objetivo guardado correctamente", "success");
            formPanel.style.display = 'none';
            await loadData();
        } catch (error) {
            console.error(error);
            showToast("Error al guardar el objetivo", "error");
        } finally {
            btnSave.disabled = false;
            btnSave.textContent = 'Guardar Objetivo';
        }
    });
}

async function loadData() {
    if (typeof updateDbStatus === 'function') updateDbStatus(false);
    
    try {
        // 1. Calcular competencias actuales
        await calculateCurrentCompetences();
        
        // 2. Cargar objetivos
        const snapshot = await db.collection('training_goals').orderBy('deadline').get();
        goals = [];
        snapshot.forEach(doc => {
            goals.push({ id: doc.id, ...doc.data() });
        });

        renderGoals();
        if (typeof updateDbStatus === 'function') updateDbStatus(true);
    } catch (error) {
        console.error("Error cargando datos:", error);
        document.getElementById('goals-list').innerHTML = `<p style="color:red;">Error de conexión con la base de datos.</p>`;
    }
}

async function calculateCurrentCompetences() {
    // Igual que en la matriz, necesitamos sumar las horas de cada operario por operación
    const fichajesSnapshot = await db.collection('fichajes').get();
    
    const matrix = {}; // idTrabajador -> { operacion -> horas }
    fichajesSnapshot.forEach(doc => {
        const f = doc.data();
        const idT = f.trabajador;
        const op = f.operacion;
        const horas = parseFloat(f.tiempo) || 0;
        
        if (idT && op) {
            if (!matrix[idT]) matrix[idT] = {};
            if (!matrix[idT][op]) matrix[idT][op] = 0;
            matrix[idT][op] += horas;
        }
    });

    // Resetear contadores
    currentCompetences = {
        'MONTAJE MECÁNICO': 0,
        'MONTAJE ELÉCTRICO': 0,
        'MONTAJE HIDRÁULICO': 0,
        'REFRIGERACIÓN': 0,
        'TEST FINAL': 0
    };

    // Contar cuántos son autónomos (>= config umbral)
    Object.keys(matrix).forEach(idT => {
        Object.keys(matrix[idT]).forEach(op => {
            if (matrix[idT][op] >= (window.HOURS_FOR_AUTONOMOUS || 10)) {
                if (currentCompetences[op] !== undefined) {
                    currentCompetences[op]++;
                }
            }
        });
    });
}

function renderGoals() {
    const container = document.getElementById('goals-list');
    container.innerHTML = '';

    if (goals.length === 0) {
        container.innerHTML = `<div style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: #94a3b8; border: 2px dashed #cbd5e1; border-radius: 4px;">No hay planes de formación definidos a futuro. Haz clic en 'Nuevo Objetivo' para empezar.</div>`;
        return;
    }

    const today = new Date();
    today.setHours(0,0,0,0);

    goals.forEach(goal => {
        const current = currentCompetences[goal.operacion] || 0;
        const target = goal.target;
        const gap = Math.max(0, target - current);
        const hoursNeeded = gap * HOURS_FOR_AUTONOMOUS;
        
        let progress = (current / target) * 100;
        if (progress > 100) progress = 100;

        // Formatear Fecha
        const deadlineDate = new Date(goal.deadline);
        const dateStr = deadlineDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        
        // Status Colors
        const daysRemaining = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
        let statusClass = 'goal-status-success'; // Bien de tiempo o completado
        
        if (gap > 0) {
            if (daysRemaining < 15) {
                statusClass = 'goal-status-danger'; // Urgente
            } else if (daysRemaining < 45) {
                statusClass = 'goal-status-warning'; // Atención
            }
        }

        const div = document.createElement('div');
        div.className = `goal-card ${statusClass}`;
        
        div.innerHTML = `
            <div class="goal-header">
                <div class="goal-title">${goal.operacion}</div>
                <div class="goal-deadline">
                    <i class="ph ph-calendar-blank"></i> ${dateStr}
                </div>
            </div>
            
            <div class="goal-metrics">
                <div class="metric-box">
                    <span class="metric-label">OPERARIOS FORMADOS</span>
                    <span class="metric-value" style="color: ${gap === 0 ? '#10b981' : 'var(--text-primary)'}">${current} / ${target}</span>
                </div>
                <div class="metric-box">
                    <span class="metric-label">TIEMPO ESTIMADO REQ.</span>
                    <span class="metric-value ${gap > 0 ? 'highlight' : ''}">${hoursNeeded}h</span>
                </div>
            </div>

            <div class="goal-progress">
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 600; color: #64748b;">
                    <span>Progreso del Objetivo</span>
                    <span>${Math.round(progress)}%</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${progress}%; background-color: ${gap === 0 ? '#10b981' : '#3b82f6'};"></div>
                </div>
            </div>
            
            <div class="goal-footer">
                <button class="btn-delete-goal" onclick="deleteGoal('${goal.id}')" title="Eliminar objetivo">
                    <i class="ph ph-trash" style="font-size: 1.2rem;"></i>
                </button>
            </div>
        `;
        
        container.appendChild(div);
    });
}

window.deleteGoal = async function(id) {
    if (confirm("¿Estás seguro de que deseas eliminar este objetivo del planificador?")) {
        try {
            await db.collection('training_goals').doc(id).delete();
            showToast("Objetivo eliminado", "success");
            loadData();
        } catch (error) {
            console.error(error);
            showToast("Error al eliminar el objetivo", "error");
        }
    }
}

// Notificaciones Toast (copiado de shared para asegurar compatibilidad si falta)
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
