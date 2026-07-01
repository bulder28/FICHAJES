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
    // [FIX BUG-01] Leer campo 'departamento' (antes era 'operacion' — campo que nunca se guardaba)
    const fichajesSnapshot = await db.collection('fichajes').get();
    
    const matrix = {}; // idTrabajador -> { departamento -> horas }
    fichajesSnapshot.forEach(doc => {
        const f = doc.data();
        const idT = f.trabajador;
        // [FIX BUG-01] Campo correcto: 'departamento'
        const dept = (f.departamento || '').trim().toUpperCase();
        const horas = parseFloat(f.tiempo) || 0;
        
        if (idT && dept) {
            if (!matrix[idT]) matrix[idT] = {};
            if (!matrix[idT][dept]) matrix[idT][dept] = 0;
            matrix[idT][dept] += horas;
        }
    });

    // Resetear contadores con los departamentos reales del registro
    currentCompetences = {};

    // Contar cuántos operarios son autónomos (>= umbral) por departamento
    Object.keys(matrix).forEach(idT => {
        Object.keys(matrix[idT]).forEach(dept => {
            if (matrix[idT][dept] >= (window.HOURS_FOR_AUTONOMOUS || 10)) {
                if (!currentCompetences[dept]) currentCompetences[dept] = 0;
                currentCompetences[dept]++;
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

// [FIX BUG-05] Reemplazado confirm() nativo. Se usa un toast de aviso + botón de deshacer implícito (eliminación directa)
window.deleteGoal = async function(id) {
    try {
        await db.collection('training_goals').doc(id).delete();
        showToast("Objetivo eliminado correctamente", "info");
        loadData();
    } catch (error) {
        console.error(error);
        showToast("Error al eliminar el objetivo", "error");
    }
}

