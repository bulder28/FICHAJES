# 📖 Documentación Oficial: Portal de Gestión de Personal (STULZ)

**Última actualización:** Junio 2026 — Post-Auditoría Pre-Producción  
**Responsable (Docs-as-Code):** Agente Bibliotecario

---

## � Objetivo de Negocio

Esta aplicación tiene un propósito operativo claro: ofrecer a los trabajadores de la empresa y a los operarios ETT una herramienta sencilla, rápida y accesible en planta para registrar el tiempo que invierten en formación, aprendizaje y puesta a punto de tareas.

Ese registro no es solo un dato de control: sirve para construir el sistema ILUO y completar la matriz de polivalencia. Cada departamento, fase o estación de trabajo tiene tareas y competencias que deben dominarse, y el tiempo registrado permite identificar qué personas están adquiriendo esas competencias, en qué nivel y con qué frecuencia.

En resumen, la app pretende:
- facilitar el registro del tiempo de formación en planta
- homogeneizar la recogida de información entre plantilla y ETT
- generar evidencia objetiva de aprendizaje y capacitación
- alimentar la matriz de polivalencia para que jefes de línea y responsables puedan validar competencias por operario, área y fase

---

## �🏗️ Arquitectura del Sistema (SPA)

La aplicación es una **Single Page Application (SPA)** que se carga desde un único archivo `index.html`. Esto garantiza el funcionamiento correcto en entornos de planta sin servidor local (protocolo `file://`).

### Estructura de Archivos
```
FICHAJES/
├── index.html      → Único punto de entrada (UI + SPA logic)
├── app.js          → Lógica de negocio, Firebase y Poka-Yokes
├── style.css       → Sistema de diseño completo (variables CSS + componentes)
├── shared.js       → Funciones compartidas (reloj, estado DB)
├── components/
│   └── sidebar.js  → Inyección dinámica del menú lateral
└── DOCUMENTACION/
    └── README.md   → Este archivo
```

---

## 🔐 Seguridad y Acceso (Post-Auditoría QA)

### Autenticación por PIN (Modo Admin / RRHH)
- El PIN **no se almacena en texto plano** en el código fuente.
- Se valida contra un **hash SHA-256** usando la Web Crypto API del navegador.
- Si alguien hace `Ctrl+U`, solo verá el hash, nunca el PIN real.

### Modos de Acceso
| Modo | Cómo entrar | Funciones disponibles |
|---|---|---|
| **Producción (Kiosko)** | Botón rojo en Launcher | Solo Registro de Formación |
| **Administración (RRHH)** | PIN corporativo | Alta Operarios + Gestión Festivos + CRUD completo |

---

## 🗄️ Modelo de Datos (Firebase Firestore)

### A. Colección `operarios`
| Campo | Tipo | Poka-Yoke |
|---|---|---|
| `nombre` | string | ≥3 caracteres, MAYÚSCULAS, único |
| `idTrabajador` | string | Regex `/^\d{5}$/` obligatorio |
| `turnoBase` | string | Lista cerrada: Mañana / Tarde |
| `seccionBase` | string | Lista cerrada: BATERÍAS / ALMACÉN / CHAPA / MONTAJE / TEST FINAL |
| `lineaReferente` | string | Solo si sección = MONTAJE |
| `calendarioBase` | string | Hardcodeado: "Lunes a Viernes" |

**Detección automática ETT por prefijo del ID:**
- `00XXX` → Plantilla STULZ
- `04XXX` → ETT Aura
- `06XXX` → ETT Eurofirms

### B. Colección `festivos`
- Días festivos nacionales, regionales, puentes y vacaciones de fábrica.
- Base del futuro módulo de Control de Absentismo.
- Calendario 2026 pre-cargado automáticamente en el primer arranque.

### C. Colección `fichajes`
- Registros de formación diarios filtrados por fecha del turno.
- Campo `fecha` calculado con 2h de retraso (protección cruce turno noche→mañana).
- Tiempo máximo por turno configurado vía `config/global` en Firestore (default: 10h).

---

## 🛡️ Poka-Yokes Implementados (Control de Calidad)

1. **ID de 5 dígitos obligatorio** con regex `/^\d{5}$/` — bloquea `00ABC`, `1234`, etc.
2. **Prefijo de ID válido** — solo `00`, `04`, o `06` al inicio.
3. **Unicidad de ID y Nombre** — consulta Firebase antes de registrar.
4. **Tiempo máximo por turno** — bloqueado a `maxHorasFichaje` de la config global.
5. **OF normalizada** — se convierte a MAYÚSCULAS y se eliminan espacios automáticamente.
6. **Trabajador validado en BD** — el ID tecleado en el fichaje debe existir en `operarios`.
7. **Doble confirmación para "Nueva Jornada"** — el usuario debe escribir la palabra `CONFIRMAR`.
8. **Indicador visual de guardado** — la fila parpadea en verde 1.5s al guardar en Firebase.

---

## 🎨 Sistema de Diseño

- **Paleta:** Rojo Corporativo STULZ `#c01b22` + Slate oscuro industrial
- **Tipografía:** Inter (Google Fonts) — legible en condiciones de baja luz
- **Modo Kiosko:** botones táctiles ≥ `110px` de alto, celdas ≥ `52px`, sin sidebar
- **Badge de Turno:** indicador visual ☀️/🌙 en cabecera del modo Producción
- **Micro-animaciones:** `row-saved` (verde), hover transitions `0.2s`, toast slide-in

---

## 🔮 Próximos Módulos Planificados

1. **Planificador de Ausencias** — control de absentismo con integración con `festivos`
2. **Matriz de Polivalencia ILUO** — competencias por operario, sección, fase y línea
3. **Validación de Jefes de Línea** — flujo para que los responsables aprueben o ratifiquen competencias
4. **Dashboard de KPIs** — formación, cobertura de competencias y evolución por turno y departamento
