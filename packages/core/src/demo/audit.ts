import { defineAuditActions } from '../audit/action';

/**
 * Auditní akce domény ukázkových dat. Konvence 3.7: každá část si vlastní
 * názvy svých akcí ve vlastním `audit.ts`, sdílený union neexistuje.
 *
 * Obojí je záměrně v auditu, i když jde „jen" o ukázková data: nahrání
 * i odstranění mění obsah projektu a odstranění je nevratné.
 */
export const DemoAuditActions = defineAuditActions(['demo_data.seeded', 'demo_data.purged']);
