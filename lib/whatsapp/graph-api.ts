// Única fuente de verdad de la versión del Graph API de Meta. Todo call site
// (mensajes, media, plantillas, analytics, subida resumible) debe construir su
// URL desde aquí — antes la versión estaba escrita a mano en 6 archivos.
// Versiones y fechas de expiración: https://developers.facebook.com/docs/graph-api/changelog/versions
export const GRAPH_API_VERSION = "v25.0";
export const GRAPH_API_ORIGIN = "https://graph.facebook.com";
export const GRAPH_API = `${GRAPH_API_ORIGIN}/${GRAPH_API_VERSION}`;
