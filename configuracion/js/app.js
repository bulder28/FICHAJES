// configuracion/js/app.js - Lógica del Panel de Configuración Global

let operariosData = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Iniciar reloj (shared.js)
    if (typeof updateClock === 'function') {
        setInterval(updateClock, 1000);
        updateClock();
    }

    // Listener para el buscador
    const searchInput = document.getElementById('search-worker');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderWorkersTable(searchInput.value.toLowerCase());
        });
    }

    // Modal forms
    const workerForm = document.getElementById('worker-form');
    if (workerForm) {
        workerForm.addEventListener('submit', handleWorkerSubmit);
    }

    await loadData();
});

async function loadData() {
    if (typeof updateDbStatus === 'function') updateDbStatus(false);

    try {
        await Promise.all([
            loadGlobalConfig(),
            loadWorkers()
        ]);
        if (typeof updateDbStatus === 'function') updateDbStatus(true);
    } catch (e) {
        console.error("Error cargando configuración:", e);
        showToast("Error crítico conectando a la base de datos.", "error");
    }
}

// ----------------------------------------------------
// 1. GESTIÓN DE VARIABLES GLOBALES (CONFIG)
// ----------------------------------------------------
async function loadGlobalConfig() {
    try {
        const configDoc = await db.collection('config').doc('global').get();
        if (configDoc.exists) {
            const data = configDoc.data();
            if (data.tarifaETT) document.getElementById('config-tarifa').value = data.tarifaETT;
            if (data.maxHorasFichaje) document.getElementById('config-max-horas').value = data.maxHorasFichaje;
            if (data.umbralAutonomia) document.getElementById('config-umbral').value = data.umbralAutonomia;
        } else {
            // Valores por defecto sugeridos por los Agentes
            document.getElementById('config-tarifa').value = 18.0;
            document.getElementById('config-max-horas').value = 10;
            document.getElementById('config-umbral').value = 10;
            
            // Creamos el documento inicial silenciosamente
            await db.collection('config').doc('global').set({
                tarifaETT: 18.0,
                maxHorasFichaje: 10,
                umbralAutonomia: 10,
                updatedAt: new Date().toISOString()
            });
        }
    } catch (e) {
        console.error("Error leyendo config global:", e);
    }
}

async function saveConfig(type) {
    try {
        const updates = { updatedAt: new Date().toISOString() };
        
        if (type === 'tarifa') {
            const val = parseFloat(document.getElementById('config-tarifa').value);
            if (isNaN(val) || val <= 0) return showToast("Por favor, introduce una tarifa válida mayor que 0.", "warning");
            updates.tarifaETT = val;
        } 
        else if (type === 'planta') {
            const maxH = parseFloat(document.getElementById('config-max-horas').value);
            const umbral = parseFloat(document.getElementById('config-umbral').value);
            
            if (isNaN(maxH) || maxH <= 0 || isNaN(umbral) || umbral <= 0) {
                return showToast("Las horas deben ser valores numéricos positivos.", "warning");
            }
            updates.maxHorasFichaje = maxH;
            updates.umbralAutonomia = umbral;
        }

        // Merge actualiza solo los campos enviados
        await db.collection('config').doc('global').set(updates, { merge: true });
        
        showToast("¡Configuración guardada con éxito!", "success");
        
    } catch (e) {
        console.error("Error guardando config:", e);
        showToast("Fallo al guardar la configuración.", "error");
    }
}


// ----------------------------------------------------
// 2. GESTIÓN DE PLANTILLA (CRUD OPERARIOS)
// ----------------------------------------------------
async function loadWorkers() {
    try {
        const snap = await db.collection('operarios').get();
        operariosData = [];
        snap.forEach(doc => {
            operariosData.push({ id_doc: doc.id, ...doc.data() });
        });
        
        // Ordenar alfabéticamente
        operariosData.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        renderWorkersTable();
    } catch (e) {
        console.error("Error cargando operarios:", e);
    }
}

function renderWorkersTable(filterText = '') {
    const tbody = document.getElementById('workers-body');
    tbody.innerHTML = '';

    const filtered = operariosData.filter(w => {
        const id = (w.idTrabajador || w.id || '').toLowerCase();
        const name = (w.nombre || '').toLowerCase();
        return id.includes(filterText) || name.includes(filterText);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No se encontraron operarios.</td></tr>`;
        return;
    }

    filtered.forEach(worker => {
        const isEtt = worker.isETT || worker.agencia === 'EUROFIRMS' || worker.agencia === 'AURA';
        const typeBadge = isEtt 
            ? `<span class="badge badge-ett">ETT</span>` 
            : `<span class="badge badge-stulz">STULZ</span>`;
            
        const agencia = worker.agencia ? worker.agencia : (isEtt ? 'Generica' : '--');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500;">${worker.idTrabajador || worker.id || '-'}</td>
            <td>${worker.nombre || '-'}</td>
            <td>${typeBadge}</td>
            <td>${agencia}</td>
            <td>
                <button class="btn-secondary btn-small" onclick="editWorker('${worker.id_doc}')" style="margin-right: 0.5rem;" title="Editar operario">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="btn-danger" onclick="deleteWorker('${worker.id_doc}', '${worker.nombre}')" title="Eliminar definitivamente">
                    <i class="ph ph-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleAgenciaField() {
    const isEtt = document.getElementById('worker-is-ett').value === 'true';
    document.getElementById('group-agencia').style.display = isEtt ? 'block' : 'none';
}

function openWorkerModal() {
    document.getElementById('worker-form').reset();
    document.getElementById('worker-doc-id').value = '';
    document.getElementById('modal-title').innerText = 'Añadir Nuevo Operario';
    toggleAgenciaField();
    document.getElementById('worker-modal').style.display = 'flex';
}

function closeWorkerModal() {
    document.getElementById('worker-modal').style.display = 'none';
}

function editWorker(docId) {
    const worker = operariosData.find(w => w.id_doc === docId);
    if (!worker) return;

    document.getElementById('worker-doc-id').value = docId;
    document.getElementById('worker-id').value = worker.idTrabajador || worker.id || '';
    document.getElementById('worker-name').value = worker.nombre || '';
    
    const isEtt = worker.isETT || worker.agencia === 'EUROFIRMS' || worker.agencia === 'AURA';
    document.getElementById('worker-is-ett').value = isEtt ? 'true' : 'false';
    
    toggleAgenciaField();
    
    if (isEtt) {
        document.getElementById('worker-agencia').value = worker.agencia || 'OTRA';
    }

    document.getElementById('modal-title').innerText = 'Editar Operario';
    document.getElementById('worker-modal').style.display = 'flex';
}

async function handleWorkerSubmit(e) {
    e.preventDefault();
    
    const docId = document.getElementById('worker-doc-id').value;
    const idTrabajador = document.getElementById('worker-id').value.toUpperCase();
    const nombre = document.getElementById('worker-name').value;
    const isEtt = document.getElementById('worker-is-ett').value === 'true';
    const agencia = isEtt ? document.getElementById('worker-agencia').value : null;

    if (!idTrabajador || !nombre) {
        showToast("El ID y el Nombre son obligatorios.", "warning");
        return;
    }

    const payload = {
        idTrabajador: idTrabajador,
        nombre: nombre,
        isETT: isEtt,
        agencia: agencia,
        updatedAt: new Date().toISOString()
    };

    try {
        if (docId) {
            // Edit
            await db.collection('operarios').doc(docId).update(payload);
        } else {
            // Para mantener compatibilidad con algunos sitios que leen 'id', lo forzamos como doc ID
            await db.collection('operarios').doc(idTrabajador).set(payload);
        }
        
        closeWorkerModal();
        await loadWorkers(); // Recargar tabla
        
        // Poka-Yoke Visual QA
        showToast(`Operario ${nombre} guardado correctamente.`, "success");
        
    } catch (e) {
        console.error("Error guardando operario:", e);
        showToast("Fallo al guardar en la base de datos.", "error");
    }
}

async function deleteWorker(docId, nombre) {
    // Usamos modal corporativo para evitar el warning pero mantenemos lógica
    // Nota: Como no podemos inyectar dinámicamente texto en el shared modal actual fácilmente,
    // usaremos el modal estándar que pregunta "¿Estás seguro...?"
    const confirmed = await showConfirmModal();
    if (confirmed) {
        try {
            await db.collection('operarios').doc(docId).delete();
            showToast(`Operario ${nombre} eliminado.`, "info");
            await loadWorkers(); // Recargar
        } catch (e) {
            console.error("Error borrando:", e);
            showToast("No se pudo eliminar el operario.", "error");
        }
    }
}
