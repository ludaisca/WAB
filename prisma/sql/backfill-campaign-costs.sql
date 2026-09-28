-- Backfill puntual (2026-09-28): wa_campaign_recipients.costUsd y
-- wa_campaigns.totalCostUsd (feat f6172c0, 2026-09-23) nunca corrieron en
-- producción hasta el deploy de hoy — campaign-worker.ts solo calcula el
-- costo al momento de enviar (ver lib/whatsapp/campaign-pricing.ts), así que
-- toda campaña que ya terminó de enviarse ANTES de este deploy quedó con
-- costUsd NULL en cada destinatario, y totalCostUsd nunca se recalcula fuera
-- de processCampaignJob (solo corre una vez, al final de la corrida) — por
-- eso sigue en 0.00 para siempre en esas campañas, sin importar la fecha de
-- envío. Este script recalcula ambas columnas para lo ya enviado, con la
-- misma tarifa vigente hoy en MESSAGE_PRICING (México/MARKETING, $0.0305 —
-- la única entrada cargada). No es sensible a la fecha del envío: la tarifa
-- no cambió en el periodo afectado, así que aplicar la tarifa actual a
-- envíos pasados reproduce exactamente lo que el worker habría calculado si
-- el código ya hubiera estado desplegado.
--
-- Si en el futuro se agregan más países/categorías a MESSAGE_PRICING, este
-- script NO los va a cubrir retroactivamente (solo conoce MX/MARKETING) —
-- escribir un backfill nuevo con la tarifa correspondiente si hace falta.
--
-- Idempotente: el UPDATE de costUsd solo toca filas con costUsd IS NULL; el
-- recálculo de totalCostUsd es un SUM determinista sobre el estado actual,
-- así que correr esto de nuevo no cambia nada.

UPDATE "wa_campaign_recipients" r
SET "costUsd" = 0.0305
FROM "wa_campaigns" c
JOIN "wa_templates" t ON t.id = c."waTemplateId"
WHERE r."campaignId" = c.id
  AND r."costUsd" IS NULL
  AND r."status" IN ('SENT', 'DELIVERED', 'READ')
  AND UPPER(t."category") = 'MARKETING'
  AND regexp_replace(r."phoneNumber", '\D', '', 'g') LIKE '52%';

UPDATE "wa_campaigns" c
SET "totalCostUsd" = COALESCE(
  (SELECT SUM(r."costUsd") FROM "wa_campaign_recipients" r WHERE r."campaignId" = c.id),
  0
);
