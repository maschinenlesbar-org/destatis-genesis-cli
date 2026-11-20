// Answers of GENESIS-Online for the operation and MCP tests.
//
// Recorded live (2026-11-20, as the guest user GAST, which GENESIS serves `find` to without an
// account): FIND_TABLES (`find "Bevölkerung" --category tables --pagelength 5`), FIND_ALL
// (`find "Bevölkerungsstand" --category all --pagelength 2`), FIND_NONE (`find "Xyzzyquux"
// --category tables`). Note the line breaks GENESIS puts into long titles, the empty `Time`, the
// counts as strings and every list null when nothing matched.
//
// Built from GENESIS's documentation (the 2020 web service's data/metadata/catalogue answers),
// not recorded: catalogue, metadata and data need an account, which these tests don't have. The
// envelope (Ident/Status/Parameter/Copyright) is the recorded one; the payloads follow the
// documented shapes (`Object.Content` the ";"-delimited CSV, `Object.Structure` the Head, Columns
// and Rows of variables, the flat CSV "ffcsv" one row per value). A live check with an account is
// still open.

import { deflateRawSync } from "node:zlib";

export const COPYRIGHT = "© Statistisches Bundesamt (Destatis), 2026";

/** The envelope of a GENESIS answer, as recorded, around `payload`. */
export function genesis(service: string, method: string, payload: Record<string, unknown>, status: { Code?: number; Content?: string; Type?: string } = {}): Record<string, unknown> {
  return {
    Ident: { Service: service, Method: method },
    Status: { Code: status.Code ?? 0, Content: status.Content ?? "erfolgreich", Type: status.Type ?? "Information" },
    Parameter: { username: "********************", password: "********************" },
    ...payload,
    Copyright: COPYRIGHT,
  };
}

export const FIND_TABLES = {
  "Ident": {
    "Service": "find",
    "Method": "find"
  },
  "Status": {
    "Code": 0,
    "Content": "erfolgreich",
    "Type": "Information"
  },
  "Parameter": {
    "username": "********************",
    "password": "********************",
    "term": "Bevölkerung",
    "category": "Tabellen",
    "pagelength": "5",
    "language": "de"
  },
  "Cubes": null,
  "Statistics": null,
  "Tables": [
    {
      "Code": "12211-0001",
      "Content": "Bevölkerung, Erwerbstätige, Erwerbslose, Erwerbspersonen, Nichterwerbspersonen aus Hauptwohnsitzhaushalten: Deutschland, Jahre, Geschlecht, Altersgruppen",
      "Time": "",
      "Valid": "true"
    },
    {
      "Code": "12211-0002",
      "Content": "Bevölkerung, Erwerbstätige, Erwerbslose, Erwerbspersonen, Nichterwerbspersonen aus Hauptwohnsitzhaushalten: Deutschland, Jahre, Überwiegender Lebensunterhalt, Altersgruppen",
      "Time": "",
      "Valid": "true"
    },
    {
      "Code": "12211-0003",
      "Content": "Bevölkerung, Erwerbstätige, Erwerbslose, Erwerbspersonen,\nNichterwerbspersonen aus Hauptwohnsitzhaush.: Deutschland,\nJahre, Geschlecht, Größenkl. persönl. monatl. Nettoeinkommen",
      "Time": "",
      "Valid": "true"
    },
    {
      "Code": "12211-0100",
      "Content": "Bevölkerung ab 15 Jahren in Hauptwohnsitzhaushalten:\nDeutschland, Jahre, Geschlecht, Altersgruppen, Allgemeine\nSchulausbildung",
      "Time": "",
      "Valid": "true"
    },
    {
      "Code": "12211-0101",
      "Content": "Bevölkerung ab 15 Jahren in Hauptwohnsitzhaushalten:\nDeutschland, Jahre, Geschlecht, Altersgruppen, Beruflicher\nBildungsabschluss",
      "Time": "",
      "Valid": "true"
    }
  ],
  "Timeseries": null,
  "Variables": null,
  "Copyright": "© Statistisches Bundesamt (Destatis), 2026"
};

export const FIND_ALL = {
  "Ident": {
    "Service": "find",
    "Method": "find"
  },
  "Status": {
    "Code": 0,
    "Content": "erfolgreich",
    "Type": "Information"
  },
  "Parameter": {
    "username": "********************",
    "password": "********************",
    "term": "Bevölkerungsstand",
    "category": "Alle",
    "pagelength": "2",
    "language": "de"
  },
  "Cubes": null,
  "Statistics": [
    {
      "Code": "12411",
      "Content": "Fortschreibung des Bevölkerungsstandes",
      "Cubes": "28",
      "Information": "true"
    },
    {
      "Code": "12421",
      "Content": "Bevölkerungsvorausberechnungen",
      "Cubes": "28",
      "Information": "true"
    }
  ],
  "Tables": [
    {
      "Code": "12411-0001",
      "Content": "Bevölkerung: Deutschland, Stichtag",
      "Time": "",
      "Valid": "true"
    },
    {
      "Code": "12411-0002",
      "Content": "Bevölkerung: Deutschland, Stichtag, Nationalität",
      "Time": "",
      "Valid": "true"
    }
  ],
  "Timeseries": null,
  "Variables": [
    {
      "Code": "BEV050",
      "Content": "Vorausberechneter Bevölkerungsstand",
      "Type": "Wert",
      "Values": "-1",
      "Information": "false"
    },
    {
      "Code": "BEVSTD",
      "Content": "Bevölkerungsstand",
      "Type": "Wert",
      "Values": "-1",
      "Information": "true"
    }
  ],
  "Copyright": "© Statistisches Bundesamt (Destatis), 2026"
};

export const FIND_NONE = {
  "Ident": {
    "Service": "find",
    "Method": "find"
  },
  "Status": {
    "Code": 0,
    "Content": "erfolgreich",
    "Type": "Information"
  },
  "Parameter": {
    "username": "********************",
    "password": "********************",
    "term": "Xyzzyquux",
    "category": "Tabellen",
    "pagelength": "2",
    "language": "de"
  },
  "Cubes": null,
  "Statistics": null,
  "Tables": null,
  "Timeseries": null,
  "Variables": null,
  "Copyright": "© Statistisches Bundesamt (Destatis), 2026"
};

/** Nothing matched (Status 104), as data and metadata answer it: no Object. */
export const EMPTY_104 = (service: string, method: string): Record<string, unknown> =>
  genesis(service, method, {}, { Code: 104, Content: "Es gibt keine Objekte zum angegebenen Selektionskriterium", Type: "Information" });

export const TABLES_12411 = genesis("catalogue", "tables", {
  List: [
    { Code: "12411-0001", Content: "Bevölkerung: Deutschland, Stichtag", Time: "31.12.1950-31.12.2023" },
    { Code: "12411-0002", Content: "Bevölkerung: Deutschland, Stichtag, Nationalität", Time: "31.12.1970-31.12.2023" },
    { Code: "12411-0005", Content: "Bevölkerung: Deutschland, Stichtag,\nAltersjahre", Time: "31.12.1950-31.12.2023" },
  ],
});

export const DATA_12411_0001 = genesis("data", "table", {
  Object: {
    Code: "12411-0001",
    Content:
      "GENESIS-Tabelle: 12411-0001\nBevölkerung: Deutschland, Stichtag;;\nFortschreibung des Bevölkerungsstandes;;\nDeutschland;;\n;Bevölkerung;\n;Anzahl;\n31.12.2020;83.155.031;\n31.12.2021;83.237.124;\n31.12.2022;84.358.845;\n31.12.2023;84.669.326;\n__________;;\n(C)opyright Statistisches Bundesamt (Destatis), 2026;;\n",
    Structure: null,
  },
});

/** A table with value symbols and keys with leading zeros, as GENESIS writes them. */
export const DATA_SYMBOLS = genesis("data", "table", {
  Object: {
    Code: "12613-0002",
    Content: "Land;Schlüssel;2023;2024\nSchleswig-Holstein;01;1.234,5;...\nHamburg;02;-;.\nBremen;04;/;x\n",
  },
});

export const METADATA_12411_0001 = genesis("metadata", "table", {
  Object: {
    Code: "12411-0001",
    Content: "Bevölkerung: Deutschland, Stichtag",
    Time: { From: "31.12.1950", To: "31.12.2023" },
    Valid: "false",
    Structure: {
      Head: {
        Code: "12411",
        Content: "Fortschreibung des Bevölkerungsstandes",
        Type: "Statistik",
        Values: null,
        Selected: null,
        Structure: [{ Code: "DINSG", Content: "Deutschland insgesamt", Type: "Merkmal", Values: "1", Selected: null, Structure: null, Updated: "see parent" }],
        Updated: "20.06.2024 08:00:05h",
      },
      Columns: [{ Code: "BEVSTD", Content: "Bevölkerungsstand", Type: "Wert", Values: "-1", Selected: null, Structure: null, Updated: "20.06.2024 08:00:05h" }],
      Rows: [{ Code: "STAG", Content: "Stichtag", Type: "Merkmal", Values: "74", Selected: null, Structure: null, Updated: "20.06.2024 08:00:05h" }],
      Subtitel: null,
    },
    Updated: "20.06.2024 08:00:05h",
  },
});

/** The flat CSV ("ffcsv") of 12411-0001 for 2022 and 2023, as the download's ZIP holds it. */
export const FFCSV_12411_0001 =
  "statistics_code;statistics_label;time_code;time_label;time;1_variable_code;1_variable_label;1_variable_attribute_code;1_variable_attribute_label;value;value_unit;value_variable_code;value_variable_label\n" +
  "12411;Fortschreibung des Bevölkerungsstandes;STAG;Stichtag;2022-12-31;DINSG;Deutschland insgesamt;DG;Deutschland;84358845;Anzahl;BEVSTD;Bevölkerungsstand\n" +
  "12411;Fortschreibung des Bevölkerungsstandes;STAG;Stichtag;2023-12-31;DINSG;Deutschland insgesamt;DG;Deutschland;84669326;Anzahl;BEVSTD;Bevölkerungsstand\n";

/** A ZIP archive of `files` (deflated unless `stored`), as GENESIS wraps its downloads. */
export function zipOf(files: Record<string, string | Buffer>, options: { stored?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const packed = options.stored === true ? data : deflateRawSync(data);
    const method = options.stored === true ? 0 : 8;
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
