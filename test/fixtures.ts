// Canned GENESIS response bodies used across the unit tests. Shapes mirror the
// live API's common envelope (Ident/Status/Parameter/Copyright + List|Object),
// trimmed to the fields the tests assert on.

const COPYRIGHT =
  "© Statistisches Bundesamt (Destatis), 2020; Datenlizenz Deutschland – Namensnennung – Version 2.0";

/** Wrap a payload in the standard GENESIS envelope with a chosen Status. */
export function envelope(
  payload: Record<string, unknown>,
  status: { Code?: number; Content?: string; Type?: string } = {},
): Record<string, unknown> {
  return {
    Ident: { Service: "test", Method: "test" },
    Status: {
      Code: status.Code ?? 0,
      Content: status.Content ?? "erfolgreich",
      Type: status.Type ?? "Information",
    },
    Parameter: { username: "********" },
    Copyright: COPYRIGHT,
    ...payload,
  };
}

export const tablesList = envelope({
  List: [{ Code: "12411-0001", Content: "Bevölkerung: Deutschland, Stichtag", Time: "1834 - 2023" }],
});

export const findResult = envelope({
  Tables: [{ Code: "12411-0001", Content: "Bevölkerung" }],
  Statistics: [{ Code: "12411", Content: "Fortschreibung des Bevölkerungsstandes", Cubes: "3" }],
  Cubes: null,
  Timeseries: null,
  Variables: null,
});

export const dataTable = envelope({
  Object: { Content: "Statistik;12411;;;\nStichtag;Deutschland;Anzahl\n31.12.2023;84.669.326;\n" },
});

export const metadataTable = envelope({
  Object: { Code: "12411-0001", Content: "Bevölkerung: Deutschland, Stichtag" },
});

// --- Status variants ------------------------------------------------------------

export const notFound = envelope({}, { Code: 90, Type: "Fehler", Content: "Der angeforderte Wert wurde nicht gefunden." });
export const tooLarge = envelope({}, { Code: 98, Type: "Information", Content: "Die Tabelle ist zu groß für einen direkten Abruf." });
export const emptyResult = envelope({ List: [] }, { Code: 104, Type: "Information", Content: "Es wurden keine Ergebnisse gefunden." });
export const genericError = envelope({}, { Code: -1, Type: "Fehler", Content: "Ein unerwarteter Fehler ist aufgetreten." });
export const warning = envelope(
  { List: [{ Code: "12411-0001", Content: "Bevölkerung" }] },
  { Code: 22, Type: "Warnung", Content: "Der Parameter wurde automatisch korrigiert." },
);

// --- helloworld (no envelope) ---------------------------------------------------

export const whoami = { "User-Agent": "destatis-genesis-cli", "User-IP": "203.0.113.7" };
export const loginOk = { Status: "Sie wurden erfolgreich an- und abgemeldet!", Username: "TESTUSER12" };
