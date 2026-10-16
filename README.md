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
