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


## Quiz Studio: Spielübersicht

Die Übersicht zeigt fünf Kacheln in dieser Reihenfolge: Quiz, Manipulation, Wer würde eher, Dieselbe Antwort und Ja oder Nein. Auf großen Bildschirmen stehen drei Kacheln nebeneinander, auf mittleren zwei und auf schmalen eine. Zufälliges Spiel (gekreuzte Pfeile), Fragenkatalog (Bücher) und Neues Spiel (Plus) stehen direkt im Kachelkopf; die Symbolbuttons haben Tooltips und zugängliche Namen. Gespeicherte Spiele erscheinen als kompakte Zeilen mit Start, Bearbeiten und Löschen.

Manipulation hieß zuvor Bluff-Quiz, Dieselbe Antwort hieß Das gleiche Antworten und Ja oder Nein hieß Ja/Nein-Schätzspiel. Bestehende Links, Spielkennungen und gespeicherte Inhalte bleiben kompatibel. Für diese Layoutänderung ist kein SQL-Update nötig.

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

`supabase/bluff.sql` wird nach `reliability_upgrade.sql` eingespielt, anschließend `supabase/bluff_library.sql` für gespeicherte Quizze und persönliche Startfragen sowie `supabase/bluff_flow.sql` für den anonymen Rundenablauf und `supabase/bluff_reveal.sql` für die gemeinsame Auswertung. Danach wird `supabase/bluff_uppercase.sql` für einheitliche Großschreibung angewendet. Die Fragen, Sitzungssnapshots, Teilnehmer-Tokens (nur Hashes), Bluffs, Optionen und Stimmen liegen in `private`. Die öffentliche Realtime-Tabelle `bluff_live_signals` enthält ausschließlich zufällige Raum-UUIDs und Versionsnummern. Sie ist nur lesbar; Änderungen stammen aus autorisierten RPCs. Jeder Realtime-Hinweis lädt den berechtigten Zustand neu. Ein zweisekündiger Abruf überbrückt Realtime-Ausfälle. Die Postgres-Publikation `supabase_realtime` wird bei Bedarf ergänzt.

Spielphasen: Lobby → Frage mit offener Eingabe → anonyme Antwortvorschau → Abstimmung → gemeinsame Enthüllung → Rundenwertung → nächste Frage mit offener Eingabe oder Ende. „Spiel starten“ und „Nächste Runde“ öffnen die Frage und das Antwortfeld direkt. Während der Eingabe erhalten auch Moderatoren keine Antworttexte oder Autorenzuordnungen. „Antworten anzeigen“ ist erst nach Abgabe aller Teilnehmenden möglich und mischt die Bluffs mit genau einer echten Antwort. Erst „Abstimmung starten“ erlaubt Stimmen; bis dahin sind neue oder geänderte Eingaben bereits gesperrt. Autorennamen und Stimmen werden ausschließlich bei der gemeinsamen Enthüllung sichtbar. Timer sperren abgelaufene Eingaben serverseitig; ein Eingabe-Timer veröffentlicht keine Antworten automatisch. Die Spielleitung kann mehr Zeit geben. Der Abstimmungs-Timer kann wie bisher zur Enthüllung weitergehen.

Bluffs und Lösungen erscheinen durchgehend in Großbuchstaben. Eingaben und eingefügte Texte werden unmittelbar umgewandelt, auch im Lösungseditor. Der Server normalisiert Bluffs ebenfalls; Umlaute bleiben erhalten, ß und ẞ werden zu SS. Vorhandene Fragen und Sitzungen werden bei der Anzeige normalisiert, ohne gespeicherte Stimmen oder Antwort-IDs zu verändern. Zahlen und Satzzeichen sind weiterhin erlaubt. Die Grenze von 180 Zeichen wird nach der Umwandlung geprüft.

Gleiche Antworten (normalisiert nach Groß-/Kleinschreibung, Leerzeichen und Satzzeichen) erscheinen als eine Option. Alle Autoren dieser Option dürfen sie nicht wählen. Eingaben, die exakt der normalisierten Wahrheit entsprechen, werden mit einer Rückmeldung abgelehnt. Die Abstimmung enthält genau eine wahre Option, keine Autorennamen und keine Stimmabgaben anderer Personen. Beim Schließen der Abstimmung werden alle Karten gemeinsam aufgedeckt. Links stehen Antwort und Autorenname, rechts deutlich größere Namen der Abstimmenden. Dabei gibt es +1 für jede richtige Stimme und +2 pro getäuschtem Mitspieler für jeden Autor des gewählten Bluffs. Die Auswertung erfolgt genau einmal, unter Sperre der Sitzung. Bereits abgegebene Stimmen sind verbindlich; Bluffs dürfen während der Eingabephase geändert werden.

Neue Teilnehmende können nur in der Lobby beitreten. Eine bestehende Teilnahme ist mit ihrem 256-Bit-Token im selben Browser-Tab auch nach Neuladen fortsetzbar. Beenden erhält bereits vergebene Punkte und vergibt keine weiteren Punkte für eine nicht fertig enthüllte Runde.

Tests: `tests/bluff-db.sql` benötigt eine eigene leere Testdatenbank. Es prüft den vollständigen Ablauf, anonyme Zugriffe, Wahrheitsschutz, Eigentümerschaft, Duplikate, Timer, Eigenstimmen und wiederholte Aktionen. `tests/bluff.browser.cjs` verbindet die echten PostgreSQL-RPCs über eine lokale Testbrücke mit einer Spielleiterseite und drei mobilen Browserkontexten. Die Brücke ist ausschließlich Testcode und wird von keiner App-Seite geladen.

Die Bluff-Spieleransicht enthält keine Dashboard- oder Editor-Navigation. Das Dashboard zeigt die Anwendungsauswahl erst nach erfolgreicher Anmeldung; anonyme Spielteilnahmen geben sie nicht frei. Lehrkraftansichten bleiben über Anmeldung und serverseitige Besitzprüfung geschützt.

## Wer würde eher

Im Quiz Studio bietet „Wer würde eher“ zufällige Spiele, benannte Spiele mit 1–50 ausgewählten Aussagen und einen persönlichen, editierbaren Fragenkatalog mit zehn Startaussagen. Gespeicherte Spiele und laufende Sitzungen behalten Kopien ihrer Aussagen. Änderungen und Löschungen im Katalog betreffen ausschließlich das eigene Lehrkraftkonto.

Layout, Wartelobby, Rangliste und Endplatzierung verwenden die Bluff-Quiz-Bausteine. Unter „Teilnahme“ stehen Raum-Code, QR-Code und Link; auch der gemeinsame Einstieg `join.html` erkennt die Räume. Zwei bis 50 Personen können in der Lobby beitreten. Nach Neuladen wird die Teilnahme im selben Browser-Tab mit einem zufälligen 256-Bit-Token fortgesetzt. Die Datenbank speichert ausschließlich dessen Hash.

Die Spielleitung gibt die erste Aussage und jede folgende Runde frei. Jede Person wählt verbindlich eine teilnehmende Person, einschließlich sich selbst. „Auswerten“ schließt die Abstimmung und zeigt zunächst schlichte Namenskacheln untereinander. Die Spielleitung deckt die Stimmenzahl jeder Person per Klick auf deren Kachel auf; die Kachel füllt sich entsprechend ihrem Stimmenanteil. Einzelaufdeckungen sind serverseitig gespeichert, für alle Geräte synchron und bleiben nach Neuladen erhalten. „Namen einblenden“ veröffentlicht anschließend die Abstimmenden und vergibt einmalig die Punkte. Jede Wahl einer Person mit der höchsten Stimmenzahl zählt einen Punkt; bei Gleichstand zählen alle Personen mit dieser Stimmenzahl. Fehlende Stimmen und Runden ohne Stimmen erhalten keine Punkte. Danach geht es direkt zur nächsten Aussage bzw. Endplatzierung; gleiche Punktzahlen erhalten denselben Platz. Vorzeitiges Beenden erhält bereits vergebene Punkte.

`supabase/rather.sql` wird nach `yesno_settings.sql` eingespielt; bestehende Installationen erhalten die Einzelaufdeckung und den direkten Rundenwechsel durch `supabase/rather_layout.sql` nach `rather.sql`. Es ergänzt private Tabellen, berechtigte RPCs, eine nur lesbare Realtime-Signaltabelle und den gemeinsamen Code-Einstieg. Weder einzelne Stimmen noch Abstimmendennamen werden vor der jeweiligen Freigabe ausgeliefert. Sitzungssperren schützen Abgaben und Phasenwechsel gegen parallele und wiederholte Aktionen. Ein zweisekündiger Abruf überbrückt Realtime-Ausfälle. Die öffentlichen RPCs laufen als Invoker; die private Implementierung prüft Besitz oder Teilnehmer-Token.

`tests/rather-db.sql` benötigt eine eigene leere Testdatenbank und prüft den Ablauf, Geheimhaltung, Eigentümerschaft, Fragekopien, Eigenstimmen, Mehrheiten, Gleichstände, Nullstimmen und Doppelwertung. `tests/rather.browser.cjs` prüft Katalog, gespeicherte und zufällige Spiele, decodierten QR-Beitritt, Lobby, Abstimmung, Neuladen, beide Auflösungsschritte und Endplatzierung auf Desktop und Mobilgeräten gegen tatsächliche PostgreSQL-RPCs. Beide Prüfungen laufen in der GitHub-Action.

### Das gleiche Antworten

In Quiz Studio gibt es einen eigenen Fragenkatalog und gespeicherte oder zufällige Spiele für „Das gleiche Antworten“. Assoziationsfragen erlauben freie Texte; bei Teamfragen stehen nur Namen aus dem eigenen Team zur Wahl. Die Spielleitung stellt 2 bis 10 gleich große Teams mit mindestens zwei Mitgliedern zusammen und wählt optional einen Timer (0 bis 600 Sekunden). Alle Teams beantworten dieselbe Frage ohne Absprache.

Alle Teammitglieder gleich: 3 Punkte; andernfalls mindestens zwei gleich: 1 Punkt; sonst 0 Punkte. Diese Regel gilt auch für größere Teams. Fehlende Abgaben bilden keine Übereinstimmung. Groß-/Kleinschreibung und äußere Leerzeichen werden ignoriert. Nach manueller Schließung, Timerablauf oder der letzten Abgabe deckt die Spielleitung Antworten einzeln durch Klick auf den Namen auf. Abgegebene Antworten bleiben unveränderlich. In der Rundenwertung stehen die Punkte direkt neben dem Teamnamen; zwei Buttons setzen die Punkte auf die jeweils anderen Werte aus 0, 1 und 3, etwa für Synonyme. Wiederholte Aktionen addieren keine weiteren Punkte. Gleichstände teilen sich einen Rang.

**Einrichtung:** `supabase/same.sql` nach `supabase/rather.sql` im Supabase SQL Editor ausführen, anschließend die statischen Dateien über GitHub Pages veröffentlichen. Das Skript ist erneut ausführbar und erweitert den gemeinsamen Code-Einstieg. Private Tabellen enthalten Antworten und gehashte Teilnahme-Token; die Realtime-Tabelle enthält nur Sitzungs-ID und Revision. Berechtigte RPCs liefern fremde Antworten erst nach der individuellen Freigabe aus. Alle Aktionen sperren die Sitzung, prüfen Besitzer beziehungsweise Token und kontrollieren Runde und Phase. Der Timer wird bei jedem Zustandsabruf und jeder Abgabe serverseitig geprüft; ein Abruf alle zwei Sekunden überbrückt Realtime-Ausfälle.

**Prüfung:** `tests/same-db.sql` ausschließlich in einer eigenen leeren Testdatenbank ausführen. Der Test prüft Katalog, Fragekopien, Besitzrechte, Teamverteilung, Geheimhaltung, Einzelaufdeckung, unveränderliche Antworten, Wertung, Overrides, Timer und Berechtigungen. `tests/same.browser.cjs` prüft den Ablauf auf Desktop und mit sechs mobilen Teilnehmern gegen PostgreSQL. Beide Tests sind in der GitHub-Action eingebunden. Optional kann `SAME_PGLITE` auf eine installierte `@electric-sql/pglite`-Version und `SAME_BROWSER` auf einen Chromium-Browser zeigen, um ohne lokalen PostgreSQL-Dienst zu testen.

Das Layout zeigt Teams nebeneinander, Mitglieder untereinander und färbt abgegebene Antworten in der jeweiligen Teamfarbe. Die Rangliste fasst Teamname und Mitglieder in einer Kachel zusammen. Spieler sehen nur die Frage mit Eingabe beziehungsweise Rundenstatus und die Rangliste; Teamspalten und aufgedeckte Antworten erscheinen ausschließlich in der Spielleiteransicht an der Tafel. Die Verbindungsanzeige steht in der Fußzeile. Bei bestehenden Installationen zusätzlich `supabase/same_layout.sql` ausführen; das Skript entfernt serverseitig die Schreibweisenkorrektur und begrenzt manuelle Rundenpunkte auf 0, 1 oder 3.

## Externe Links

Die Dashboard-Kachel „Externe Links“ speichert persönliche Links über „Link hinzufügen“ mit Name und HTTP-/HTTPS-Adresse. Jede Zeile enthält den Namen, einen „Öffnen“-Button für einen neuen Tab und ein Papierkorb-Symbol zum Löschen. Die Links werden in Supabase im jeweiligen Lehrkraftkonto gespeichert. `supabase/external_links.sql` legt die Tabelle und RLS-Regeln für eigene Einträge an. Anonyme Spieler erhalten keinen Lese- oder Schreibzugriff. Beim Abmelden werden die angezeigten Zeilen entfernt.

## Ja oder Nein

Das Quiz Studio bietet einen persönlichen Fragenkatalog mit 15 Startfragen in den Paketen Alltag, Freizeit und Schule sowie eigene Fragen, frei benannte Pakete und gespeicherte Spiele. Änderungen an Startfragen gelten nur für das eigene Konto; gespeicherte Spiele behalten ihre Fragekopien.

„Spiel einstellen“ zeigt zwei Varianten: Gespeicherte Spiele verwenden alle gespeicherten Fragen und bieten Sekunden pro Frage, Trefferpunkte, Abweichungspunkte und erlaubte Abweichung. Beim zufälligen Spiel kommen Rundenanzahl und Fragenpakete hinzu; Fragen werden ohne Wiederholung gemischt. Standard sind 60 Sekunden, 3 Punkte für einen Treffer und 1 Punkt bei maximal einer Person Abweichung; zufällige Spiele starten mit bis zu 10 Runden. Ein geheimer/offener Modus wird nicht mehr gewählt. Offene Räume lassen sich über „Fortsetzen“ wieder öffnen.

Die Wartelobby verwendet das Layout von „Wer würde eher“ mit großer Startkachel, Rangliste und Teilnahmefenster für Code, QR-Code und Link. Die drei Stichpunkte zur Wertung zeigen die tatsächlich eingestellten Punkte. Zwei bis 100 Personen können beitreten und werden automatisch bereit. Die Spielleitung behält in allen Phasen dieselbe Überschrift; Spielergeräte zeigen keine Spielüberschrift. Abgegebene Stimmen werden in allen Ranglisten grün mit Häkchen markiert. Die Spieler-Rangliste steht unter der Spielkarte.

Jede Person wählt verbindlich Ja/Nein und eine ganzzahlige Schätzung von 0 bis zur Gruppengröße einschließlich sich selbst. Die ausgewählte Zahl wird ausschließlich am Zahlenfeld markiert. Sind alle Stimmen eingegangen oder ist die serverseitige Frist abgelaufen, wird „Auswertung“ bei der Spielleitung verfügbar. Der Server veröffentlicht weder Stimmenzahlen noch Punkte automatisch. Erst dieser Button wertet die aktuelle Runde genau einmal aus. Späte Abgaben werden abgewiesen; fehlende Antworten zählen weder als Ja noch als Nein und erhalten 0 Punkte.

Die Auswertung zeigt die Anzahl der Ja-Stimmen sowie pro Person Tipp und Punkte. „Antwort anzeigen“ veröffentlicht anschließend die persönlichen Ja/Nein-Antworten auf allen Geräten. Vorher enthält auch die API keine fremden Antworten. Diese Freigabe wird pro Runde gespeichert und mit jeder neuen Runde zurückgesetzt. Auf Spielergeräten entfällt die Frage während der Auswertung. Die Spielleitung startet die nächste Runde und öffnet nach der letzten Auswertung mit „Endplatzierung“ eine separate Schlussrangliste wie bei „Wer würde eher“. Gleichstände teilen sich einen Platz. Vorzeitiges Beenden erhält ausschließlich bereits ausgewertete Punkte.

Installation: `supabase/yesno.sql` nach den Bluff-Erweiterungen einspielen, danach `supabase/yesno_settings.sql` und zuletzt `supabase/yesno_flow.sql`. Die letzte Erweiterung ersetzt die automatische Auswertung durch berechtigte Moderatoraktionen und ergänzt die rundenweise Antwortfreigabe. Die frühere Einstellung `reveal_answers` bleibt lediglich für API-Kompatibilität gespeichert; sie veröffentlicht keine Antworten mehr automatisch. Bestehende Punkte werden nicht verändert. Spielinformationen und Token-Hashes bleiben im Schema `private`, öffentliche RPCs prüfen Besitz oder Teilnehmer-Token. Realtime meldet ausschließlich Raum-ID und Revision; ein Abruf alle 1,5 Sekunden überbrückt Ausfälle und erkennt Fristende. Sitzungssperren verhindern Doppelwertung bei parallelen Aktionen.

Tests laufen ausschließlich in einer eigenen leeren Testdatenbank: `tests/yesno-db.sql` prüft die bisherige Basis, danach wendet `tests/yesno-flow-db.sql` die neue Erweiterung an und prüft manuelle Freigabe, Fristen, Geheimhaltung, Nullabgaben und Endplatzierung. `tests/yesno-concurrency.cjs` prüft parallele Abgaben und gleichzeitige Auswertung. `tests/yesno.browser.cjs` verwendet tatsächliche PostgreSQL-RPCs für beide Einstellfenster, QR-Beitritt, Antwortfelder, manuelle Auswertung, Antwortfreigabe und finale Rangliste auf Desktop und Mobilgeräten. Die Testbrücke wird von keiner Anwendungsseite geladen. Alle Prüfungen laufen in GitHub Actions; Screenshots werden als Artefakte abgelegt.


## Umfrage: einzelne Sitzungen löschen

`supabase/survey_session_delete.sql` ergänzt für bestehende Installationen die Löschberechtigung für eigene Sitzungen. Neue Installationen erhalten diese Regel bereits durch `schema.sql`. Die Papierkorb-Symbole in „Offene Sitzungen“ und „Durchgeführte Umfragen“ löschen nach Bestätigung die ausgewählte Sitzung samt Teilnehmern und Antworten; die Umfragevorlage bleibt erhalten. Die Anwendung prüft die zurückgegebenen IDs, damit eine verweigerte Löschung nicht als Erfolg erscheint.

`tests/survey-session-db.sql` prüft in einer eigenen leeren Testdatenbank die tatsächlichen RLS-Regeln und das kaskadierende Löschen. `tests/survey.browser.cjs` prüft die Oberfläche, CSV-Export, einzelne Löschungen sowie Start, Folienwechsel, Neustart und Beenden einschließlich Abbruch und Fehlerbehandlung auf Desktop und Handy.

