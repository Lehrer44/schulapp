# SchulApp

SchulApp bündelt Umfragen, Quiz Studio und Jeopardy. `index.html` ist das gemeinsame Haupt-Dashboard. Die Anmeldung gilt für alle Anwendungen auf derselben Website.

| Verzeichnis | Inhalt |
| --- | --- |
| `apps/umfrage/` | Eigenes Dashboard (`index.html`), Editor, Live-Steuerung und Teilnehmerseite |
| `apps/quiz-studio/` | Quizbibliothek und Editor (`index.html`), Live-Quiz und Teilnehmerseite |
| `apps/jeopardy/` | Spielbibliothek, Editor und Teamspiel (`index.html`) |
| `shared/` | Gemeinsam verwendetes JavaScript und CSS |
| `supabase/` | Bestehende Datenbank- und Berechtigungsskripte |
| `tests/` | Komponenten-, Struktur- und Browserprüfungen |

`login.html` ist die gemeinsame Anmeldung. `join.html` leitet Teilnehmende anhand ihres Codes zur passenden Anwendung. Die QR-Links berücksichtigen Unterverzeichnisse und den jeweiligen Hosting-Pfad.

Die früheren HTML-Adressen im Hauptverzeichnis enthalten nur Weiterleitungen. Sie erhalten URL-Parameter und Fragment, damit bestehende QR-Codes und Lesezeichen weiter funktionieren. Die Anwendung selbst liegt ausschließlich im jeweiligen App-Ordner.

Neue Anwendungen bekommen einen Ordner `apps/<name>/` mit einem eigenen `index.html` und eine Karte auf dem Haupt-Dashboard. Lehrkraftseiten verlinken zurück zum Haupt-Dashboard.

Die Umstrukturierung verändert weder das Supabase-Projekt noch Tabellen, Buckets, Konten oder gespeicherte Inhalte. Auch bestehende Browser-Speicherschlüssel bleiben erhalten.


## Live-Spielweisen im Quiz Studio

Die Spielweise wird pro Frage im Editor gewählt: Klassisch, Buzzer oder Schnellantwort. Fehlende oder frühere „Standard übernehmen“-Einstellungen werden als klassisch behandelt. Beim Klick auf „Live mit Schülern“ wird direkt eine Wartelobby angelegt. Erst „Quiz starten“ zeigt die erste Frage und öffnet gleichzeitig die Antworten. „Weiter“ zeigt und öffnet jeweils die nächste Frage. Beim Zurückgehen bleiben bereits erfolgte Bewertungen und Zeitstempel erhalten.

Klassische Fragen werten bei der Auflösung alle abgegebenen Antworten aus. Beim Buzzer wird die schnellste Person automatisch aufgerufen; sie antwortet mündlich. Bei Schnellantwort wird die erste eingesendete Antwort automatisch angezeigt. „Falsch“ ruft den nächsten Eingang auf. Solange die Runde offen ist, können sich weitere Personen einreihen. „Richtig“ vergibt die Fragenpunkte ausschließlich an die aufgerufene Person und beendet die Runde. Die Antworten weiterer Personen bleiben bis zu ihrem Aufruf verdeckt. Falls niemand mehr antwortet, kann der Moderator mit „Lösung“ beenden.

`supabase/quiz_play_modes.sql` wird nach `schema.sql`, `quiz_live_schema.sql`, `security_hardening.sql` und `reliability_upgrade.sql` eingespielt. Es entfernt die früheren RPCs zur manuellen Moduswahl, Einzelfreigabe und zum Start der Auswertung. Die Erweiterung benötigt keine neuen Tabellen oder Datenmigrationen. Bestehende Quizze bleiben nutzbar.

Die Zeitstempel stammen von PostgreSQL und bestimmen die Reihenfolge der serverseitig angenommenen Eingänge. Netzlaufzeiten können das Ergebnis beeinflussen. Wiederholungen verändern den ersten Eingang nicht.

Die CI prüft Regeln und parallele Abgaben in einer separaten PostgreSQL-17-Datenbank. `tests/quiz-modes-db.sql` darf ausschließlich in einer dafür vorgesehenen leeren Testdatenbank ausgeführt werden. Die Browserprüfung spielt mit Moderator und zwei mobilen Teilnehmerseiten alle drei Spielweisen durch.



## Pin-Fragen und Live-Sitzungen

`supabase/quiz_pin.sql` wird nach `quiz_play_modes.sql` eingespielt. Pin-Fragen enthalten ein Rasterbild (`media`), das Bildseitenverhältnis (`pinAspect`, Breite/Höhe) und einen Lösungsbereich (`pinTarget` mit `x`, `y`, `radius`). Koordinaten sind Prozentwerte der jeweiligen Bildachse; der Radius bezieht sich auf die Bildbreite. Dadurch bleibt der grüne Bereich bei jeder Bildschirmgröße ein Kreis. Der Rand zählt als Treffer. Jede Person innerhalb des Bereichs erhält die eingestellten Fragenpunkte; Pin-Fragen verwenden immer die klassische Auswertung.

Im Editor ein Bild auswählen oder einfügen, den richtigen Ort anklicken und den Radius einstellen. Ein Bildwechsel entfernt den bisherigen Lösungsbereich. Auf Schülergeräten wird der Lösungsbereich erst nach der Auflösung ausgeliefert. Die Lehrkraft sieht bei der Auflösung die farbigen, nummerierten Pins mit Namen. Pins können per Klick, Touch, Pfeiltasten oder Prozentfeldern gesetzt werden.

Die Vorschau hat unabhängig von der Antwortprüfung Zurück/Weiter. Antworten und bereits geprüfte Ergebnisse bleiben beim Wechsel erhalten. „Beenden“ im Live-Quiz beendet die Sitzung serverseitig und kehrt erst nach bestätigtem Erfolg ins Quiz Studio zurück. Nicht aufgelöste Fragen erhalten keine nachträglichen Punkte. Beendete Sitzungen lassen sich nicht wieder öffnen. Der bisherige manuelle Aktualisieren-Button entfällt, da die Ansicht automatisch synchronisiert wird.


## Bluff-Quiz

Im Quiz Studio steht „Deine Quizze“ zuerst und „Bluff-Quiz“ darunter. Beide Listen verwenden dieselben Karten. „Zufälliges Spiel“ öffnet die Rundenauswahl (Standard 10, 1–50 möglich) und erstellt eine Lobby mit zufällig ausgewählten Fragen ohne Wiederholungen. „+ Neues Bluff-Quiz“ speichert einen Namen und 1–50 ausgewählte Fragen als wiederverwendbares Quiz; die Liste bietet Starten, Bearbeiten und Löschen. Gespeicherte Quizze behalten Fragekopien, auch wenn Fragen später aus der Sammlung entfernt werden. Beim Bearbeiten eines Quiz werden weiterhin verfügbare Fragen aus dem aktuellen Stand der Sammlung übernommen.

„Fragen bearbeiten“ öffnet den Editor mit Frage und Lösung. Zehn recherchierte Startfragen sind verfügbar. Änderungen an einer Startfrage erstellen eine persönliche Ersatzfrage und blenden das Original nur im eigenen Konto aus; Löschen gilt ebenfalls nur für das eigene Konto. In der Lobby öffnet „Teilnahme“ ein Fenster mit Raum-Code, QR-Code und Teilnahmelink.

`supabase/bluff.sql` wird nach `reliability_upgrade.sql` eingespielt, anschließend `supabase/bluff_library.sql` für gespeicherte Quizze und persönliche Startfragen sowie `supabase/bluff_flow.sql` für den anonymen Rundenablauf. Die Fragen, Sitzungssnapshots, Teilnehmer-Tokens (nur Hashes), Bluffs, Optionen und Stimmen liegen in `private`. Die öffentliche Realtime-Tabelle `bluff_live_signals` enthält ausschließlich zufällige Raum-UUIDs und Versionsnummern. Sie ist nur lesbar; Änderungen stammen aus autorisierten RPCs. Jeder Realtime-Hinweis lädt den berechtigten Zustand neu. Ein zweisekündiger Abruf überbrückt Realtime-Ausfälle. Die Postgres-Publikation `supabase_realtime` wird bei Bedarf ergänzt.

Spielphasen: Lobby → Frage mit offener Eingabe → anonyme Antwortvorschau → Abstimmung → einzelne Enthüllungen → Rundenwertung → nächste Frage mit offener Eingabe oder Ende. „Spiel starten“ und „Nächste Runde“ öffnen die Frage und das Antwortfeld direkt. Während der Eingabe erhalten auch Moderatoren keine Antworttexte oder Autorenzuordnungen. „Antworten anzeigen“ ist erst nach Abgabe aller Teilnehmenden möglich und mischt die Bluffs mit genau einer echten Antwort. Erst „Abstimmung starten“ erlaubt Stimmen; bis dahin sind neue oder geänderte Eingaben bereits gesperrt. Autorennamen und Stimmen werden ausschließlich bei der jeweiligen Enthüllung sichtbar. Timer sperren abgelaufene Eingaben serverseitig; ein Eingabe-Timer veröffentlicht keine Antworten automatisch. Die Spielleitung kann mehr Zeit geben. Der Abstimmungs-Timer kann wie bisher zur Enthüllung weitergehen.

Gleiche Antworten (normalisiert nach Groß-/Kleinschreibung, Leerzeichen und Satzzeichen) erscheinen als eine Option. Alle Autoren dieser Option dürfen sie nicht wählen. Eingaben, die exakt der normalisierten Wahrheit entsprechen, werden mit einer Rückmeldung abgelehnt. Die Abstimmung enthält genau eine wahre Option, keine Autorennamen und keine Stimmabgaben anderer Personen. Erst die einzeln freigegebenen Karten verraten Herkunft und Wählende. Nach der letzten Enthüllung gibt es +1 für jede richtige Stimme und +2 pro getäuschtem Mitspieler für jeden Autor des gewählten Bluffs. Die Auswertung erfolgt genau einmal, unter Sperre der Sitzung. Bereits abgegebene Stimmen sind verbindlich; Bluffs dürfen während der Eingabephase geändert werden.

Neue Teilnehmende können nur in der Lobby beitreten. Eine bestehende Teilnahme ist mit ihrem 256-Bit-Token im selben Browser-Tab auch nach Neuladen fortsetzbar. Beenden erhält bereits vergebene Punkte und vergibt keine weiteren Punkte für eine nicht fertig enthüllte Runde.

Tests: `tests/bluff-db.sql` benötigt eine eigene leere Testdatenbank. Es prüft den vollständigen Ablauf, anonyme Zugriffe, Wahrheitsschutz, Eigentümerschaft, Duplikate, Timer, Eigenstimmen und wiederholte Aktionen. `tests/bluff.browser.cjs` verbindet die echten PostgreSQL-RPCs über eine lokale Testbrücke mit einer Spielleiterseite und drei mobilen Browserkontexten. Die Brücke ist ausschließlich Testcode und wird von keiner App-Seite geladen.
