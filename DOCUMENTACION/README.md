# Documentación: Fichajes Formación

Bienvenido a la documentación del proyecto **Fichajes Formación**, un panel interactivo diseñado para registrar las formaciones de los trabajadores de la planta (STULZ).

## 🚀 Tecnologías Utilizadas

*   **HTML5 & CSS3**: Para la estructura semántica y un diseño moderno (vía `style.css`).
*   **Vanilla JavaScript (Módulos)**: Lógica de la aplicación (`app.js`) utilizando las versiones modulares de JS.
*   **Firebase Cloud Firestore**: Base de datos NoSQL en tiempo real para el almacenamiento de registros.

---

## 📂 Estructura del Proyecto

```text
FICHAJES FORMACIÓN/
│
├── index.html        # Archivo principal de la interfaz
├── style.css         # Hoja de estilos (diseño)
├── app.js            # Lógica principal y conexión con Firebase
└── DOCUMENTACION/
    └── README.md     # Este archivo
```

---

## 🔥 Configuración de Firebase

Este proyecto se conecta a **Firebase Cloud Firestore** para sincronizar todos los datos introducidos desde cualquier ordenador en tiempo real. 

### Reglas de Seguridad en Firestore
Para asegurar el correcto funcionamiento sin necesidad de Login, la base de datos utiliza unas reglas que validan la estructura de cada documento para evitar "basura":

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /fichajes/{fichajeId} {
      allow read: if true;
      allow write: if request.resource.data.keys().hasAll(['id', 'trabajador', 'turno', 'of', 'operacion', 'linea', 'fecha', 'tiempo'])
                   && request.resource.data.trabajador is string
                   && request.resource.data.operacion is string
                   && request.resource.data.tiempo is number
                   && request.resource.data.size() < 15;
      allow delete: if true;
    }
  }
}
```

---

## ⚙️ Funcionamiento de la Aplicación

1.  **Carga Inicial y Tiempo Real**: Al abrir la web, `onSnapshot` consulta todos los documentos de la colección `fichajes` ordenados por fecha de creación. Cualquier cambio realizado se refleja visualmente sin tener que recargar la página y sin interrumpir a los usuarios que estén escribiendo.
2.  **Operaciones CRUD**:
    *   **Crear**: El botón "Añadir Registro" crea un nuevo documento por defecto en Firestore con los campos básicos.
    *   **Modificar**: Cada vez que el usuario modifica un input y pierde el foco (`change`), la aplicación envía un evento `updateDoc` a Firestore.
    *   **Eliminar**: El botón de papelera ejecuta un `deleteDoc`.
3.  **Exportación CSV**: Permite descargar los registros actuales en la pantalla a un archivo Excel compatible con la separación regional de España (punto y coma y comas decimales), utilizando el API nativo `showSaveFilePicker` si el navegador lo soporta.
4.  **Nueva Jornada**: El botón rojo de limpieza borra permanentemente todos los documentos de la base de datos de Firebase para empezar un día en blanco.

---

## 📝 Notas de Desarrollo

*   **Evitar pérdida de foco**: La aplicación está diseñada inteligentemente para actualizar el HTML de los registros que editan otras personas en otros ordenadores sin quitar el foco (`document.activeElement`) a la celda en la que tú estás escribiendo actualmente.
*   **Archivos Modulares**: `app.js` debe cargarse en el HTML siempre con `type="module"` para soportar las importaciones directas de la red (`https://www.gstatic.com/firebasejs/...`).
