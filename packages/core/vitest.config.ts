import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest jinak přepíše MODE na "test" a loadConfig() spadne. Zdůvodnění
    // je v packages/config/vitest/node.ts, kde je tentýž řádek.
    env: { MODE: process.env['MODE'] ?? 'web' },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Rozhodnutí R31 plánu P03: JEDEN kontejner PostgreSQL na celý běh, ne
    // jeden na soubor. globalSetup ho nastartuje, založí šest rolí a zmigruje
    // šablonu `mlain_template`; `startPgHarness()` si pak v každém souboru
    // vytvoří vlastní databázi příkazem `CREATE DATABASE ... TEMPLATE`.
    //
    // Bez toho startovalo 23 databázových souborů 23 kontejnerů a přehrálo
    // 23krát tutéž sadu migrací. Naměřeno na tomhle repozitáři: běh trval
    // 8 minut a 17 souborů spadlo na chybách Dockeru („no such container",
    // „removal of container is already in progress", „Health check failed"),
    // tedy na vyčerpaném stroji, ne na vlastním kódu.
    globalSetup: ['./src/test-support/global-setup.ts'],
    // Strop souběžnosti. Výchozí nastavení vitestu bere skoro všechna jádra,
    // což je správně, když na stroji běží jedna série. Tady jich běží několik
    // naráz (víc balíčků, víc paralelních prací) a každé vlákno si k tomu
    // zakládá vlastní databázi na sdíleném serveru.
    //
    // Naměřeno na desetijádrovém stroji: bez stropu vyskočila zátěž na 60
    // při 24 procesech vitestu, Docker sám žral 165 % jednoho jádra a testy
    // začaly padat na vypršených spojeních, tedy na vyčerpaném stroji,
    // ne na vlastním kódu. Se stropem doběhnou pomaleji, ale doběhnou.
    maxWorkers: 3,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { branches: 80 },
    },
  },
});
