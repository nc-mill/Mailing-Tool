/**
 * Vychozi kurzor materializace. Je to nejnizsi mozne UUID, takze podminka `c.id > $2`
 * pri prvni davce nevylouci nikoho.
 *
 * Zije v samostatnem souboru schvalne: pouziva ho i repository postupu i handler jobu
 * a dve kopie tehoz retezce jsou presne to, co se za pul roku rozejde.
 */
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
