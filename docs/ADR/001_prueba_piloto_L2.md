# ADR 001: Prueba Piloto en Línea 2 (L2)

**Status:** Aceptado
**Fecha:** 2026-06-30
**Autores:** Bibliotecario (coordinado con Arquitecto, BA, Operaciones, Industria 4.0, QA, UX/UI, Matemático)

## Contexto

Se necesita desplegar la aplicación de "Registro de Formación" en el entorno real de producción para validar la adopción por parte de los operarios y asegurar que no haya bloqueos en el flujo de trabajo ni problemas con el guardado de datos. Se ha elegido la **Línea 2 (L2)** como área piloto.

## Decisión Técnica

Para esta prueba en L2, se han implementado las siguientes decisiones conjuntas:
1. **Supresión del Autocompletado de Línea (Arquitecto/Poka-Yoke):** Se ha eliminado la asignación por defecto a "Línea 1". Ahora la aplicación inicia con campos vacíos (Operación y Línea) y fuerza a la validación antes de guardar (`app.js`), evitando inserciones de datos "basura" por inercia del operario.
2. **Ampliación de Touch-Targets (UX/UI):** El tamaño mínimo de los botones y de los inputs (`.cell-input`) ha pasado de `38px` a `48px` para garantizar la viabilidad de uso táctil industrial (con guantes y en HMI), basándose en la Ley de Fitts.
3. **Control de Máximos y Ceros (Matemático / Industria 4.0):** El `maxHorasFichaje` bloquea registros erróneos (>10h) antes de hacer la actualización a Firestore. Asimismo, se rechaza la inserción si el tiempo introducido es `0` y se da a "Enter".
4. **Alerta de Red (QA Tester):** Mantenimiento del listener `navigator.onLine` para avisos tempranos en la interfaz (`#db-status`) ante caídas de la Wi-Fi de L2.

## Consecuencias

*   **Positivas:** Reducción sustancial del riesgo de datos inválidos gracias a los bloqueos (vacíos o >10h). Interfaz más adaptada a pantallas táctiles industriales.
*   **Negativas:** La supresión de valores por defecto requerirá 2 "clics" extra por parte del operario en su primer registro del día (elegir su operación y la Línea L2 manualmente). Se monitorizará el *Cycle Time* para evaluar impacto.
