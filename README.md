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

Im Quiz Studio führt die Kachel „Bluff-Quiz“ zu `apps/quiz-studio/bluff/`. Der Editor sammelt Fragen, die echte Antwort, eine optionale Kategorie und einen Quellenlink. Zehn recherchierte Startfragen liegen in der Datenbank, eigene Fragen gehören zum jeweiligen Lehrerkonto. Startfragen können als eigene Frage übernommen werden. Spielstart: Rundenzahl (Standard 10, 1–50 möglich), zufällige Auswahl ohne Wiederholungen oder genau die gewünschte Anzahl selbst wählen. Für 20 Runden sind mindestens 20 Fragen nötig.

`supabase/bluff.sql` wird nach `reliability_upgrade.sql` eingespielt. Die Fragen, Sitzungssnapshots, Teilnehmer-Tokens (nur Hashes), Bluffs, Optionen und Stimmen liegen in `private`. Die öffentliche Realtime-Tabelle `bluff_live_signals` enthält ausschließlich zufällige Raum-UUIDs und Versionsnummern. Sie ist nur lesbar; Änderungen stammen aus autorisierten RPCs. Jeder Realtime-Hinweis lädt den berechtigten Zustand neu. Ein zweisekündiger Abruf überbrückt Realtime-Ausfälle. Die Postgres-Publikation `supabase_realtime` wird bei Bedarf ergänzt.

Spielphasen: Lobby → Frage → Bluff → Abstimmung → einzelne Enthüllungen → Rundenwertung → nächste Frage oder Ende. Die Spielleitung öffnet die Phasen und steuert Timer. Timer sperren Abgaben serverseitig; eine geöffnete Spielleiteransicht schaltet bei Ablauf automatisch weiter. Ohne eingegangenen Bluff bleibt die Eingabephase bestehen; die Spielleitung kann mehr Zeit geben. Die Leitung sieht während der Eingabe Autorennamen und Texte. Diese Ansicht daher erst ab der Abstimmung projizieren, wenn die Bluffs geheim bleiben sollen.

Gleiche Antworten (normalisiert nach Groß-/Kleinschreibung, Leerzeichen und Satzzeichen) erscheinen als eine Option. Alle Autoren dieser Option dürfen sie nicht wählen. Eingaben, die exakt der normalisierten Wahrheit entsprechen, werden mit einer Rückmeldung abgelehnt. Die Abstimmung enthält genau eine wahre Option, keine Autorennamen und keine Stimmabgaben anderer Personen. Erst die einzeln freigegebenen Karten verraten Herkunft und Wählende. Nach der letzten Enthüllung gibt es +1 für jede richtige Stimme und +2 pro getäuschtem Mitspieler für jeden Autor des gewählten Bluffs. Die Auswertung erfolgt genau einmal, unter Sperre der Sitzung. Bereits abgegebene Stimmen sind verbindlich; Bluffs dürfen während der Eingabephase geändert werden.

Neue Teilnehmende können nur in der Lobby beitreten. Eine bestehende Teilnahme ist mit ihrem 256-Bit-Token im selben Browser-Tab auch nach Neuladen fortsetzbar. Beenden erhält bereits vergebene Punkte und vergibt keine weiteren Punkte für eine nicht fertig enthüllte Runde.

Tests: `tests/bluff-db.sql` benötigt eine eigene leere Testdatenbank. Es prüft den vollständigen Ablauf, anonyme Zugriffe, Wahrheitsschutz, Eigentümerschaft, Duplikate, Timer, Eigenstimmen und wiederholte Aktionen. `tests/bluff.browser.cjs` verbindet die echten PostgreSQL-RPCs über eine lokale Testbrücke mit einer Spielleiterseite und drei mobilen Browserkontexten. Die Brücke ist ausschließlich Testcode und wird von keiner App-Seite geladen.
