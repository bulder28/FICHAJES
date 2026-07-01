document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('photo-file');
    const workerInput = document.getElementById('photo-worker-id');
    const btnUpload = document.getElementById('btn-upload-photo');
    const imgPreview = document.getElementById('photo-img-preview');
    const previewContainer = document.getElementById('photo-preview');
    const canvas = document.getElementById('photo-canvas');
    let currentBase64 = null;

    if (!fileInput || !btnUpload) return;

    // Cuando se selecciona un archivo, previsualizar y comprimir
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Comprimir la imagen a 200x200 mx (estilo carnet)
                const MAX_SIZE = 200;
                let width = img.width;
                let height = img.height;

                // Calcular ratio para recortar/redimensionar como cuadrado (cover)
                const size = Math.min(width, height);
                const sx = (width - size) / 2;
                const sy = (height - size) / 2;

                canvas.width = MAX_SIZE;
                canvas.height = MAX_SIZE;
                const ctx = canvas.getContext('2d');
                
                // Dibujar imagen recortada al centro
                ctx.drawImage(img, sx, sy, size, size, 0, 0, MAX_SIZE, MAX_SIZE);
                
                // Extraer a jpeg comprimido (calidad 0.8)
                currentBase64 = canvas.toDataURL('image/jpeg', 0.8);
                
                imgPreview.src = currentBase64;
                previewContainer.style.display = 'block';
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Guardar en Firestore
    btnUpload.addEventListener('click', async () => {
        let workerId = workerInput.value.trim().toUpperCase();
        if (!workerId) {
            if (typeof showToast === 'function') showToast('Debes indicar el ID del operario', 'error');
            return;
        }
        
        // Formateo de ID (añadir ceros si es número)
        if (/^\d+$/.test(workerId)) {
            workerId = workerId.padStart(3, '0');
        }

        if (!currentBase64) {
            if (typeof showToast === 'function') showToast('Debes seleccionar una foto', 'error');
            return;
        }

        try {
            btnUpload.disabled = true;
            btnUpload.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Guardando...';

            await db.collection('operario_photos').doc(workerId).set({
                photoBase64: currentBase64,
                updatedAt: new Date().toISOString()
            });

            if (typeof showToast === 'function') showToast(`Foto guardada para el operario ${workerId}`, 'success');
            
            // Reset
            fileInput.value = '';
            workerInput.value = '';
            previewContainer.style.display = 'none';
            currentBase64 = null;

        } catch (error) {
            console.error('Error guardando foto:', error);
            if (typeof showToast === 'function') showToast('Error al guardar la foto: ' + error.message, 'error');
        } finally {
            btnUpload.disabled = false;
            btnUpload.innerHTML = '<i class="ph ph-cloud-arrow-up"></i> Guardar Foto';
        }
    });
});
