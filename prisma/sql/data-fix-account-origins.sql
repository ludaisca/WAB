-- Mapeo de WAAccount.origen (etiqueta libre interna) por unidad de negocio.
-- Se aplica una vez por entorno: es dato de negocio, no una reparación técnica,
-- así que NO va en scripts/startup.sh. Idempotente (mismo valor cada vez).
UPDATE wa_accounts SET origen = 'Medicalbuy' WHERE name IN ('Medicalbuy', 'Medicalbuy - Leads');
UPDATE wa_accounts SET origen = 'Meison Medical' WHERE name IN ('Meison Medical', 'Meison Medical - Leads');
UPDATE wa_accounts SET origen = 'Lifemedic' WHERE name = 'Lifemedic';
UPDATE wa_accounts SET origen = 'Prazise' WHERE name = 'Prazise - Leads';
UPDATE wa_accounts SET origen = 'Zegen' WHERE name = 'Zegen - Leads';
UPDATE wa_accounts SET origen = 'Ultrasonidos Veterinarios' WHERE name = 'Ultrasonidos Veterinarios - Leads';
UPDATE wa_accounts SET origen = 'HelseMedical' WHERE name = 'HelseMedical - Leads';
UPDATE wa_accounts SET origen = 'Promed' WHERE name = 'Promed - Leads';
UPDATE wa_accounts SET origen = 'Oportunidades' WHERE name = 'Oportunidades';
UPDATE wa_accounts SET origen = 'Clientes' WHERE name = 'Clientes';
