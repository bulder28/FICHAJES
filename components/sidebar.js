// components/sidebar.js - Componente Dinámico inyectado por el Arquitecto de Software

function renderSidebar() {
    const path = window.location.pathname;
    let base = './';
    let currentModule = 'registro';
    
    // Detección de módulo actual para rutas y clase "active"
    if (path.includes('/polivalencia/')) { base = '../'; currentModule = 'polivalencia'; }
    else if (path.includes('/planificador/')) { base = '../'; currentModule = 'planificador'; }

    else if (path.includes('/ett/')) { base = '../'; currentModule = 'ett'; }
    else if (path.includes('/analytics/')) { base = '../'; currentModule = 'analytics'; }
    else if (path.includes('/configuracion/')) { base = '../'; currentModule = 'configuracion'; }

    const sidebarHTML = `
        <div class="sidebar-brand">
            <h1 class="logo">STULZ</h1>
            <span>Gestión de Personal</span>
        </div>
        
        <nav class="sidebar-nav">
            <div class="nav-section">
                <span class="nav-group-title">FORMACIÓN & CAPACITACIÓN</span>
                <a href="${base}index.html" class="nav-item ${currentModule === 'registro' ? 'active' : ''}">
                    <i class="ph ph-clipboard-text"></i> Registro Formación
                </a>
                <a href="${base}planificador/planificador.html" class="nav-item ${currentModule === 'planificador' ? 'active' : ''}">
                    <i class="ph ph-calendar-check"></i> Planificador Formación
                </a>
                <a href="${base}polivalencia/polivalencia.html" class="nav-item ${currentModule === 'polivalencia' ? 'active' : ''}">
                    <i class="ph ph-users-three"></i> Matriz Polivalencia
                </a>
            </div>

            <div class="nav-section" style="margin-top: 1.5rem;">
                <span class="nav-group-title">GESTIÓN DE PERSONAL</span>
                <a href="${base}ett/ett.html" class="nav-item ${currentModule === 'ett' ? 'active' : ''}">
                    <i class="ph ph-handshake"></i> Gestión ETT
                </a>
            </div>

            <div class="nav-section admin-only" style="margin-top: 1.5rem;">
                <span class="nav-group-title">ADMINISTRACIÓN</span>
                <a href="${base}analytics/analytics.html" class="nav-item ${currentModule === 'analytics' ? 'active' : ''}">
                    <i class="ph ph-chart-bar"></i> Analytics & Datos
                </a>
                <a href="${base}configuracion/configuracion.html" class="nav-item ${currentModule === 'configuracion' ? 'active' : ''}">
                    <i class="ph ph-gear"></i> Configuración
                </a>
            </div>
        </nav>
        
        <div class="sidebar-footer">
            <div class="db-status-badge" id="db-status" title="Estado de conexión con base de datos">
                <span class="status-dot"></span>
                <span class="status-text">Conectando...</span>
            </div>
            <div class="header-clock" id="digital-clock" title="Hora actual del sistema">
                <i class="ph ph-clock"></i> <span id="clock-time">--:--:--</span>
            </div>
        </div>
    `;

    // [POKA-YOKE INDUSTRIA 4.0] Prevención de navegación en planta
    // Si la URL contiene mode=kiosk, abortamos la inyección del menú completamente
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'kiosk') {
        document.body.classList.add('no-sidebar');
        return; // Salir de la función sin inyectar nada
    }

    const container = document.getElementById('sidebar-container');
    if (container) {
        container.innerHTML = sidebarHTML;
        // Asignamos la clase sidebar al contenedor directamente para no romper el CSS actual
        container.className = 'sidebar';
    }

    // [FIX BUG-06] Leer sessionStorage para mostrar sección admin en cualquier módulo
    const isAdmin = sessionStorage.getItem('stulz_admin') === '1'
        || new URLSearchParams(window.location.search).get('admin') === '1';
    
    if (isAdmin) {
        // Guardar en sessionStorage por si el usuario llegó por URL directa
        sessionStorage.setItem('stulz_admin', '1');
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = '';
        });
    }
}

// Ejecutar inmediatamente si el DOM ya está listo, o esperar si no
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSidebar);
} else {
    renderSidebar();
}
