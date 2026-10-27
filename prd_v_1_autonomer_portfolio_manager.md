# PRD v1 — AI Portfolio Manager Web App

## 1. Dokumentstatus

**Version:** v1  
**Status:** Draft  
**Sprache:** Deutsch  
**Produktname (Arbeitstitel):** AI Portfolio Manager  
**Dokumenttyp:** Product Requirements Document (PRD)

---

## 2. Produktvision

AI Portfolio Manager ist eine Webanwendung für autonomes, aktienbasiertes Portfolio-Management. Das System kombiniert kontinuierliche Marktüberwachung, News- und Fundamentalanalyse, signalbasierte Entscheidungslogik, deterministische Risiko-Kontrollen, automatisierte Orderausführung und vollständige Entscheidungsdokumentation.

Das Produktziel ist nicht, „garantiert konstant hohen ROI“ zu versprechen, sondern ein System zu bauen, das **datengetriebene, nachvollziehbare und risikojustierte Investmententscheidungen** konsistent und skalierbar trifft.

Die Plattform soll wie ein autonomer Investment-Operator funktionieren: Sie analysiert fortlaufend Märkte und Unternehmen, bildet Hypothesen, bewertet Chancen und Risiken, entscheidet innerhalb definierter Regeln über Käufe und Verkäufe und dokumentiert sämtliche Schritte transparent.

---

## 3. Problemdefinition

Privatanleger und professionelle Nutzer stehen vor mehreren strukturellen Problemen:

1. Märkte verändern sich fortlaufend, während menschliche Analysekapazität begrenzt ist.
2. Relevante Informationen entstehen verteilt über Kursdaten, News, Unternehmensmeldungen, Makroereignisse und historische Muster.
3. Manuelle Investmententscheidungen sind häufig langsam, inkonsistent und emotional beeinflusst.
4. Viele Tools liefern nur Daten oder Analysen, aber keine konsistente End-to-End-Entscheidungslogik.
5. Autonome Systeme ohne Audit Trail und harte Risikoregeln sind nicht vertrauenswürdig.

Daraus entsteht der Bedarf nach einem System, das:
- kontinuierlich analysiert,
- Entscheidungen systematisch trifft,
- Risiken strikt begrenzt,
- Trades ausführen kann,
- und jede Handlung vollständig erklärt und speichert.

---

## 4. Produktziel

### 4.1 Primärziel
Ein autonomer KI-Agent soll ein Aktienportfolio selbstständig verwalten, indem er:
- Markt- und Unternehmensdaten kontinuierlich analysiert,
- News und Research in verwertbare Signale übersetzt,
- Kauf- und Verkaufsentscheidungen trifft,
- Orders über eine Broker-Schnittstelle ausführt,
- und alle Entscheidungen inklusive Begründung, Risiko-Check und Ergebnis speichert.

### 4.2 Sekundärziele
- Reduktion emotionaler Fehlentscheidungen
- schnellere Reaktion auf neue Informationen
- transparente, auditierbare Investmententscheidungen
- standardisierte Reports und Investment-Memos
- kontrollierter, reproduzierbarer Entscheidungsprozess

### 4.3 Nicht-Ziele in v1
- garantierte Renditeversprechen
- High-Frequency Trading
- Optionen/Futures/Derivate
- Short Selling
- Margin-/Leverage-Handel
- vollautomatische Selbstentwicklung neuer Strategien
- globales Multi-Asset-Trading

---

## 5. Zielgruppe

### 5.1 Primäre Zielgruppe
- ambitionierte Privatanleger mit Interesse an AI-gestütztem Portfolio-Management
- semi-professionelle Trader / systematische Anleger
- kleine Investment-Teams oder Research-getriebene Trading-Setups

### 5.2 Sekundäre Zielgruppe
- Family-Office-nahe Anwendungsfälle
- interne Tools für AI-Research und signalgestützte Portfolio-Steuerung

### 5.3 Nutzerprofil
Der Nutzer erwartet:
- Transparenz über alle Entscheidungen
- die Möglichkeit, Agent-Aktivität zu überwachen
- Kontrolle über Risiko- und Strategieparameter
- klare Reports und verständliche Entscheidungsbegründungen

---

## 6. Produktumfang v1

### 6.1 Märkte und Assets
Das System startet mit:
- US-Aktien
- optional ausgewählten hochliquiden ETFs
- Long-only
- Fokus auf Large-Cap und Mid-Cap
- Ausschluss illiquider Titel

### 6.2 Anlagehorizont
- primärer Handelsstil: Swing Trading / kurzfristiges Positionsmanagement
- Haltedauer: mehrere Tage bis mehrere Wochen
- Re-Evaluation: kontinuierlich und event-driven
- keine HFT-/Mikrosekunden-Logik

### 6.3 Autonomiegrad
Das System darf:
- Signale generieren
- Positionen eröffnen
- Positionen reduzieren oder schließen
- Rebalancing-Entscheidungen treffen
- Orders eigenständig ausführen

Das System darf **nur innerhalb definierter Risiko-, Portfolio- und Ausführungsregeln** handeln.

---

## 7. Kernwertversprechen

AI Portfolio Manager liefert:
- kontinuierliche Marktbeobachtung statt punktueller Analyse
- strukturierte Verarbeitung von News, Fundamentaldaten und Preisbewegungen
- autonome, aber kontrollierte Orderausführung
- volle Nachvollziehbarkeit jeder Entscheidung
- skalierbares Research- und Portfolio-Betriebssystem

---

## 8. Funktionale Anforderungen

## 8.1 Markt- und Datenerfassung
Das System muss:
- historische und aktuelle Kursdaten verarbeiten können
- Volumen- und Liquiditätsdaten erfassen
- Fundamentaldaten pro Unternehmen speichern
- Unternehmensereignisse wie Earnings-Termine berücksichtigen
- finanzmarktrelevante News verarbeiten
- Portfolio- und Brokerdaten synchronisieren

### Anforderungen
- Unterstützung für Watchlist- und Universumsverwaltung
- Speicherung normalisierter Marktdaten
- Aktualisierung in regelmäßigen Intervallen oder event-driven
- Kennzeichnung der Datenherkunft pro Datensatz

---

## 8.2 Research- und Analysemodul
Das System muss:
- News zusammenfassen
- Unternehmensereignisse klassifizieren
- Bull-/Bear-Thesen formulieren
- relevante Veränderungen im Sentiment erkennen
- technische und fundamentale Lage strukturiert bewerten

### Anforderungen
- Zusammenfassung eingehender News in natürlicher Sprache
- Relevanzbewertung von News für einzelne Assets
- Bildung einer strukturierten Analyse je Aktie
- Historisierung früherer Analysen

---

## 8.3 Signal Engine
Das System muss aus Daten und Analysen handelbare Signale erzeugen.

### Mögliche Eingangsfaktoren
- Preisbewegung
- Momentum
- Volatilität
- Relative Stärke
- fundamentale Qualität
- Bewertungsniveau
- News-Sentiment
- Event-Relevanz
- Portfolio-Kontext

### Anforderungen
- Score pro Asset
- Ranking potenzieller Trades
- Definition von Entry-/Exit-Signalen
- Trennung zwischen Hypothese, Signal und Trade-Freigabe

---

## 8.4 Portfolio Engine
Das System muss:
- das investierbare Universum verwalten
- Positionen auswählen
- Positionsgrößen bestimmen
- Cash-Allokation steuern
- Portfolio-Exposures überwachen
- Rebalancing-Entscheidungen treffen

### Anforderungen
- Auswahl der besten Handelskandidaten auf Basis definierter Scores
- Positionsgröße innerhalb vorgegebener Grenzen
- Berücksichtigung von Diversifikation und Korrelation
- Verhinderung ungewollter Konzentrationsrisiken

---

## 8.5 Risk Engine
Die Risk Engine ist bindend und deterministisch.

### Das System muss vor jeder Order prüfen:
- maximale Positionsgröße
- maximale Sektorallokation
- maximale Gesamtinvestitionsquote
- Mindestliquidität des Assets
- maximal zulässiger Spread
- Tagesverlustgrenze
- Wochenverlustgrenze
- globaler Drawdown
- Handelsverbote bei Datenfehlern oder Systemunsicherheit

### Anforderungen
- harte Orderblockade bei Regelverletzung
- globaler Kill Switch
- Notfallmodus: keine neuen Orders
- protokollierte Ablehnung jeder nicht freigegebenen Order

---

## 8.6 Execution Engine
Das System muss Orders über eine Broker-Schnittstelle übermitteln können.

### Anforderungen
- Erstellung validierter Kauf- und Verkaufsorders
- Unterstützung grundlegender Ordertypen in v1
- Statusverfolgung offener Orders
- Fehlerbehandlung bei fehlgeschlagenen Orders
- Protokollierung von Slippage, Fill-Preis und Gebühren

### Sicherheitsanforderungen
- Orderversand nur nach bestandener Risk-Validation
- Wiederholungslogik nur innerhalb sicherer Grenzen
- Fail-Closed-Verhalten bei unsicherem Zustand

---

## 8.7 Audit Trail und Entscheidungslog
Das System muss jede Entscheidung speichern.

### Pro Entscheidung mindestens speichern:
- Timestamp
- Asset
- Marktdatenkontext
- News-Kontext
- Signalwerte
- Portfolio-Zustand
- Risikoprüfung
- Entscheidungstyp
- erwartete Hypothese
- Orderdaten
- Ausführungsstatus
- Exit-Grund
- Ergebnis

### Anforderungen
- vollständige Historie jeder Position
- spätere Rekonstruktion jeder Handlung möglich
- Verknüpfung von Analyse, Entscheidung und Performance

---

## 8.8 Reporting
Das System muss automatisch Reports erstellen.

### Report-Typen
- täglicher Portfolio-Report
- täglicher Agent-Aktivitätsreport
- Trade-Report pro Position
- Wochenreport mit Performance und Fehleranalyse

### Inhalte
- aktuelle Positionen
- realisierte und unrealisierte P&L
- neue Signale
- ausgeführte Trades
- verworfene Trades inkl. Begründung
- Risikozustand
- wesentliche News-Ereignisse

---

## 8.9 Benutzeroberfläche
Die Webapp muss mindestens folgende Bereiche enthalten:
- Dashboard
- Portfolio Overview
- Watchlist / Universe View
- Signal Center
- News & Research Feed
- Trade Journal
- Risk Center
- Reports
- Agent Activity Log
- Settings für Strategie- und Risikoparameter

### Dashboard-Inhalte
- Gesamtwert des Portfolios
- Tages- und Gesamtperformance
- offene Positionen
- aktuelle Signale
- Systemstatus
- letzte Entscheidungen des Agenten

---

## 9. Nicht-funktionale Anforderungen

### 9.1 Zuverlässigkeit
- System muss robuste Fehlerbehandlung haben
- Dateninkonsistenzen müssen erkannt werden
- unsichere Zustände dürfen keine neuen Orders auslösen

### 9.2 Nachvollziehbarkeit
- jede Entscheidung muss im Nachhinein erklärbar sein
- alle Orderfreigaben und Orderblockaden müssen protokolliert werden

### 9.3 Sicherheit
- sichere Speicherung sensibler Zugangsdaten
- Trennung zwischen User-Daten, Broker-Zugang und Analyse-Daten
- rollenbasierte Zugriffslogik für Admin-/Operator-Funktionen

### 9.4 Performance
- Near-Real-Time-Verarbeitung relevanter Datenfeeds
- schnelle Reaktion auf News und Marktbewegungen innerhalb des Zielhorizonts

### 9.5 Skalierbarkeit
- Erweiterbarkeit auf mehr Assets, Märkte und Strategiemodule in späteren Versionen

---

## 10. Datenquellen

## 10.1 Pflichtdaten in v1
- historische Kursdaten
- aktuelle Kursdaten
- Volumen-/Liquiditätsdaten
- Unternehmens-Fundamentaldaten
- Earnings- und Event-Daten
- News-Feed
- Broker-/Portfolio-Daten

## 10.2 Spätere optionale Datenquellen
- Earnings Call Transcripts
- Analystenreports
- alternative Daten
- Social Sentiment
- Makroindikatoren
- Faktor- und Regime-Daten

---

## 11. Entscheidungslogik

Die Handelslogik folgt einer mehrstufigen Pipeline:

1. **Datenaufnahme:** Markt-, News-, Event- und Portfoliodaten werden ingestiert.
2. **Research-Verarbeitung:** News werden zusammengefasst, Ereignisse klassifiziert und Kontexte aktualisiert.
3. **Signalbildung:** Preis-, Fundamental-, Sentiment- und Event-Faktoren erzeugen Scores.
4. **Portfolio-Selektion:** Kandidaten werden priorisiert.
5. **Risk Validation:** Jede geplante Handlung wird gegen harte Regeln geprüft.
6. **Orderausführung:** Nur freigegebene Orders werden an den Broker gesendet.
7. **Monitoring:** Offene Positionen werden fortlaufend auf neue Informationen geprüft.
8. **Exit/Adjustment:** Positionen werden angepasst oder geschlossen, wenn Hypothesen brechen, Signale kippen oder Risikoregeln greifen.
9. **Dokumentation:** Alle Schritte werden gespeichert und reportet.

---

## 12. Rolle des LLM

Das LLM ist ein spezialisierter Research-, Interpretations- und Explainability-Layer.

### Das LLM darf in v1:
- News zusammenfassen
- Relevanz und Sentiment strukturieren
- Ereignisse sprachlich einordnen
- Bull-/Bear-Thesen formulieren
- Reports schreiben
- Post-Trade-Analysen erstellen
- historische Analysen verdichten

### Das LLM darf in v1 nicht allein entscheiden über:
- finale Orderfreigabe
- Positionsgrößenobergrenzen
- Stop-Loss-/Kill-Switch-Logik
- harte Risikokontrollen
- deterministische Compliance-Prüfungen

### Architekturprinzip
Probabilistische Komponenten erzeugen Hypothesen, Scores und semantische Bewertungen. Deterministische Komponenten entscheiden, ob gehandelt werden darf.

---

## 13. Deterministische Komponenten

Folgende Komponenten müssen regelbasiert und verbindlich sein:
- Positionsgrößenregeln
- Exposure-Limits
- Liquiditätsfilter
- Volatilitätsgrenzen
- Ordervalidierung
- Verlustgrenzen
- Stop-/Exit-Regeln, soweit hart definiert
- Kill Switch
- Datenqualitätschecks
- Broker-Failover-/Fehlerlogik
- Logging und Auditierbarkeit

---

## 14. KPIs und Erfolgsmetriken

## 14.1 Investment-Metriken
- absolute Rendite
- annualisierte Rendite
- Outperformance vs. Benchmark
- Max Drawdown
- Sharpe Ratio
- Sortino Ratio

## 14.2 Trading-Metriken
- Win Rate
- Profit Factor
- durchschnittlicher Gewinn / Verlust
- durchschnittliche Haltedauer
- Turnover
- Slippage
- Gebührenquote

## 14.3 Betriebsmetriken
- Anzahl erfolgreicher Datenupdates
- Stabilität der Broker-Anbindung
- Anzahl blockierter Orders durch Risk Engine
- Anzahl Regelverletzungen
- Vollständigkeit des Audit Trails

### Erfolgskriterium v1
v1 ist erfolgreich, wenn das System:
- stabil läuft,
- keine unkontrollierten Orderausführungen erzeugt,
- alle Entscheidungen rekonstruierbar speichert,
- innerhalb definierter Risikogrenzen handelt,
- und in Paper Trading oder kleinem Live-Betrieb valide Signale liefert.

---

## 15. UX-Anforderungen

Die Benutzeroberfläche soll Vertrauen, Transparenz und Kontrolle vermitteln.

### UX-Prinzipien
- klare Sichtbarkeit aktueller Agent-Aktivität
- nachvollziehbare Begründung jeder Position
- verständliche Darstellung von Risiko und Portfoliozustand
- deutliche Trennung zwischen Vorschlägen, aktiven Orders und ausgeführten Trades
- jederzeit sichtbarer Systemstatus

### Kritische UX-Elemente
- Begründung „Warum gekauft?“
- Begründung „Warum verkauft?“
- sichtbarer Risk-Check-Status
- sichtbarer Autonomie-/Live-Modus-Status
- Alarmierung bei Kill-Switch oder Datenproblemen

---

## 16. Betriebsmodi

Das System soll mindestens folgende Modi unterstützen:

### 16.1 Analysis Mode
- analysiert, reportet, führt keine Orders aus

### 16.2 Paper Trading Mode
- simuliert autonome Ausführung ohne echtes Kapital

### 16.3 Live Trading Mode
- führt echte Orders aus
- nur bei aktiver Broker-Verbindung
- nur innerhalb freigegebener Limits

---

## 17. MVP-Definition (8–12 Wochen)

## 17.1 Ziel des MVP
Bau eines begrenzten, aber real funktionierenden autonomen Trading-Agenten für US-Aktien, der:
- Markt- und News-Daten verarbeitet,
- Signale erzeugt,
- Orders innerhalb harter Regeln ausführt,
- und jede Entscheidung vollständig dokumentiert.

## 17.2 MVP-Scope
- begrenztes Universum von 50–200 US-Aktien
- Long-only
- Kursdaten + News + Basis-Fundamentaldaten
- einfache Signalbewertung
- deterministische Risk Engine
- Broker-Anbindung
- Dashboard, Trade Journal, Risk Center, Reports
- Paper Trading zuerst, danach Live mit kleinem Kapital

## 17.3 Ausgeschlossen aus MVP
- Optionen/Futures
- RL-basierte autonome Strategiegenerierung
- Multi-Market / Global Market Support
- ausgefeilte Faktor-Modelle auf institutionellem Niveau
- Social Trading / Community Features

---

## 18. Annahmen

- ausreichende Datenqualität ist verfügbar
- Broker-Schnittstelle erlaubt stabile Orderausführung
- der erste Zielmarkt sind US-Aktien mit guter Liquidität
- der Nutzer akzeptiert harte Risiko- und Expositionsgrenzen
- das LLM wird als semantische Schicht genutzt, nicht als alleinige Orderinstanz

---

## 19. Risiken und offene Punkte

### 19.1 Produkt- und Modellrisiken
- schlechte Signalqualität
- Overfitting im Backtest
- instabile News-Bewertung
- widersprüchliche Datenquellen

### 19.2 Technische Risiken
- Broker-Fehler
- Feed-Verzögerungen
- Datenlücken
- Race Conditions zwischen Signal und Ausführung

### 19.3 Betriebsrisiken
- ungeplante Trades durch Systemfehler
- falsche Positionsgrößen
- verspätete Stops oder Exits

### 19.4 Governance-/Compliance-Risiken
- regulatorische Einordnung bei autonomer Orderausführung
- Dokumentationspflichten
- Haftungsfragen bei Fehlentscheidungen

### Offene Fragen für v1.x
- Soll der Nutzer Strategien konfigurieren oder nur Parameter anpassen?
- Wie granular soll der Agent in der UI begründet werden?
- Welche Broker werden zuerst unterstützt?
- Wie werden Live- und Paper-Daten strikt getrennt?

---

## 20. Release-Kriterien für v1

Ein v1-Release ist möglich, wenn:
- Datenfeeds stabil integriert sind
- Signal Engine im Zieluniversum funktioniert
- Risk Engine jede Order deterministisch validiert
- Broker-Anbindung in Paper Trading und kontrolliertem Live-Test stabil ist
- vollständiges Logging vorhanden ist
- zentrale UI-Bereiche nutzbar sind
- tägliche Reports zuverlässig erstellt werden

---

## 21. Zusammenfassung

AI Portfolio Manager v1 ist eine autonome Webplattform für Long-only-US-Aktienhandel mit kontinuierlicher Analyse, LLM-gestützter Research-Verarbeitung, regelbasierter Signal- und Risiko-Logik, automatisierter Orderausführung und vollständiger Dokumentation.

Der Kern des Produkts ist nicht bloße „AI für Trading“, sondern die Kombination aus:
- semantischer Analyse,
- quantitativer Signalbewertung,
- bindender Risk Governance,
- autonomer Execution,
- und vollständiger Erklärbarkeit.

Damit entsteht ein belastbarer Startpunkt für ein AI-natives Portfolio-Management-System.




Der Fahrplan — 5 Phasen                                   
                                                                                                                                        
  Phase 1 — Backend + Persistente Wissensdatenbank (Wichtigste Priorität)
                                                                                                                                        
  Das ist die Grundlage für alles. Die better-sqlite3, express und dotenv Pakete sind bereits in package.json — sie wurden nur noch     
  nicht genutzt.                                                                                                                        
                                                                                                                                        
  Was zu bauen ist:                                                                                                                     
  - Express-Server der 24/7 läuft (unabhängig vom Browser)
  - SQLite-Datenbank mit diesen Tabellen:                                                                                               
    - companies — Grundprofil pro Aktie (Sektor, Market Cap, Geschäftsmodell, Moat)
    - analyses — jede Gemini-Analyse mit Zeitstempel gespeichert                                                                        
    - signals — alle generierten Signale mit Score, Konfidenz, Begründung                                                               
    - trades — kompletter Audit Trail (Entry, Exit, Thesis, P&L, Grund)                                                                 
    - news_articles — processed/unprocessed Flag, Zusammenfassung, Sentiment                                                            
    - company_knowledge — akkumuliertes Wissen pro Unternehmen (Bull/Bear-Thesen über Zeit)                                             
    - price_history — OHLCV Daten für technische Analyse                                                                                
                                                                                                                                        
  Warum zuerst: Ohne das bleibt alles Stückwerk. Mit persistentem Backend kann die KI Wissen aufbauen und Muster über Wochen erkennen.  
                                                                                                                                        
  ---                                                                                                                                   
  Phase 2 — Technische Analyse Layer                                                                                                    
                                                                                                                                        
  Nur News-Sentiment reicht nicht. Kursverläufe erzählen eine eigene Geschichte.
                                                                                                                                        
  Was zu bauen ist:                                                                                                                     
  - Historische OHLCV-Daten laden und speichern (Yahoo Finance API)                                                                     
  - Technische Indikatoren berechnen:                                                                                                   
    - Trend: EMA 20/50/200, MACD                            
    - Momentum: RSI, Rate of Change                                                                                                     
    - Volatilität: ATR, Bollinger Bands                                                                                                 
    - Volumen: OBV, Volume Spike Detection                                                                                              
  - Diese Signale kombiniert mit dem News-Sentiment an Gemini senden                                                                    
                                                                                                                                        
  Prompt-Verbesserung: Gemini bekommt dann nicht nur den Artikel-Link, sondern:                                                         
  "AAPL steht bei $210 (EMA200: $195, RSI: 71 — überkauft),                                                                             
  Volumen heute 3x normal, gestern Earnings Beat.                                                                                       
  Letzte 3 Analysen: [Zusammenfassungen aus DB].                                                                                        
  Aktueller Artikel: [URL]"                                                                                                             
                                                                                                                                        
  ---                                                                                                                                   
  Phase 3 — Fundamentaldaten + Frühwarnsystem                                                                                           
                                                                                                                                        
  Für mittelfristige und langfristige Entscheidungen.       
                                                                                                                                        
  Kostenlose Quellen:                                                                                                                   
  - SEC EDGAR API (gratis) — 10-K, 10-Q Filings, Earnings                                                                               
  - Yahoo Finance (bereits genutzt) — P/E, Revenue, EPS                                                                                 
  - Earnings-Kalender — KI warnt 3-5 Tage vor Earnings-Datum automatisch
                                                                                                                                        
  KI-Wissensaufbau:                                                                                                                     
  - Nach jeder Analyse wird das Profil der Aktie in der DB angereichert                                                                 
  - Gemini fasst z.B. nach 10 Analysen von NVDA eine konsolidierte These zusammen: "Was wir über NVDA wissen"                           
  - Diese These wird bei der nächsten Analyse als Kontext mitgegeben → KI arbeitet auf bestehendem Wissen auf
                                                                                                                                        
  ---                                                                                                                                   
  Phase 4 — Deterministische Risk Engine                                                                                                
                                                                                                                                        
  Laut PRD: Probabilistische Komponenten (KI) erzeugen Hypothesen. Deterministische Komponenten entscheiden ob gehandelt werden darf.
                                                                                                                                        
  Regeln die hart implementiert werden müssen:                                                                                          
  max Einzelposition:     15% des Portfolios                                                                                            
  max Sektor-Exposure:    30%                                                                                                           
  max investiert:         90% (10% Cash-Reserve immer)                                                                                  
  Tagesverlust-Limit:     -3% → keine neuen BUYs                                                                                        
  Drawdown-Limit:         -15% → Kill Switch                                                                                            
  Stop-Loss pro Position: -8% unter Entry                                                                                               
  Mindest-Konfidenz:      ≥ 60% (bereits implementiert, aber ohne oben stehende Checks)                                                 
                                                                                                                                        
  Jede blockierte Order wird mit Begründung geloggt — das ist für das Audit Trail essenziell.                                           
                                                                                                                                        
  ---                                                                                                                                   
  Phase 5 — Universum-Scanning + Langfristige Analyse                                                                                   
                                                                                                                                        
  Kurzfristig (Swing): Aktuelles System ausbauen, 50-200 Aktien scannen, nicht nur 11.
                                                                                                                                        
  Langfristig (Position Trading):                                                                                                       
  - Separater Analyse-Modus: Wöchentlich tiefe Fundamental-Analyse                                                                      
  - KI erstellt "Investment Memo" pro Aktie: Moat, Wachstumsthese, faire Bewertung, Katalysatoren                                       
  - Langfristige Positionen haben eigene Entry/Exit-Logik (Fundamentals kippen, nicht nur Preis) 
                                                                                                                                        
  Frühwarnsystem:                                                                                                                       
  - Anomalie-Erkennung: Ungewöhnliches Volumen, Insider-Transaktionen (SEC Form 4)                                                      
  - Earnings Surprise Detektion                                                                                                         
  - Sektor-Rotation Erkennung (ein Sektor schwächt ab → Kapital umschichten)
                                                                                                                                        
  ---                                                                                                                                   
  Empfohlene Reihenfolge (konkrete nächste Schritte)                                                                                    
                                                                                                                                        
  1. Express-Backend + SQLite aufbauen              (1-2 Tage)
  2. DB-Schema + API-Endpoints                      (1 Tag)                                                                             
  3. AutoTradingContext → Backend-Calls umstellen   (1 Tag)                                                                             
  4. Technische Indikatoren (OHLCV + EMA/RSI/MACD)  (2 Tage)                                                                            
  5. Verbesserter Gemini-Prompt mit Kontext         (1 Tag)                                                                             
  6. Risk Engine deterministisch implementieren     (1-2 Tage)                                                                          
  7. Fundamentaldaten (Yahoo Finance + EDGAR)       (2-3 Tage)                                                                          
  8. Universum erweitern (50+ Aktien)               (1 Tag)                                                                             
  9. Reporting + Investment Memo Generator          (2 Tage)                                                                            
  10. Frühwarnsystem + Anomalie-Detektion           (2-3 Tage)  


   Plan to implement                                                               │
│                                                                                 │
│ Multi-Agent Hedge Fund System — Phases 18–21                                    │
│                                                                                 │
│ Context                                                                         │
│                                                                                 │
│ The system currently has one monolithic agent (server/agent.ts) that does       │
│ everything in a single 30-second loop: fetch news → classify via Gemini → build │
│  signal candidates → risk check → execute. This is Phase 1-style architecture.  │
│ The goal is to evolve it into a proper multi-agent hedge fund structure where   │
│ specialized agents run at their natural cadence, cooperate through a shared     │
│ database, and collectively cover the full research stack a real hedge fund      │
│ employs.                                                                        │
│                                                                                 │
│ What a hedge fund does → AI-native translation:                                 │
│                                                                                 │
│ ┌──────────────────────────────────┬─────────────────────────────────────────┐  │
│ │       Hedge Fund Function        │           AI Agent Equivalent           │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Research analysts (news,         │ ResearchIngestionAgent — news/8-K/Form  │  │
│ │ filings, earnings)               │ 4 classification                        │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Prime brokerage intelligence     │ HedgeFundAgent — SEC 13F quarterly      │  │
│ │ (who owns what)                  │ holdings                                │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Macro desk (Fed, rates, economic │ MacroAgent — FRED API + regime          │  │
│ │  cycle)                          │ classification                          │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Derivatives/flow desk (options,  │ SentimentAgent — put/call ratio + short │  │
│ │ short interest)                  │  squeeze                                │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Portfolio manager (position      │ CoordinatorAgent — refactored agent.ts  │  │
│ │ sizing, conviction)              │                                         │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Risk desk (hard limits,          │ risk.ts — already deterministic, no     │  │
│ │ drawdown, stops)                 │ change                                  │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Quant desk (screener,            │ ScreenerAgent — existing screener       │  │
│ │ technicals, multi-TF)            │ wrapped                                 │  │
│ ├──────────────────────────────────┼─────────────────────────────────────────┤  │
│ │ Knowledge management (thesis     │ KnowledgeAgent — existing knowledge.ts  │  │
│ │ building)                        │ wrapped                                 │  │
│ └──────────────────────────────────┴─────────────────────────────────────────┘  │
│                                                                                 │
│ No 13F, institutional, or hedge fund tracking exists in the codebase today.     │
│ Zero matches for "13F", "institutional", "hedge", "holdings" in server/.        │
│                                                                                 │
│ ---                                                                             │
│ What Already Exists (Reuse, Don't Rebuild)                                      │
│                                                                                 │
│ - server/agent.ts — monolith to decompose (research ingestion lines 646–813 to  │
│ extract)                                                                        │
│ - server/research.ts — saveResearchEvents(), buildSignalCandidates() — core     │
│ pipeline, extend not replace                                                    │
│ - server/strategy.ts — determineOrderPlan() — sizing logic, add macro regime    │
│ modifier                                                                        │
│ - server/risk.ts — 7 deterministic checks — add macro-adjusted stop-loss        │
│ threshold                                                                       │
│ - server/screener.ts — runScreener() — wrap in ScreenerAgent                    │
│ - server/knowledge.ts — consolidate() / shouldConsolidate() — wrap in           │
│ KnowledgeAgent                                                                  │
│ - server/insiders.ts — XML parsing pattern (xmlVal/xmlAll) to reuse in 13F      │
│ parser                                                                          │
│ - server/filings.ts — EDGAR fetch pattern (CIK lookup → submissions API → doc   │
│ fetch) to reuse exactly                                                         │
│ - server/ops.ts — markDataSourceSuccess/Failure() — every agent must call these │
│ - server/db.ts — single source of schema truth, add all new tables here         │
│ - server/index.ts — 88 routes already, add ~20 new routes across phases         │
│                                                                                 │
│ ---                                                                             │
│ Phase 18 — 13F Hedge Fund Holdings Tracker                                      │
│                                                                                 │
│ Goal: Track quarterly SEC 13F-HR filings from ~15 top hedge funds. Detect       │
│ position changes (new, added, reduced, exited) and generate research_events     │
│ feeding into the existing signal pipeline.                                      │
│                                                                                 │
│ New Files                                                                       │
│                                                                                 │
│ - server/hedgeFund.ts — EDGAR 13F fetcher, XML parser, CUSIP mapper, change     │
│ detector, research event generator                                              │
│                                                                                 │
│ DB Schema (add to server/db.ts)                                                 │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS hedge_fund_managers (                                │
│   id TEXT PRIMARY KEY,              -- e.g. 'tiger_global'                      │
│   name TEXT NOT NULL,                                                           │
│   cik TEXT NOT NULL UNIQUE,         -- zero-padded 10-digit SEC CIK             │
│   style TEXT,                       -- 'growth', 'value', 'quant', 'macro'      │
│   active INTEGER DEFAULT 1,                                                     │
│   created_at INTEGER DEFAULT (unixepoch())                                      │
│ );                                                                              │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS hedge_fund_holdings (                                │
│   id TEXT PRIMARY KEY,                                                          │
│   manager_id TEXT NOT NULL REFERENCES hedge_fund_managers(id),                  │
│   period_of_report TEXT NOT NULL,   -- YYYY-MM-DD (quarter end)                 │
│   accession_number TEXT NOT NULL,                                               │
│   filed_date TEXT NOT NULL,                                                     │
│   cusip TEXT NOT NULL,                                                          │
│   ticker TEXT,                      -- resolved from CUSIP map, or null         │
│   issuer_name TEXT NOT NULL,        -- raw from XML                             │
│   shares INTEGER NOT NULL,                                                      │
│   value_thousands INTEGER NOT NULL, -- USD thousands                            │
│   created_at INTEGER DEFAULT (unixepoch()),                                     │
│   UNIQUE(manager_id, period_of_report, cusip)                                   │
│ );                                                                              │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS hedge_fund_changes (                                 │
│   id TEXT PRIMARY KEY,                                                          │
│   manager_id TEXT NOT NULL REFERENCES hedge_fund_managers(id),                  │
│   period_of_report TEXT NOT NULL,                                               │
│   cusip TEXT NOT NULL,                                                          │
│   ticker TEXT,                                                                  │
│   issuer_name TEXT NOT NULL,                                                    │
│   change_type TEXT NOT NULL,        -- 'new' | 'added' | 'reduced' | 'exited'   │
│   prior_shares INTEGER,                                                         │
│   current_shares INTEGER NOT NULL,                                              │
│   pct_change REAL,                  -- +0.35 = added 35%, negative = reduced    │
│   current_value_thousands INTEGER NOT NULL,                                     │
│   is_significant INTEGER DEFAULT 0, -- 1 if |pct_change| >= 0.10 or new/exited  │
│   created_at INTEGER DEFAULT (unixepoch()),                                     │
│   UNIQUE(manager_id, period_of_report, cusip)                                   │
│ );                                                                              │
│                                                                                 │
│ CREATE INDEX IF NOT EXISTS idx_hf_holdings_ticker ON                            │
│ hedge_fund_holdings(ticker);                                                    │
│ CREATE INDEX IF NOT EXISTS idx_hf_changes_significant ON                        │
│ hedge_fund_changes(is_significant, created_at);                                 │
│                                                                                 │
│ Tracked Funds (seed hedge_fund_managers on startup)                             │
│                                                                                 │
│ ┌─────────────────┬─────────────────────────────────┬─────────┬──────────┐      │
│ │       id        │              name               │   cik   │  style   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ tiger_global    │ Tiger Global Management         │ 1167483 │ growth   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ coatue          │ Coatue Management               │ 1336528 │ growth   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ d1_capital      │ D1 Capital Partners             │ 1795578 │ growth   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ citadel         │ Citadel Advisors                │ 1423053 │ quant    │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ viking_global   │ Viking Global Investors         │ 1103804 │ growth   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ duquesne        │ Duquesne Family Office          │ 1536615 │ macro    │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ third_point     │ Third Point LLC                 │ 1040570 │ activist │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ lone_pine       │ Lone Pine Capital               │ 1165408 │ growth   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ soros           │ Soros Fund Management           │ 1029160 │ macro    │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ renaissance     │ Renaissance Technologies (Inst) │ 1037540 │ quant    │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ two_sigma       │ Two Sigma Investments           │ 1179392 │ quant    │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ point72         │ Point72 Asset Management        │ 1649989 │ multi    │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ whale_rock      │ Whale Rock Capital              │ 1474735 │ growth   │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ pershing_square │ Pershing Square Capital         │ 1041895 │ activist │      │
│ ├─────────────────┼─────────────────────────────────┼─────────┼──────────┤      │
│ │ bridgewater     │ Bridgewater Associates          │ 1350813 │ macro    │      │
│ └─────────────────┴─────────────────────────────────┴─────────┴──────────┘      │
│                                                                                 │
│ 13F Fetch Logic (follow filings.ts pattern exactly)                             │
│                                                                                 │
│ 1. GET https://data.sec.gov/submissions/CIK{padded_cik}.json → filter form ===  │
│ '13F-HR'                                                                        │
│ 2. Find latest accession number not already in hedge_fund_holdings              │
│ 3. GET https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&typ │
│ e=13F-HR&dateb=&owner=include&count=5 → find primary information table doc      │
│ 4. Fetch XML, parse all <infoTable> blocks:                                     │
│   - nameOfIssuer, cusip, value (thousands), sshPrnamt (shares), titleOfClass    │
│ 5. Rate limit: 500ms between managers, 300ms between requests per manager       │
│                                                                                 │
│ CUSIP-to-Ticker Resolution                                                      │
│                                                                                 │
│ Use a static hardcoded map for all 75 universe symbols (CUSIPs are stable for   │
│ common stock):                                                                  │
│ const CUSIP_MAP: Record<string, string> = {                                     │
│   '037833100': 'AAPL',  '594918104': 'MSFT',  '67066G104': 'NVDA',              │
│   '02079K305': 'GOOGL', '023135106': 'AMZN',  '30303M102': 'META',              │
│   '88160R101': 'TSLA',  // ... all 75 core symbols                              │
│ };                                                                              │
│ Fallback: normalize nameOfIssuer → uppercase, strip "INC"/"CORP"/"LTD" → match  │
│ against companies table name. Skip unresolvable CUSIPs.                         │
│                                                                                 │
│ Change Detection (run after each new 13F ingest)                                │
│                                                                                 │
│ For each current-period holding, query prior quarter's same (manager_id,        │
│ cusip):                                                                         │
│ - new: no prior row → is_significant = 1                                        │
│ - added ≥10%: pct_change >= 0.10 → is_significant = 1                           │
│ - reduced ≥10%: pct_change <= -0.10 → is_significant = 1                        │
│ - exited: prior shares > 0, current = 0 → is_significant = 1                    │
│                                                                                 │
│ Research Event Generation                                                       │
│                                                                                 │
│ Extend ResearchSourceType in research.ts:                                       │
│ export type ResearchSourceType = 'news' | 'filing' | 'insider' | 'hedge_fund' | │
│  'options_flow' | 'short_interest';                                             │
│                                                                                 │
│ Add weight in scoreResearchEvents():                                            │
│ - hedge_fund: weight 14 (below insider 18, above news 10)                       │
│ - Apply 0.5× staleness discount if event_timestamp is >60 days old at scoring   │
│ time                                                                            │
│                                                                                 │
│ Sentiment mapping:                                                              │
│ - new / added → bullish, importance 0.70–0.80                                   │
│ - reduced / exited → bearish, importance 0.60–0.85                              │
│ - Multiple funds making same move in same quarter → bump importance to 0.90     │
│                                                                                 │
│ Event title format: "Tiger Global ADDED NVDA +42% (8.2M shares) — Q4 2025 13F"  │
│                                                                                 │
│ New API Routes                                                                  │
│                                                                                 │
│ GET  /api/hedge-funds/managers          — all tracked managers                  │
│ GET  /api/hedge-funds/changes           — recent significant changes (query     │
│ param: symbol)                                                                  │
│ GET  /api/hedge-funds/symbol/:symbol    — which funds hold this + trend across  │
│ quarters                                                                        │
│ GET  /api/hedge-funds/overlap           — symbols held by 3+ funds (conviction  │
│ list)                                                                           │
│ GET  /api/hedge-funds/smart-money       — top buys + top sells this quarter     │
│ (dashboard)                                                                     │
│ POST /api/hedge-funds/refresh           — trigger re-ingest for all managers    │
│                                                                                 │
│ Frontend                                                                        │
│                                                                                 │
│ New component: src/components/SmartMoney.tsx                                    │
│ - Summary cards: Stocks added by 3+ funds | Stocks exited by 3+ funds | Net     │
│ smart money per sector                                                          │
│ - Holdings table: sortable by manager / symbol / value / change%                │
│ - Symbol detail panel: which funds hold it, sparkline of position size across 4 │
│  quarters (recharts LineChart)                                                  │
│ - Add "Smart Money" tab to App.tsx tab list                                     │
│                                                                                 │
│ ---                                                                             │
│ Phase 19 — Multi-Agent Framework                                                │
│                                                                                 │
│ Goal: Decompose the monolith into 7 specialized agents that cooperate           │
│ exclusively through SQLite.                                                     │
│                                                                                 │
│ Coordination Contract                                                           │
│                                                                                 │
│ - All agents write to research_events — the universal inbox                     │
│ - Coordinator only writes to signal_candidates and calls executeTrade           │
│ - All agents call markDataSourceSuccess/Failure — their heartbeat               │
│ - No in-process message passing — SQLite WAL mode is safe for this pattern      │
│ (better-sqlite3 is synchronous, no true concurrency)                            │
│                                                                                 │
│ New Files                                                                       │
│                                                                                 │
│ server/agents/base.ts          — BaseAgent abstract class                       │
│ server/agents/coordinator.ts   — refactored trading loop from agent.ts          │
│ server/agents/researchIngestion.ts — news/8-K/Form4 classifier                  │
│ server/agents/hedgeFund.ts     — 6-hour 13F monitoring wrapper                  │
│ server/agents/screener.ts      — scheduled screener wrapper                     │
│ server/agents/macro.ts         — FRED + regime (Phase 20)                       │
│ server/agents/sentiment.ts     — options + short interest (Phase 21)            │
│ server/agents/knowledge.ts     — AI consolidation wrapper                       │
│ server/agents/registry.ts      — AgentRegistry singleton                        │
│                                                                                 │
│ BaseAgent (server/agents/base.ts)                                               │
│                                                                                 │
│ abstract class BaseAgent {                                                      │
│   abstract readonly name: string;                                               │
│   abstract readonly intervalMs: number;                                         │
│   abstract run(): Promise<void>;                                                │
│                                                                                 │
│   private timer: NodeJS.Timeout | null = null;                                  │
│   protected running = false;                                                    │
│                                                                                 │
│   start(): void       { /* schedule + run() once */ }                           │
│   stop(): void        { /* clearInterval, running=false */ }                    │
│   isRunning(): boolean { return this.running; }                                 │
│   protected log(msg: string, level?: 'info'|'error'): void  { /* engine_logs    │
│ insert */ }                                                                     │
│   protected markSuccess(count?: number, details?: object): void                 │
│   protected markFailure(error: string): void                                    │
│ }                                                                               │
│                                                                                 │
│ Agent Schedules                                                                 │
│                                                                                 │
│ ┌────────────────────────┬──────────────────────┬─────────────────────────┐     │
│ │         Agent          │       Interval       │       Source key        │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ CoordinatorAgent       │ 30s                  │ agent (existing)        │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ ResearchIngestionAgent │ 60s                  │ research_ingestion      │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ HedgeFundAgent         │ 6h                   │ hedge_fund_13f          │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ ScreenerAgent          │ on market open/close │ screener                │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ MacroAgent             │ 1h                   │ macro_fred              │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ SentimentAgent         │ 2h                   │ sentiment_options       │     │
│ ├────────────────────────┼──────────────────────┼─────────────────────────┤     │
│ │ KnowledgeAgent         │ on-demand + 6h scan  │ knowledge_consolidation │     │
│ └────────────────────────┴──────────────────────┴─────────────────────────┘     │
│                                                                                 │
│ CoordinatorAgent (extracted from agent.ts)                                      │
│                                                                                 │
│ Keeps only:                                                                     │
│ - Stop-loss scan (processStopLossAlerts)                                        │
│ - buildSignalCandidates(72) call                                                │
│ - Risk engine check                                                             │
│ - executeCandidateTrade                                                         │
│ - Knowledge consolidation trigger                                               │
│ - Earnings warning log                                                          │
│                                                                                 │
│ Removes: refreshYahooFinanceNews, getNextPendingResearchItem,                   │
│ classifyResearchItem, persistResearchItem → moved to ResearchIngestionAgent.    │
│                                                                                 │
│ ResearchIngestionAgent (extracted from agent.ts)                                │
│                                                                                 │
│ Contains: refreshYahooFinanceNews, getNextPendingResearchItem,                  │
│ classifyResearchItem, persistResearchItem (lines 613–813 of current agent.ts).  │
│ Also owns the 4-hour filing and insider check schedules (currently in index.ts  │
│ setIntervals).                                                                  │
│                                                                                 │
│ AgentRegistry (server/agents/registry.ts)                                       │
│                                                                                 │
│ class AgentRegistry {                                                           │
│   private agents = new Map<string, BaseAgent>();                                │
│   register(agent: BaseAgent): void                                              │
│   startAll(): void                                                              │
│   stopAll(): void                                                               │
│   start(name: string): void                                                     │
│   stop(name: string): void                                                      │
│   getAllStatuses(): AgentStatus[]                                               │
│ }                                                                               │
│ export const registry = new AgentRegistry();                                    │
│                                                                                 │
│ server/index.ts calls registry.startAll() on startup instead of startAgent()    │
│ directly. server/agent.ts becomes a thin re-export for backward compat:         │
│ export { startAgent, stopAgent, getStatus, getLogs } from                       │
│ './agents/registry.js';                                                         │
│                                                                                 │
│ New Agent API Routes                                                            │
│                                                                                 │
│ GET  /api/agents/status          — all agents' status, lastRunAt, errorCount    │
│ POST /api/agents/:name/start     — start one agent                              │
│ POST /api/agents/:name/stop      — stop one agent                               │
│ POST /api/agents/start-all                                                      │
│ POST /api/agents/stop-all                                                       │
│ GET  /api/agents/:name/logs      — engine_logs filtered by asset=name           │
│                                                                                 │
│ Implementation Order for Phase 19                                               │
│                                                                                 │
│ 1. base.ts — abstract class                                                     │
│ 2. coordinator.ts — extract trade loop                                          │
│ 3. researchIngestion.ts — extract ingestion                                     │
│ 4. screener.ts — wrap existing                                                  │
│ 5. knowledge.ts — wrap existing                                                 │
│ 6. registry.ts + update index.ts                                                │
│ 7. hedgeFund.ts — wrap Phase 18 module (Phase 18 must be complete first)        │
│ 8. macro.ts, sentiment.ts — after Phase 20/21 core modules exist                │
│                                                                                 │
│ ---                                                                             │
│ Phase 20 — Macro Intelligence Agent                                             │
│                                                                                 │
│ Goal: FRED API integration for market regime detection. Regime modifies signal  │
│ thresholds, position sizing, and stop-loss levels without changing existing     │
│ module signatures (optional parameter pattern).                                 │
│                                                                                 │
│ New File: server/macro.ts                                                       │
│                                                                                 │
│ Fetches from FRED API. Requires FRED_API_KEY in .env (free registration at      │
│ fred.stlouisfed.org).                                                           │
│                                                                                 │
│ New DB Tables (add to server/db.ts)                                             │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS macro_indicators (                                   │
│   id INTEGER PRIMARY KEY AUTOINCREMENT,                                         │
│   series_id TEXT NOT NULL,      -- e.g. 'T10Y2Y', 'VIXCLS'                      │
│   series_name TEXT NOT NULL,                                                    │
│   observation_date TEXT NOT NULL,                                               │
│   value REAL,                                                                   │
│   fetched_at INTEGER DEFAULT (unixepoch()),                                     │
│   UNIQUE(series_id, observation_date)                                           │
│ );                                                                              │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS macro_regimes (                                      │
│   id INTEGER PRIMARY KEY AUTOINCREMENT,                                         │
│   regime TEXT NOT NULL,         -- 'bull' | 'bear' | 'neutral'                  │
│   vix_level REAL,                                                               │
│   yield_curve REAL,             -- T10Y2Y                                       │
│   fed_funds REAL,                                                               │
│   cpi_yoy REAL,                                                                 │
│   reasoning TEXT,                                                               │
│   computed_at INTEGER DEFAULT (unixepoch())                                     │
│ );                                                                              │
│                                                                                 │
│ FRED Series                                                                     │
│                                                                                 │
│ - FEDFUNDS — Fed funds rate (monthly)                                           │
│ - UNRATE — Unemployment (monthly)                                               │
│ - CPIAUCSL — CPI (monthly, compute YoY)                                         │
│ - T10Y2Y — 10Y-2Y yield spread (daily)                                          │
│ - VIXCLS — VIX (daily)                                                          │
│                                                                                 │
│ FRED fetch: GET https://api.stlouisfed.org/fred/series/observations?series_id={ │
│ ID}&api_key={KEY}&limit=30&sort_order=desc&file_type=json                       │
│                                                                                 │
│ Regime Classification (deterministic, no LLM)                                   │
│                                                                                 │
│ BEAR: VIX > 30 OR T10Y2Y < -0.50                                                │
│ BULL: VIX < 18 AND T10Y2Y > 0                                                   │
│ NEUTRAL: everything else                                                        │
│                                                                                 │
│ Regime Impact on Existing Modules                                               │
│                                                                                 │
│ Modify functions to accept optional macroRegime?: 'bull'|'bear'|'neutral'       │
│ parameter:                                                                      │
│ - research.ts buildSignalCandidates(): score threshold → Bull: 15, Neutral: 20, │
│  Bear: 28                                                                       │
│ - strategy.ts deriveBaseTargetWeight(): weight multiplier → Bull: 1.0, Neutral: │
│  0.85, Bear: 0.65                                                               │
│ - risk.ts stop-loss threshold: Bull: -8%, Neutral: -6%, Bear: -5%               │
│                                                                                 │
│ CoordinatorAgent reads latest macro_regimes row and passes regime to these      │
│ calls. Defaults to 'neutral' if no regime exists (backward-compatible).         │
│                                                                                 │
│ Research Events from Macro                                                      │
│                                                                                 │
│ - VIX crosses 25 from below: 'volatility_spike', symbol 'MARKET', sentiment     │
│ 'bearish', importance 0.85                                                      │
│ - T10Y2Y crosses 0 to negative: 'yield_curve_inversion', sentiment 'bearish',   │
│ importance 0.75                                                                 │
│ - CPI YoY deviation ≥ 0.5pp from prior: 'cpi_release', importance 0.80          │
│ - Hardcoded FOMC meeting dates (8 per year): 'fed_decision', importance 0.90    │
│                                                                                 │
│ New API Routes                                                                  │
│                                                                                 │
│ GET /api/macro/regime           — current regime + all indicator values         │
│ GET /api/macro/indicators       — recent observations for all FRED series       │
│ GET /api/macro/prompt-context   — formatted string for Gemini prompts           │
│                                                                                 │
│ ---                                                                             │
│ Phase 21 — Enhanced Signals: Options Flow + Short Interest                      │
│                                                                                 │
│ Goal: Two new data sources, each becoming a sourceType in research_events,      │
│ feeding the existing pipeline.                                                  │
│                                                                                 │
│ New File: server/sentiment.ts                                                   │
│                                                                                 │
│ New DB Tables (add to server/db.ts)                                             │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS options_flow (                                       │
│   id INTEGER PRIMARY KEY AUTOINCREMENT,                                         │
│   symbol TEXT NOT NULL,                                                         │
│   observation_date TEXT NOT NULL,                                               │
│   total_call_volume INTEGER,                                                    │
│   total_put_volume INTEGER,                                                     │
│   put_call_volume_ratio REAL,                                                   │
│   put_call_oi_ratio REAL,                                                       │
│   sentiment TEXT,               -- 'bullish'|'bearish'|'neutral'                │
│   fetched_at INTEGER DEFAULT (unixepoch()),                                     │
│   UNIQUE(symbol, observation_date)                                              │
│ );                                                                              │
│                                                                                 │
│ CREATE TABLE IF NOT EXISTS short_interest (                                     │
│   id INTEGER PRIMARY KEY AUTOINCREMENT,                                         │
│   symbol TEXT NOT NULL,                                                         │
│   report_date TEXT NOT NULL,                                                    │
│   short_volume INTEGER,                                                         │
│   total_volume INTEGER,                                                         │
│   short_volume_ratio REAL,                                                      │
│   prior_ratio REAL,                                                             │
│   trend TEXT,                   -- 'increasing'|'decreasing'|'stable'           │
│   squeeze_risk TEXT,            -- 'high'|'moderate'|'low'                      │
│   fetched_at INTEGER DEFAULT (unixepoch()),                                     │
│   UNIQUE(symbol, report_date)                                                   │
│ );                                                                              │
│                                                                                 │
│ Options Flow (Yahoo Finance — no API key)                                       │
│                                                                                 │
│ Endpoint: GET https://query1.finance.yahoo.com/v7/finance/options/{symbol}      │
│                                                                                 │
│ PCR thresholds:                                                                 │
│ - PCR < 0.5 → bullish, eventType 'heavy_call_buying', importance 0.70           │
│ - PCR > 1.5 → bearish, eventType 'heavy_put_buying', importance 0.75            │
│ - 0.5–1.5 → no event (noise suppression)                                        │
│                                                                                 │
│ Runs for all CORE_WATCHLIST (11 symbols) daily. Screener top-25 optionally.     │
│                                                                                 │
│ Short Interest (FINRA — free, no key)                                           │
│                                                                                 │
│ URL: https://cdn.finra.org/equity/regsho/monthly/CNMSshvol{YYYYMM}.txt          │
│ (tab-delimited)                                                                 │
│ - shortVolumeRatio = ShortVolume / TotalVolume                                  │
│ - Squeeze setup: shortVolumeRatio > 0.45 AND RSI < 35 → bullish, importance     │
│ 0.80                                                                            │
│ - Short buildup: shortVolumeRatio > 0.50 AND trend = 'increasing' → bearish,    │
│ importance 0.65                                                                 │
│                                                                                 │
│ SentimentAgent queries technicals table for RSI when generating squeeze events. │
│                                                                                 │
│ Source Weights in scoreResearchEvents() (research.ts)                           │
│                                                                                 │
│ - options_flow: weight 12                                                       │
│ - short_interest: weight 10                                                     │
│                                                                                 │
│ New API Routes                                                                  │
│                                                                                 │
│ GET /api/sentiment/options              — all symbols' current PCR + sentiment  │
│ GET /api/sentiment/options/:symbol      — symbol-specific options flow          │
│ GET /api/sentiment/short-interest       — all symbols' latest short interest    │
│ GET /api/sentiment/squeeze-candidates   — squeeze_risk = 'high' stocks          │
│                                                                                 │
│ ---                                                                             │
│ Implementation Order (Cross-Phase)                                              │
│                                                                                 │
│ 1. Phase 18 DB tables              → db.ts additions (no breaking changes)      │
│ 2. Phase 18 server/hedgeFund.ts    → EDGAR fetch + XML parse + CUSIP map +      │
│ change detection                                                                │
│ 3. Extend ResearchSourceType       → research.ts type union +                   │
│ scoreResearchEvents() weights                                                   │
│ 4. Phase 19 server/agents/base.ts  → BaseAgent class                            │
│ 5. Phase 19 coordinator.ts         → extract trade loop from agent.ts           │
│ 6. Phase 19 researchIngestion.ts   → extract ingestion from agent.ts            │
│ 7. Phase 19 screener/knowledge.ts  → wrap existing modules                      │
│ 8. Phase 19 registry.ts            → wire everything, update index.ts           │
│ 9. Phase 19 hedgeFund.ts agent     → wrap Phase 18 module                       │
│ 10. Phase 20 DB tables + macro.ts  → FRED client + regime classifier            │
│ 11. Phase 20 macro agent           → wire into registry, update                 │
│ research/risk/strategy params                                                   │
│ 12. Phase 21 DB tables + sentiment.ts → options + short interest fetcher        │
│ 13. Phase 21 sentiment agent       → wire into registry                         │
│ 14. API routes (all phases)        → add to index.ts                            │
│ 15. Frontend SmartMoney.tsx        → 13F dashboard component                    │
│ 16. Frontend agent status panel    → show all 7 agents in Settings or new tab   │
│                                                                                 │
│ ---                                                                             │
│ Critical Files to Modify                                                        │
│                                                                                 │
│ ┌────────────────────────┬────────────────────────────────────────────────────┐ │
│ │          File          │                       Change                       │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ server/db.ts           │ Add 5 new tables (hedge_fund_*, macro_*,           │ │
│ │                        │ options_flow, short_interest)                      │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ server/agent.ts        │ Decompose → thin re-export wrapper; logic moves to │ │
│ │                        │  agents/                                           │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ server/research.ts     │ Extend ResearchSourceType, add 3 new source        │ │
│ │                        │ weights, add macroRegime param                     │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ server/strategy.ts     │ Add macroRegime optional param to                  │ │
│ │                        │ deriveBaseTargetWeight                             │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ server/risk.ts         │ Add macroRegime optional param to stop-loss        │ │
│ │                        │ threshold                                          │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ server/index.ts        │ Replace startAgent() with registry.startAll(), add │ │
│ │                        │  ~20 new routes                                    │ │
│ ├────────────────────────┼────────────────────────────────────────────────────┤ │
│ │ src/components/App.tsx │ Add "Smart Money" tab + agent status tab           │ │
│ └────────────────────────┴────────────────────────────────────────────────────┘ │
│                                                                                 │
│ Reference Patterns to Follow                                                    │
│                                                                                 │
│ - EDGAR fetch pattern: server/filings.ts — CIK resolution, submissions API, doc │
│  fetch, INSERT OR IGNORE                                                        │
│ - XML parsing: server/insiders.ts — xmlVal()/xmlAll() helpers for 13F XML       │
│ - Data source heartbeat: server/ops.ts — markDataSourceSuccess/Failure()        │
│ - Research event integration: server/research.ts — saveResearchEvents()         │
│ function                                                                        │
│ - Agent scheduling: current setInterval calls in server/index.ts → move to      │
│ agent run() methods                                                             │
│                                                                                 │
│ ---                                                                             │
│ Verification                                                                    │
│                                                                                 │
│ After Phase 18:                                                                 │
│ - npm run dev:server → no errors                                                │
│ - POST /api/hedge-funds/refresh → returns { ok: true, processed: N }            │
│ - GET /api/hedge-funds/changes → returns array of significant position changes  │
│ - GET /api/research/events?limit=20 → shows events with source_type =           │
│ 'hedge_fund'                                                                    │
│ - Signal candidates in next cycle reflect new hedge_fund research events        │
│ - tsc --noEmit → EXIT 0                                                         │
│                                                                                 │
│ After Phase 19:                                                                 │
│ - GET /api/agents/status → shows 7 agents, each with lastRunAt, running         │
│ - POST /api/agents/coordinator/stop → stops trading loop, others continue       │
│ - POST /api/agents/researchIngestion/start → classification loop restarts       │
│ independently                                                                   │
│ - No regression in existing trading behavior                                    │
│                                                                                 │
│ After Phase 20:                                                                 │
│ - GET /api/macro/regime → returns { regime: 'bull'|'bear'|'neutral', vix,       │
│ yieldCurve, ... }                                                               │
│ - Bear regime → buildSignalCandidates threshold is 28 (verify via logs)         │
│ - FOMC meeting day → research event with event_type = 'fed_decision' created    │
│                                                                                 │
│ After Phase 21:                                                                 │
│ - GET /api/sentiment/squeeze-candidates → returns symbols with high short       │
│ interest + oversold RSI                                                         │
│ - GET /api/sentiment/options/NVDA → returns PCR + OI ratio                      │
│ - Options flow events visible in GET /api/research/events 