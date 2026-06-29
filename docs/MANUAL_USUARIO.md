# 📖 Manual de Usuario y Arquitectura - STULZ HR Suite

> Documento mantenido proactivamente por el Agente **Bibliotecario**.
> Última actualización: 29 Junio 2026

Este documento centraliza el conocimiento técnico y de negocio de la aplicación para evitar la pérdida de información si cambia el equipo de desarrollo.

---

## 1. Visión General del Proyecto
Esta aplicación comenzó como un simple registro de horas de formación para cumplir con normativas de RRHH. Ha evolucionado hacia una **Suite Integral de Operaciones (HR & Plant Command Center)** que vincula la capacitación del personal con los costes financieros (ETT) y el rendimiento de la línea de producción (Lean Manufacturing).

## 2. Arquitectura Técnica
- **Frontend:** Vanilla HTML, CSS y Javascript. Estructura modular (`components/sidebar.js`) para evitar deuda técnica.
- **Backend / BBDD:** Firebase (Firestore) en modo *Compat* para ejecución local puramente estática (`file://`), garantizando la seguridad en la intranet de la fábrica.
- **Gráficos:** Chart.js para visualización avanzada.

## 3. Módulos de la Aplicación

### 3.1. Registro de Formación (`index.html`)
- **Propósito:** Entrada de datos crudos (horas invertidas por operario en distintas operaciones).
- **Reglas de Negocio (Poka-Yokes):** 
  - Tope máximo permitido: **10 horas por turno/envío**. Si un operario intenta meter más, el sistema lo capa automáticamente.
  - El ID del trabajador introducido debe existir en la base de datos de Firebase.

### 3.2. Planificador de Formación (`planificador/index.html`)
- **Propósito:** Permite a RRHH ver el "Gap" (horas faltantes) de cada trabajador respecto al objetivo (10h) para considerarlo Autónomo (Nivel Verde).

### 3.3. Matriz de Polivalencia (`polivalencia/index.html`)
- **Propósito:** Mapa de calor de las habilidades de la plantilla.
- **Niveles:** 
  - Rojo (No formado: 0h)
  - Amarillo (En formación: < 10h)
  - Verde (Autónomo: >= 10h)

### 3.4. Gestión ETT - Dashboard Financiero (`ett/index.html`)
- **Propósito:** Calcular el Coste Hundido de Formación (ineficiencias) del personal subcontratado.
- **Lógica Financiera:** 
  - Solo se computan como coste las horas hasta alcanzar el umbral de autonomía (10h por operación). Una vez superadas, se asume que el trabajador es productivo y no genera ineficiencia formativa.
  - Tarifa estándar fijada: **18.0€ / hora**.
  - Permite filtrar gastos por rango de fechas.

### 3.5. Master Monitor Analytics (`analytics/index.html`)
- **Propósito:** El "Command Center" del Director de Planta y Jefe de RRHH.
- **KPIs Estratégicos:**
  1. **Skill Gap:** % de madurez de la fábrica (Horas reales útiles / Total horas objetivo).
  2. **Flexibilidad Media:** Número medio de operaciones en las que un trabajador es Autónomo (Nivel Verde). Un ratio alto implica una fábrica capaz de adaptarse a bajas.
  3. **Coste Ineficiencia Formativa:** Valor económico (Euros) perdido en horas de aprendizaje (Horas útiles totales * Tarifa 18€).
  4. **Riesgo Operativo (Bottlenecks):** Identifica automáticamente en qué sección tenemos menos personal cualificado y alerta proactivamente.

---

## 4. Ecosistema de Agentes (Customizations)
La aplicación cuenta con una inteligencia artificial embebida que revisa el código e inyecta proactividad en el desarrollo. Los perfiles son:
- **Director de Operaciones:** Control de ROI y Negocio.
- **Business Analyst:** Análisis de datos.
- **Experto Ind. 4.0:** Conexión con el Shop Floor y Poka-Yokes.
- **Arquitecto:** Clean Code y abstracción de componentes.
- **UX/UI Designer:** Interfaz Premium industrial.
- **QA Tester:** Robustez y prevención de fallos lógicos.
- **Bibliotecario:** Mantenimiento de este documento.
