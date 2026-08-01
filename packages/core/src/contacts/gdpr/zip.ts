/**
 * Minimální zapisovač archivu ZIP, metoda uložení bez komprese.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal `createZip(archive)` jako hotový
 * symbol. Žádná taková funkce v produktu není a balíček na ZIP mezi závislostmi taky ne;
 * přidávat kvůli jednomu exportu novou závislost by znamenalo sáhnout do package.json,
 * který vlastní P01. Formát je popsaný v APPNOTE.TXT (PKWARE) a v téhle podobě, tedy
 * bez komprese a bez adresářů, se vejde do sedmdesáti řádků.
 *
 * Nekomprimuje se schválně: archiv obsahuje jednotky až stovky kilobajtů textu jednoho
 * člověka a rozdíl ve velikosti nikoho netrápí, zatímco chyba v deflate proudu by
 * znamenala nečitelný archiv, který subjekt údajů dostane místo svých dat.
 */

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Čas v DOS formátu. Konstantní hodnota stačí: archiv nese časy uvnitř souborů. */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1. 1. 1980

export function createZip(files: ReadonlyMap<string, string | Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // podpis lokální hlavičky
    local.writeUInt16LE(20, 4); // verze potřebná k rozbalení
    local.writeUInt16LE(0x0800, 6); // příznak: jména souborů v UTF-8
    local.writeUInt16LE(0, 8); // metoda: uloženo bez komprese
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
