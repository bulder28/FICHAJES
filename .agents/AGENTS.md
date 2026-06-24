# Reglas del Proyecto / Entorno

- **Restricciones del Navegador:** El entorno local/red corporativa no permite al asistente utilizar herramientas de navegador (`browser_subagent`) para abrir páginas web locales (`file://` o `localhost`) ni externas debido a restricciones de políticas de seguridad. Evitar el uso de subagentes de navegación y herramientas web en este espacio de trabajo. Realizar validaciones a través de otros medios (como scripts locales, herramientas de análisis de archivos, etc.).
- **Permisos de Git (Commits):** Queda estrictamente prohibido realizar commits en Git (`git commit`) o subir cambios (`git push`) automáticamente sin solicitar y recibir la confirmación explícita del usuario en el chat antes de ejecutar la terminal de comandos.
