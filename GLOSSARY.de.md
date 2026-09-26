# Glossar

Begriffe von GENESIS-Online und das Vokabular, das diese CLI verwendet. GENESIS ist eine
mehrdimensionale Statistikdatenbank: **Statistiken** bestehen aus **Datenquadern**, die
in **Tabellen** aufbereitet und durch **Merkmale** und deren **Ausprägungen** beschrieben werden.

## Objekte

| Begriff | GENESIS | Bedeutung |
|---|---|---|
| **Statistik** | `statistic` | Ein vollständiges statistisches Produkt, identifiziert über einen fünfstelligen EVAS-Code (z. B. `12411`, „Fortschreibung des Bevölkerungsstandes“). Enthält Datenquader. |
| **Tabelle** | `table` | Eine fertige zweidimensionale Ansicht mit einem Code wie `12411-0001`. Das, was Sie hauptsächlich abrufen. |
| **Datenquader** | `cube` | Die mehrdimensionalen Rohdaten hinter den Tabellen, mit einem Code wie `12411BJ001`. |
| **Zeitreihe** | `timeseries` | Ein Datenquader, reduziert auf einen einzelnen Wert im Zeitverlauf. |
| **Merkmal** | `variable` | Eine Dimension bzw. ein Attribut (z. B. `DLAND` = Bundesland, `NAT` = Staatsangehörigkeit). |
| **Ausprägung** | `value` | Ein konkreter Wert eines Merkmals (z. B. ein bestimmtes Bundesland). |
| **Ergebnistabelle** | `result` | Eine von einem asynchronen Job erzeugte Tabelle, gespeichert in Ihrem Nutzerbereich. |

## Codes und Auswahl

- **EVAS-Code** – der numerische Objektschlüssel. `12` (Sachgebiet) → `12411`
  (Statistik) → `12411-0001` (Tabelle) / `12411BJ001` (Datenquader).
- **`selection`** – ein Code-Filter zum Durchsuchen mit `catalogue`; unterstützt den
  Platzhalter `*`, z. B. trifft `124*` auf alle Objekte zu, deren Code mit `124` beginnt.
- **`name`** – der exakte Objektcode, der an `metadata`/`data` übergeben wird.
- **`classifyingvariable{n}` / `classifyingkey{n}`** – beschränken eine `data`-Anfrage
  auf bestimmte Ausprägungen von Merkmalen (der „Key“ wählt die Ausprägungen aus,
  Platzhalter `*` erlaubt).
- **`regionalvariable` / `regionalkey`** – die regionale Dimension und die
  einzubeziehenden Regionen (z. B. der Schlüssel eines Landes oder Kreises).

## Die Antworthülle

Jede Antwort außer von `helloworld` steckt in einer Hülle:

| Feld | Bedeutung |
|---|---|
| `Ident` | `{ Service, Method }` – welcher Endpoint geantwortet hat. |
| `Status` | `{ Code, Content, Type }` – das **logische** Ergebnis (siehe unten). |
| `Parameter` | Echo Ihrer Anfrage (Zugangsdaten maskiert als `********`). |
| `Copyright` | der anzugebende Quellenvermerk – siehe [DATA_LICENSE.md](DATA_LICENSE.md). |
| `List` | Katalogergebnisse (ein homogenes Array). |
| `Object` | Nutzdaten für Daten und Metadaten (nicht näher typisiert; bei `data/table` ein CSV-String in `Object.Content`). |

`helloworld/whoami` und `helloworld/logincheck` verwenden diese Hülle **nicht**.

## Werte von `Status.Code`

Der HTTP-Status ist fast immer `200`; das tatsächliche Ergebnis steht in `Status.Code`.
Ausnahme sind Authentifizierungsfehler: Sie kommen als flacher Body `{ Code, Content, Type }`
(ohne Hülle) mit HTTP 401 oder 404 zurück:

| Code | Typ | Bedeutung | Diese CLI |
|---|---|---|---|
| `0` | Information | Erfolg | liefert Daten |
| `22` | Warnung | Erfolg, ein Parameter wurde automatisch korrigiert | liefert Daten (Warnung in `Status.Content` sichtbar) |
| `50` | Information | keine neueren Daten (bei `--stand`) | liefert Daten |
| `104` | Information | kein Objekt gefunden, das passt | liefert ein **leeres** Ergebnis (Exit 0) |
| `90` | Fehler | angefordertes Objekt nicht gefunden | Fehler, **Exit 4** |
| `98` | Information | Ergebnis zu groß für einen direkten Abruf | Fehler mit Hinweisen zum Eingrenzen, Exit 1 |
| `15` | ERROR | nicht berechtigt: Zugangsdaten fehlen oder werden nicht erkannt (flacher Body bei HTTP 401) | Fehler `GENESIS status 15 (ERROR) / HTTP 401` mit dem GENESIS-Text und einem Hinweis auf die Zugangsdaten, Exit 1 |
| `2` | ERROR | falscher Nutzername bzw. falsches Passwort oder Token (flacher Body bei HTTP **404**) | Fehler `GENESIS status 2 (ERROR) / HTTP 404` mit dem GENESIS-Text und einem Hinweis auf die Zugangsdaten, Exit 1 (ein 404 mit GENESIS-Code heißt nicht „nicht gefunden“) |
| beliebig | Fehler / Error | allgemeiner Fehler | Fehler, Exit 1 |

## Platzhalter für den Wertstatus

In einer CSV aus `data/table` kann eine Zelle statt einer Zahl ein Statuszeichen enthalten:
`-` (nichts vorhanden / tatsächlich null), `.` (unbekannt oder geheim), `...`
(noch nicht verfügbar), `/` (keine Angabe, da Zahlenwert nicht sicher genug), `x` (keine
sinnvolle Aussage möglich), `()` (eingeschränkter Aussagewert), `p` (vorläufig),
`r` (berichtigt), `s` (geschätzt).

## Begriffe zur Authentifizierung

- **API-Token** – ein persönliches Token aus 32 Zeichen, das Sie in der GENESIS-Weboberfläche
  („Webservice/API“) erzeugen. Es wird ohne Passwort im Anfragefeld `username` übertragen.
  Wenn Sie ein neues Token erzeugen, wird das alte ungültig.
- **Benutzername / Passwort** – die Anmeldedaten des Kontos (Benutzername etwa 10 Zeichen,
  kann eine E-Mail-Adresse sein; Passwort 10–50 Zeichen). Nur gemeinsam anzugeben.

Wie Zugangsdaten übertragen werden und warum Weiterleitungen nicht gefolgt wird, beschreibt
[DEVELOPING.md](DEVELOPING.md) (englisch).
