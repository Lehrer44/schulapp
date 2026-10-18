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
