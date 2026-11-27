# BULLHAUS Discord — Rebuild-Checkliste (Kurzreferenz)

Begleitdokument zu `BULLHAUS_Discord_Technische_Dokumentation_DE.md` (dort stehen alle Details). Diese Checkliste ist bewusst kompakt — nur Reihenfolge und Haken, keine Wiederholung der vollen Erklärungen.

## Vorbereitung
- [ ] Eigentümerschaft/Accounts geklärt (Discord, GitHub, Finnhub, Vendor-Dashboards)
- [ ] Git installiert
- [ ] Node.js ≥ 20 installiert
- [ ] Repository geklont (`https://github.com/fatihatl1/discord-mcp.git`)
- [ ] `npm ci`
- [ ] `npm run build`
- [ ] `.env` aus `.env.example` erstellt, `DISCORD_BOT_TOKEN` gesetzt, `DRY_RUN=true`

## Discord-Anwendung & Bot
- [ ] BULLHAUS-eigene Developer-Portal-Anwendung angelegt (`BULLHAUS AI`)
- [ ] Bot-Token erzeugt und als `DISCORD_BOT_TOKEN` gespeichert (nie committen)
- [ ] Keine privilegierten Intents nötig für MCP-Grundfunktion; `Server Members Intent` nur aktivieren, wenn `list_role_members` genutzt werden soll
- [ ] Bot per OAuth2 (`bot`-Scope, Berechtigung `268436496`) in die Guild eingeladen

## Rollen & Hierarchie
- [ ] `BULLHAUS AI`-Rolle über alle Rollen gezogen, die sie verwalten soll
- [ ] Alle 26 Nicht-`@everyone`-Rollen angelegt (siehe Rolleninventar, Abschnitt 5 der Hauptdokumentation)
- [ ] Alle Basisberechtigungen geprüft: nur `OWNER` hat `ADMINISTRATOR`
- [ ] `CHOBAN` angelegt: Basisberechtigung `0`, Farbe `#EC4899`, Position idealerweise direkt unter `GAMING` (kosmetisch, ggf. manueller Owner-Schritt nötig — siehe Hauptdokumentation Abschnitt 6)
- [ ] `MEMBERSHIP_GATED_ROLE_NAMES` in `src/community/roles.ts` enthält alle 11 gated Rollen inkl. `CHOBAN`

## Kategorien & Kanäle
- [ ] Alle 12 Kategorien in exakter Reihenfolge angelegt (Abschnitt 2)
- [ ] Alle 55 Unterkanäle angelegt (Abschnitt 3)
- [ ] Kategorie-/Kanal-Overwrites angewendet (am besten `apply_blueprint` mit `dry_run: true` zuerst)
- [ ] `CHOBAN`-Overwrites sind byte-identische Kopien von `GAMING` auf: Kategorie + general-chat + Gaming Room 1 + Gaming Room 2 + 1-on-1 + Livestream Gaming + Event Gaming

## Drittanbieter-Bots
- [ ] Pandez Guard Beta installiert & konfiguriert
- [ ] Dyno installiert, 5 Webhooks auf die 5 LOGS-Kanäle eingerichtet
- [ ] ServerStats installiert, STATS-Voice-Kanäle verbunden
- [ ] InviteLogger installiert
- [ ] Beemo installiert
- [ ] Upgrade.Chat installiert (Zahlungsprodukte extern konfiguriert)
- [ ] Ticket Tool installiert, Panel in `ticket-support` eingerichtet, Zielkategorie `OPENED TICKETS`
- [ ] Discohook Utils installiert

## Verifizierung & Onboarding
- [ ] Verifizierungsmechanismus für `verify-here` eingerichtet (Mechanismus war zum Zeitpunkt dieser Dokumentation nicht vollständig belegt — neu entscheiden/dokumentieren)
- [ ] Kanonische Pinned-Texte veröffentlicht (Abschnitt 4 der Hauptdokumentation, Original-Sprache beibehalten)
- [ ] `ticket-support`-Hinweistext live

## Automatisierung
- [ ] News Worker: `npm run news:dry` erfolgreich lokal getestet
- [ ] News Worker: GitHub Secrets `DISCORD_BOT_TOKEN`, `FINNHUB_API_KEY` gesetzt
- [ ] News Worker: Workflow aktiv, Cron `*/10 * * * *`, produktive Flags gesetzt (siehe Abschnitt 19)
- [ ] Membership Guard: `npm run membership-guard:dev` lokal read-only erfolgreich
- [ ] Membership Guard: Workflow aktiv, Cron `*/30 * * * *`, Secret `DISCORD_BOT_TOKEN` gesetzt

## Voice/Stage/AFK
- [ ] Alle Voice-Kanäle mit korrekten Nutzerlimits angelegt (Abschnitt 10)
- [ ] Alle Stage-Kanäle (Event, Event RU, Event Gaming) mit Audience-Pattern (Connect erlaubt, Stream/Speak verweigert für Zuschauer)
- [ ] `💤┃AFK` als Guild-AFK-Kanal konfiguriert

## Validierung vor Produktivbetrieb
- [ ] `npm run typecheck`, `npm run build`, `npm test` grün
- [ ] Effektive Berechtigungen für alle 15 Rollen aus der Validierungs-Checkliste (Hauptdokumentation Abschnitt 26) positiv **und** negativ geprüft
- [ ] `CHOBAN`-Sichtbarkeit mengengleich zu `GAMING` bestätigt (nicht nur Teilmenge)
- [ ] Membership Guard: `0` Violations
- [ ] Webhooks: genau 5, alle Dyno, auf die 5 LOGS-Kanäle
- [ ] Kein Secret-Wert in Repository, Dokumentation oder Logs
- [ ] Erst danach produktive Automatisierungen (News Worker, Membership Guard Cron) scharf schalten
