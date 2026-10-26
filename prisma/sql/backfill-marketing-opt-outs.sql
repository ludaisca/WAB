-- Marca como baja de marketing a los contactos que Meta reportó con
-- "This recipient has chosen to stop receiving marketing messages…" en el
-- detalle del error de envío. Antes ese texto solo se guardaba en
-- wa_campaign_recipients.errorMessage y el contacto seguía recibiendo campañas.
-- Idempotente: solo toca contactos que todavía están en false.
UPDATE contacts c
SET "optedOutMarketing" = true,
    "optedOutAt" = now()
FROM wa_campaign_recipients r
JOIN wa_campaigns camp ON camp.id = r."campaignId"
WHERE r.status = 'FAILED'
  AND r."errorMessage" ILIKE '%chosen to stop receiving%'
  AND c."accountId" = camp."waAccountId"
  AND c."remoteJid" = regexp_replace(r."phoneNumber", '[^0-9]', '', 'g')
  AND c."optedOutMarketing" = false;
