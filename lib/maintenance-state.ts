// Vive en Redis además de la BD: pg_restore reemplaza system_config y puede
// restaurar maintenanceMode=false antes de terminar los archivos/esquema.
export const MAINTENANCE_KEY = "wab:maintenance";
export const ACTIVE_REQUESTS_KEY = "wab:active-api-requests";
