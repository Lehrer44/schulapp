# SchulUmfrage

Statische Unterrichtsanwendung auf GitHub Pages mit Supabase Auth, Datenbank,
Storage und Realtime. Die HTML-Dateien verwenden ausschließlich einen öffentlichen
Supabase-Publishable-Key. Service-Role- oder Secret-Keys gehören niemals ins Frontend.

## Datenbank installieren oder aktualisieren

Die SQL-Dateien in dieser Reihenfolge ausführen:

1. `schema.sql`
2. `quiz_live_schema.sql`
3. **`security_hardening.sql`**
4. **`reliability_upgrade.sql`**

Der letzte Schritt ist erforderlich und wiederholbar. Er installiert die
Token-geschützten Schüler-RPCs, sperrt alte Zugänge über Teilnehmer-IDs und schützt
historische Medien vor Löschen und Überschreiben. Eine Wiederholung der ersten
beiden Dateien erfordert anschließend ebenfalls Schritt 3 und 4.

## Schülerzugang und Steuerung

Beim Beitritt erzeugt der Browser mit Web Crypto ein zufälliges 256-Bit-Token.
Es bleibt im `sessionStorage` des jeweiligen Tabs. Die Datenbank speichert nur den
SHA-256-Hash im nicht öffentlich zugänglichen Schema `private`.
Teilnehmer-ID und Anzeigename sind keine Zugangsnachweise.

Umfragezustand, gespeicherte Antworten sowie Markierungen und Rücksetzungen durch
Lehrkräfte werden über `survey_student_state` bestätigt. Die Schülerseiten
verwenden keine Broadcast-Steuerbefehle. Quiz-Zugriffe erfolgen über die
Token-geschützten RPCs mit dem Suffix `_secure`.

Nach dem Sicherheitsupgrade müssen alte Schülerseiten neu geladen werden.
Teilnehmer aus älteren Sitzungen besitzen kein Token und können nicht allein mit
Namen oder ID übernommen werden. Sie müssen mit einem neuen Anzeigenamen beitreten;
alternativ startet die Lehrkraft eine neue Sitzung. Vorhandene Antworten bleiben
in der bisherigen Sitzung erhalten. Innerhalb eines neuen Tabs muss erneut
beigetreten werden; im selben Tab funktioniert Neuladen und Wiederaufnahme.

Beitritte werden vor der Codeprüfung auf 120 Versuche pro Minute und IP-Bucket
sowie insgesamt 600 pro Minute und Anwendungstyp begrenzt. Der globale Grenzwert
wirkt unabhängig von IP-Headern. Fehler werden als strukturierte Ergebnisse
zurückgegeben, damit die Zähler nicht durch Exceptions zurückgerollt werden.

## Medien

Medienuploads verwenden eindeutige, unveränderliche Objektpfade. Beim Ersetzen,
Entfernen einer Medienzuordnung oder Löschen einer Folie bleiben ältere Dateien
erhalten. So funktionieren gespeicherte Umfragen und Sitzungskopien weiter.
Der Storage-Zugriff schützt diese Versionen zusätzlich gegen Löschen und
Überschreiben durch Frontendkonten.

Nicht mehr verwendete Dateien werden bewusst nicht automatisch gelöscht.
Eine spätere serverseitige Bereinigung muss sämtliche Umfragen und
Sitzungskopien auf Referenzen prüfen. `survey-media` bleibt wie zuvor ein
öffentlicher Bucket; dort nur für die öffentliche Bereitstellung geeignete
Unterrichtsmedien ablegen.

Jeopardy akzeptiert eingebettete Medien ausschließlich als validierte Base64-
Data-URLs mit freigegebenen Bild-, Audio- und Videoformaten. SVG, externe URLs und
HTML-Attribute in importierten Medienwerten werden verworfen.

## Überprüfung

Frontend- und Regressionstests:

```sh
node tests/security.test.cjs
```

`tests/security.sql` prüft die Datenbankregeln mit synthetischen Datensätzen.
Nach Installation des Schemas ausschließlich in einer Transaktion ausführen:

```sql
begin;
-- Inhalt von tests/security.sql
rollback;
```

Die Tests prüfen Fremdzugriffe, fehlende Tokens, wiederholte Beitritte,
Antwortabgabe, Lehrkraft-Markierungen und -Rücksetzungen, Lösungsschutz,
Altrechte, Medienregeln und das persistente Beitrittslimit.

## Zuverlässigkeit und Bedienung

`reliability_upgrade.sql` ergänzt versionsgeprüfte Bibliotheken in
`teacher_libraries`. Vorhandene Quiz- und Jeopardy-Dateien werden beim ersten
Öffnen gelesen und bei der nächsten Speicherung in die neue Bibliothek
übernommen. Die bisherigen Storage-Dateien bleiben als Sicherung erhalten.

Jeder Schreibvorgang muss die geladene Revision angeben. Veraltete Tabs dürfen
keine neuere Version überschreiben. Nach einem Konflikt bleiben Änderungen im
Tab erhalten: zuerst eine JSON-Sicherung exportieren, anschließend neu laden.
Wiederholte Speicheranfragen nach verlorenen Antworten werden über dieselbe
Vorgangs-ID erkannt. Alte, bereits geöffnete Editor-Tabs vor der Veröffentlichung
schließen und danach neu öffnen.

Quiz-Statusabfragen berechnen einen abgelaufenen Timer ohne den gemeinsamen
Zustand zu verändern. Timer- und Navigationsaktionen sind an die erwartete Frage
gebunden. Live-Quiz-Ranglisten werden serverseitig berechnet; aktuelle Antworten
werden vollständig ohne die REST-Grenze von 1000 Zeilen zurückgegeben.
Umfrage-Abfragen laden die aktuelle Folie und paginieren größere Ergebnisse.

`join.html` ist der gemeinsame Schülereinstieg. Code und optionaler Aktivitätstyp
stehen in den QR-Links. Bei gleichen Codes in Quiz und Umfrage wird die Aktivität
explizit ausgewählt. Pins können per Maus, Pfeiltasten oder Koordinateneingabe
gesetzt werden. Dunklere Texte, sichtbarer Tastaturfokus, Formularbeschriftungen
und reduzierte Animationen gelten auf allen Seiten.

Weitere Komponententests:

```sh
node tests/library.test.cjs
node tests/status.test.cjs
node tests/live-data.test.cjs
node tests/pin-input.test.cjs
```

Der GitHub-Prüflauf führt zusätzlich `tests/browser.test.cjs` mit Playwright
1.62.1 und Chromium aus. Er prüft ausschließlich synthetische Daten und simulierte
API-Antworten, darunter Schülerbeitritt, Tastatur-Pins, Offline-Eingaben,
Timeraktionen, doppelte Navigation und die mobile Ansicht. Echte Schülerdaten
oder Anmeldeinformationen werden dafür nicht verwendet.

Veröffentlichung: zuerst die kompatible Datenbankergänzung
`reliability_upgrade.sql` anwenden, dann die neuen Frontend-Dateien veröffentlichen.
Anschließend `tests/security.sql` in BEGIN/ROLLBACK erneut prüfen.
