let trainingRecords = [];

const lines = ['L1', 'L2', 'L3', 'L4', 'L5', 'BOX 1'];
const operations = ['MONTAJE MECÁNICO', 'MONTAJE ELÉCTRICO', 'PRUEBA FINAL'];
const shifts = ['Mañana', 'Tarde'];

document.addEventListener('DOMContentLoaded', () => {
    loadData();
    
    document.getElementById('btn-add-row').addEventListener('click', addRow);
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    
    const clearBtn = document.getElementById('btn-clear-table');
    if (clearBtn) clearBtn.addEventListener('click', clearTable);
    
    // Si no hay datos, inicializamos con una fila vacía
    if (trainingRecords.length === 0) {
        addRow();
    } else {
        renderTable();
    }
});

function loadData() {
    const saved = localStorage.getItem('training_records');
    if (saved) {
        try {
            trainingRecords = JSON.parse(saved);
        } catch (e) {
            console.error("Error cargando datos", e);
            trainingRecords = [];
        }
    }
}

function saveData() {
    localStorage.setItem('training_records', JSON.stringify(trainingRecords));
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function addRow() {
    const today = new Date().toISOString().split('T')[0];
    const newRecord = {
        id: generateId(),
        idTrabajador: '',
        turno: 'Mañana',
        of: '',
        operacion: 'MONTAJE MECÁNICO',
        linea: 'L1',
        fecha: today,
        tiempo: 0
    };
    trainingRecords.push(newRecord);
    renderTable();
    saveData();
}

function removeRow(id) {
    if(confirm('¿Estás seguro de que quieres eliminar este registro?')) {
        trainingRecords = trainingRecords.filter(r => r.id !== id);
        renderTable();
        saveData();
    }
}

function updateRecord(id, field, value) {
    const record = trainingRecords.find(r => r.id === id);
    if (record) {
        if (field === 'tiempo') {
            record[field] = parseFloat(value) || 0;
        } else {
            record[field] = value;
        }
        if (field === 'tiempo') calculateTotal();
        saveData();
    }
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    let html = '';
    
    trainingRecords.forEach(record => {
        html += `<tr data-id="${record.id}">
            <td class="td-input"><input type="text" class="cell-input" data-field="idTrabajador" value="${record.idTrabajador}" placeholder="ID..."></td>
            <td class="td-input">
                <select class="cell-input" data-field="turno">
                    ${shifts.map(s => `<option value="${s}" ${record.turno === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </td>
            <td class="td-input"><input type="text" class="cell-input" data-field="of" value="${record.of}" placeholder="Nº OF..."></td>
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
            <td class="td-input"><input type="date" class="cell-input" data-field="fecha" value="${record.fecha}"></td>
            <td class="td-input"><input type="number" step="0.5" min="0" class="cell-input calc-time" data-field="tiempo" value="${record.tiempo || ''}" placeholder="0.0"></td>
            <td class="td-actions">
                <button class="btn-delete" onclick="removeRow('${record.id}')" title="Eliminar fila">
                    <i class="ph ph-trash"></i>
                </button>
            </td>
        </tr>`;
    });
    
    tbody.innerHTML = html;
    
    // Event listeners para actualizar datos
    document.querySelectorAll('#table-body .cell-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const id = e.target.closest('tr').getAttribute('data-id');
            const field = e.target.getAttribute('data-field');
            updateRecord(id, field, e.target.value);
        });
        
        if (input.type === 'number' || input.type === 'text') {
            input.addEventListener('input', (e) => {
                const id = e.target.closest('tr').getAttribute('data-id');
                const field = e.target.getAttribute('data-field');
                updateRecord(id, field, e.target.value);
            });
        }
    });
    
    calculateTotal();
}

function calculateTotal() {
    const total = trainingRecords.reduce((sum, r) => sum + (parseFloat(r.tiempo) || 0), 0);
    document.getElementById('total-horas-formacion').textContent = total.toFixed(2);
}

function exportCSV() {
    if (trainingRecords.length === 0) {
        alert('No hay datos para exportar.');
        return;
    }
    
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // BOM for Excel UTF-8
    let rawCsvData = "\uFEFF"; // Solo los datos crudos para el File System Access API
    
    // Headers
    const headers = "ID TRABAJADOR;TURNO;OF;TIPO OPERACION;LINEA;FECHA FORMACION;TIEMPO (HORAS)\n";
    csvContent += headers;
    rawCsvData += headers;
    
    // Data
    trainingRecords.forEach(r => {
        const row = [
            `"${r.idTrabajador || ''}"`,
            `"${r.turno || ''}"`,
            `"${r.of || ''}"`,
            `"${r.operacion || ''}"`,
            `"${r.linea || ''}"`,
            `"${r.fecha || ''}"`,
            (r.tiempo || 0).toString().replace('.', ',') // Comma for decimals in Excel Spain
        ].join(";");
        csvContent += row + "\n";
        rawCsvData += row + "\n";
    });
    
    // Intentar usar la API moderna File System Access (permite elegir ruta)
    if (window.showSaveFilePicker) {
        window.showSaveFilePicker({
            suggestedName: 'TEST.csv',
            types: [{
                description: 'Archivo CSV (Separado por punto y coma)',
                accept: {'text/csv': ['.csv']}
            }]
        }).then(async (fileHandle) => {
            const writable = await fileHandle.createWritable();
            await writable.write(rawCsvData);
            await writable.close();
            alert('Archivo guardado correctamente en la ruta seleccionada.');
        }).catch((err) => {
            console.log('El usuario canceló o hubo un error:', err);
        });
    } else {
        // Fallback para navegadores antiguos (descarga normal)
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `TEST.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function clearTable() {
    if(confirm('ATENCIÓN: ¿Has guardado ya el Excel del día? Si confirmas, se borrarán todos los registros de la pantalla para empezar un día nuevo.')) {
        trainingRecords = [];
        renderTable();
        saveData();
    }
}
