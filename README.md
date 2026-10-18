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


## Gemischte Live-Spielweisen im Quiz Studio

Beim Klick auf „Live starten“ wird der Standardmodus der Sitzung gewählt: Klassisch, Buzzer oder Schnellantwort. Jede Frage kann im Editor eine eigene Spielweise oder „Standard übernehmen“ erhalten. Die Vorschau im Editor bleibt eine lokale Fragenvorschau; die neuen Regeln gelten für Live-Sitzungen.

Der Moderator kann die Spielweise einer Frage bis zur Freigabe ändern. „Frage freigeben“ startet die serverseitige Zeitmessung und schaltet die Handys frei. Buzzer und Schnellantwort nehmen genau einen verbindlichen Eingang pro Person an. „Abgaben schließen“ hält die Reihenfolge fest und ruft die erste Person/Antwort auf. „Falsch“ ruft automatisch die nächste auf; „Richtig“ vergibt die Fragenpunkte an diese Person und beendet die Runde. „Lösung einblenden“ kann die Runde ohne weitere Punkte beenden. Klassische Runden erlauben weiterhin Änderungen bis zur Sperre und werten alle Antworten bei der Auflösung aus.

Vor Veröffentlichung der Oberfläche muss `supabase/quiz_play_modes.sql` nach den bestehenden Skripten `schema.sql`, `quiz_live_schema.sql`, `security_hardening.sql` und `reliability_upgrade.sql` eingespielt werden. Die Erweiterung fügt keine Tabellen hinzu und benötigt keine Änderung an Teilnehmerkonten oder gespeicherten Quizzen. Bereits laufende Sitzungen und ältere Clients bleiben klassisch; nur neue Sitzungen der neuen Oberfläche setzen `rules_version: 1`.

Die Zeitstempel stammen von PostgreSQL. Die Eingangsreihenfolge berücksichtigt Netzlaufzeiten. Gleichzeitige Eingänge werden nach Zeitstempel und anschließend stabil nach Antwort-ID sortiert. Wiederholungen desselben Eingangs ändern dessen Zeitpunkt und Inhalt nicht.

Die CI prüft gemischte Runden in einer separaten PostgreSQL-17-Datenbank einschließlich paralleler Abgaben. `tests/quiz-modes-db.sql` erstellt hierfür eine leere Testumgebung mit Testrollen und darf ausschließlich in einer dafür vorgesehenen Testdatenbank ausgeführt werden. Die Browserprüfung `tests/quiz-modes.browser.cjs` spielt mit einem Moderator und zwei mobilen Teilnehmerseiten eine Buzzer-, Schnellantwort- und klassische Runde durch.
