// packages/db/src/schema/index.ts
//
// Reexport všech domén. Tenhle soubor NENÍ v seznamu schema v drizzle.config.ts,
// protože by přes něj drizzle-kit vtáhl i partitioned.ts.
export * from './identity';
export * from './platform';
export * from './contacts';
export * from './content';
export * from './campaigns';
export * from './tracking';
export * from './partitioned';
