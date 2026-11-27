# BULLHAUS Discord — Technische Dokumentation

**Version:** 1.0 (aktueller Live-Stand) · **Stand:** 2026-11-27
**Guild:** BULLHAUS · **Guild-ID:** `1307135789364154459`
**Repository:** `C:\BULLHAUS\discord-mcp` (lokal) · `https://github.com/fatihatl1/discord-mcp` (origin, Push-Ziel) · `https://github.com/TinyGecko920/discord-mcp` (upstream, nur Referenz — Push dorthin ist historisch mit 403 fehlgeschlagen)
**Branch:** `main`

Dieses Dokument beschreibt den **aktuellen, vollständigen Zustand** des BULLHAUS-Discord-Servers und der zugehörigen Automatisierung. Es ist kein Änderungsprotokoll und nicht nach internen Projektphasen gegliedert. Ziel ist, dass ein technisch versierter Administrator, eine andere KI (ChatGPT, ein neuer Claude-Account) oder ein neuer Mitarbeiter den Server allein auf Basis dieses Dokuments und des Repositorys so originalgetreu wie technisch möglich wiederherstellen kann.

Jede Tatsachenbehauptung ist nach Herkunft eingeordnet:
- **Live bestätigt** — durch einen Read-Only-Zugriff auf den echten Discord-Server in dieser Sitzung verifiziert.
- **Repository-bestätigt** — aus Quellcode, Konfigurationsdateien oder Workflow-Dateien im Repository gelesen.
- **Historische Referenz** — frühere Architektur, die nicht mehr aktiv ist (wird nur erwähnt, um Verwechslung zu vermeiden).
- **Externe Vendor-Konfiguration ausstehend** — Einstellung existiert in einem Drittanbieter-Dashboard, ist von hier aus nicht einsehbar.
- **Eigentümerprüfung ausstehend** — Zugriff/Eigentümerschaft eines Accounts ist nicht formal dokumentiert.
- **Nicht aktuell belegt** — weder live noch im Repository nachweisbar; wird nicht erfunden.

---

## Inhaltsverzeichnis

1. Systemüberblick
2. Kategorienstruktur
3. Vollständiges Kanalinventar
4. Kanonische Pinned-Texte
5. Vollständiges Rolleninventar
6. Rollenhierarchie
7. Zugriffsmatrix
8. Community-Rollenmodell
9. Schreibrechte-Matrix
10. Voice-/Stage-Modell
11. Onboarding- und Verifizierungsablauf
12. Membership Guard
13. BULLHAUS AI — vollständiger Wiederaufbau
14. Discord Developer Portal — Anwendungen
15. Vendor-Bots (Drittanbieter)
16. Booster-Rolle
17. SERVER BOTS-Rolle
18. Webhooks
19. News Worker (Finnhub)
20. Discord MCP — vollständige Wiederaufbauanleitung
21. Claude Code-Einrichtung
22. ChatGPT / andere MCP-kompatible Clients
23. GitHub / CI/CD
24. Umgebungsvariablen- und Secrets-Register
25. Rebuild-Reihenfolge / Disaster-Recovery-Verfahren
26. Berechtigungs-Validierungs-Checkliste
27. Sicherheitsbasis
28. Betriebsverfahren für zukünftige Änderungen
29. Grenzen dieser Dokumentation
30. Geplante nächste Schritte

---

## 1. Systemüberblick

BULLHAUS ist eine Trading- und Gaming-Community auf Discord, aufgebaut um ehrliche Markteinblicke, Livestreams und eine abgestufte Zugriffsstruktur für unterschiedliche Communities/Kohorten (Gaming, Trading EN, Trading RU) herum. Der Server wird vollständig über ein selbst entwickeltes MCP-Tool (Model Context Protocol) namens **Discord MCP** (`discord-provisioner-mcp`) verwaltet, das direkt gegen die Discord-REST-API arbeitet.

**Architekturüberblick (textuelle Darstellung):**

```
                        ┌───────────────────────────┐
                        │        Discord Guild       │
                        │          BULLHAUS          │
                        │   (1307135789364154459)    │
                        └──────────────┬─────────────┘
                                       │ REST (Bot-Token)
          ┌────────────────────────────┼─────────────────────────────┐
          │                            │                              │
┌─────────▼─────────┐     ┌────────────▼────────────┐      ┌──────────▼──────────┐
│   Discord MCP       │     │  GitHub Actions (CI/CD)  │      │  Drittanbieter-Bots  │
│ (discord-provisioner-│     │  - news-worker.yml       │      │  Dyno, Ticket Tool,   │
│  mcp, Node/TS)       │     │  - community-membership- │      │  ServerStats,         │
│  - stdio (Claude Code)│     │    guard.yml             │      │  InviteLogger, Beemo, │
│  - Streamable HTTP    │     │                           │      │  Upgrade.Chat,        │
│    (claude.ai Connector)    │  beide rufen intern den   │      │  Discohook Utils,     │
│  - treibt BULLHAUS AI │     │  gleichen Quellcode auf   │      │  Pandez Guard Beta    │
│    (Bot-Identität)     │     │  (News Worker, Membership │      │  (alle vendor-eigen,  │
└─────────┬─────────────┘     │   Guard)                  │      │   nicht BULLHAUS-     │
          │                    └───────────────────────────┘      │   eigene Apps)        │
          │                                                        └───────────────────────┘
┌─────────▼─────────┐
│   BULLHAUS AI       │  (Discord-Bot-Anwendung, einzige bestätigte BULLHAUS-eigene
│   (Bot-Account)      │   Developer-Portal-Anwendung — siehe Abschnitt 13/14)
└─────────┬─────────┘
          │ postet Nachrichten, verwaltet Rollen/Kanäle, liest Audit-Daten
          ▼
   Kanäle, Rollen, Pins, Übersichten
```

- **Repository:** `discord-provisioner-mcp`, Version `0.2.0` (Repository-bestätigt, `package.json`).
- **Node.js:** `>=20` erforderlich (Repository-bestätigt, `package.json engines`).
- **TypeScript-Build:** `tsc -p tsconfig.json`; Tests über `vitest`.
- **MCP SDK:** `@modelcontextprotocol/sdk ^1.17.0`, zusätzlich nur `zod` als Laufzeitabhängigkeit (bewusst minimal, kein `discord.js`).

**Zusammenspiel der Komponenten:**
- **Discord** ist die Zielumgebung (Guild, Rollen, Kanäle, Berechtigungen, Pins, Webhooks).
- **BULLHAUS AI** ist der einzige Bot-Account, der von diesem Projekt selbst betrieben wird; er führt sowohl die MCP-Schreibaktionen als auch den News Worker aus und postet die kanonischen Pinned-Nachrichten.
- **Discord MCP** ist die Steuerungsebene: Ein KI-Assistent (Claude Code, zukünftig ggf. andere MCP-Clients) spricht über MCP-Tools mit diesem Server, der wiederum die Discord-REST-API bedient.
- **GitHub Actions** führt zwei eigenständige, geplante Workflows aus: den News Worker (Finnhub-Marktnews) und den Membership Guard (Read-Only-Audit der Community-Rollen).
- **Membership Guard** ist eine reine Prüf-/Berichtsfunktion — sie vergibt und entzieht niemals Rollen automatisch.
- **Drittanbieter-Bots** (Dyno, Ticket Tool, ServerStats, InviteLogger, Beemo, Upgrade.Chat, Discohook Utils, Pandez Guard Beta) sind vendor-eigene Anwendungen, die über ihre eigenen Dashboards konfiguriert werden, nicht über dieses Repository.
- **Verifizierung/Tickets** laufen über die Kombination aus Discord-eigenen Rollen, Ticket Tool und einer manuellen Admin-Zuweisung der Community-Zugriffsrolle (siehe Abschnitt 11).

---

## 2. Kategorienstruktur

**Live bestätigt**, 12 Kategorien, exakte Reihenfolge:

| Pos. | Kategorie (Anzeigename) | ID | Zweck | Zugriffsmodell |
|---|---|---|---|---|
| 0 | `✦═══・LOBBY・═══✦` | `1319601384521203723` | Erstkontakt: Willkommen, Regeln, Verifizierung | Für `@everyone` sichtbar (Lesen), Schreiben gesperrt außer Bot |
| 1 | `✦═══・BOARD・═══✦` | `1319601403848560695` | Ankündigungen, Upgrade-Info, News-Kanäle | Für `@everyone` sichtbar (Lesen), Schreiben nur BULLHAUS AI |
| 2 | `✦═══・LOUNGE・═══✦` | `1572410165339095132` | Allgemeiner Community-Bereich | Erfordert `MEMBER` |
| 3 | `✦═══・GAMING FLOOR・═══✦` | `1572414147071578287` | Gaming-Community-Bereich | `MEMBER` + Zugriffsrolle (`GAMING`, `CHOBAN`, `F3NTM`, `BULLHAUS`), zusätzlich `COACH`, Scoped-Admins |
| 4 | `✦═══・TRADING FLOOR・═══✦` | `1319604838996246538` | Trading-Community (EN) | `MEMBER` + Zugriffsrolle (`BULLHAUS`, `TRADING`), zusätzlich `COACH`, `ADMIN-BULLHAUS` |
| 5 | `✦═══・TRADING FLOOR RU・═══✦` | `1572413604475441234` | Trading-Community (RU) | `MEMBER` + Zugriffsrolle (`TRADING`, `DVVV`), zusätzlich `COACH`, `ADMIN-RU` |
| 6 | `✦═══・HELP DESK・═══✦` | `1319605754537312296` | Fragen, Vorschläge, Ticket-Einstieg | Breit sichtbar (auch vor Verifizierung, siehe Abschnitt 11) |
| 7 | `✦═══・OPENED TICKETS・═══✦` | `1319605815585538079` | Container für dynamisch erzeugte private Ticket-Kanäle | Nur `ADMIN-GLOBAL`, `BULLHAUS AI`, Ticket Tool pauschal; einzelne Ticket-Kanäle zusätzlich per Member-Overwrite |
| 8 | `✦═══・STAFF・═══✦` | `1319605777287217172` | Interner Stab-Arbeitsbereich | `ADMIN-BULLHAUS`, `ADMIN-GAMING`, `ADMIN-RU`, `ADMIN-GLOBAL`, `BULLHAUS AI`, `SERVER BOTS` |
| 9 | `✦═══・STATS・═══✦` | `1319601301625245717` | Live-Mitglieder-/Bot-Zähler (Voice-Kanalnamen als Anzeige) | `ADMIN-GLOBAL`; `COACH`/`VIP` explizit ausgeschlossen |
| 10 | `✦═══・LOGS・═══✦` | `1319610433895665726` | Dyno-Logkanäle | `ADMIN-GLOBAL` (nur lesen), `BULLHAUS AI` |
| 11 | `✦═══・BOTS・═══✦` | `1319605695183847465` | Bot-Befehle, Invite-Tracking | `ADMIN-GLOBAL`, `SERVER BOTS`; `COACH`/`VIP` explizit ausgeschlossen |

---

## 3. Vollständiges Kanalinventar

**Live bestätigt.** 67 Channel-Objekte insgesamt (12 Kategorien + 55 Unterkanäle). Typkürzel: `text`, `voice`, `stage`, `forum`, `category`.

### LOBBY
| Kanal | ID | Typ | Zweck |
|---|---|---|---|
| 👋┃welcome | `1319608578054684754` | text | Einstiegspunkt, offizielle Links, Verweis auf Regeln/Verifizierung (Pinned-Text siehe Abschnitt 4) |
| 📜┃rules-and-disclaimer | `1319608588720668702` | text | Community-Regeln und Trading-/Affiliate-Disclaimer |
| ✅┃verify-here | `1319702015403626506` | text | Verifizierungs-Einstieg (kein Pin hinterlegt — **Nicht aktuell belegt**, welcher Verifizierungsbot/-mechanismus hier exakt greift; der Kanalname/die Position implizieren einen Verify-Schritt, das genaue Tool ist nicht aus Repository/Live-Daten ableitbar) |

### BOARD
| Kanal | ID | Typ | Zweck |
|---|---|---|---|
| 📩┃upgrade-⛔ | `1322983476307431494` | text | VIP-Mitgliedschaft, Premium-Kurse (gesperrter Schreibzugriff, Name trägt Sperrsymbol) |
| 📢┃announcements | `1319608695377629184` | text | Offizielle Updates, Videos, Livestreams |
| 📰┃trading-news | `1554782909272039476` | text | News Worker Zielkanal, Kategorie `general` |
| 📰┃forex-news | `1554783055535804470` | text | News Worker Zielkanal, Kategorie `forex` |
| 📰┃crypto-news | `1554838955294195863` | text | News Worker Zielkanal, Kategorie `crypto` |

### LOUNGE
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 🛋️┃Lounge | `1319731950000279554` | voice | Bitrate 64 kbps, Nutzerlimit 10 |
| 💬┃open-chat | `1572413392994574336` | text | Alltagsgespräche |
| 👥┃1-on-1 | `1572413401953607753` | voice | Bitrate 64 kbps, Nutzerlimit 2 |
| 💤┃AFK | `1319609929866153994` | voice | Bitrate 64 kbps, Nutzerlimit 0 (unbegrenzt) — AFK-Kanal der Guild |

### GAMING FLOOR
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 🎲┃general-chat | `1572414152620642504` | text | Allgemeiner Gaming-Chat |
| 🎮┃Gaming Room 1 | `1503836181639729202` | voice | Bitrate 64 kbps, Nutzerlimit 5 |
| 🎮┃Gaming Room 2 | `1554077246468399104` | voice | Bitrate 64 kbps, Nutzerlimit 5 |
| 👥┃1-on-1 | `1572414170115346503` | voice | Bitrate 64 kbps, Nutzerlimit 2 |
| 🔊┃Livestream Gaming | `1572414322796396604` | voice | Zuschauer können `CONNECT`, aber nicht `STREAM`/`SPEAK` — Presenter-Pattern |
| 🎤┃Event Gaming | `1572545370272047174` | stage | Discord-Stage-Kanal, Nutzerlimit 10000, gleiches Audience-Pattern wie Livestream |

### TRADING FLOOR
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 💬┃general-chat | `1319608771885928489` | text | Haupt-Trading-Chat |
| 🐂┃bullhaus-insights | `1554759799424417853` | text | Read-only-Kanal für Markteinblicke von BULLHAUS |
| 💰┃indices | `1554076221053214850` | text | Index-Marktanalyse |
| 🪙┃crypto | `1319732247477092444` | text | Krypto-Marktanalyse |
| 💸┃forex | `1323268910686015571` | text | FX-Marktanalyse |
| 📊┃other-markets | `1554077238088179842` | text | Gold, Öl, Rohstoffe, sonstige Instrumente |
| 🎉┃success-stories | `1319734880422203584` | text | Erfolge, Meilensteine |
| 📂┃resources-and-tools | `1319734370709274695` | text | Community-Ressourcen, Tools, Guides |
| 🔊┃Trading Floor 1 | `1319609883527741490` | voice | Bitrate 64 kbps, Nutzerlimit 5 |
| 🔊┃Trading Floor 2 | `1554077253946708059` | voice | Bitrate 64 kbps, Nutzerlimit 5 |
| 👥┃1-on-1 | `1554077261995442197` | voice | Bitrate 64 kbps, Nutzerlimit 2 |
| 🔊┃Livestream | `1572545191649345618` | voice | Zuschauer-Pattern wie GAMING FLOOR |
| 🎤┃Event | `1319690496427429898` | stage | Stage-Kanal, Nutzerlimit 10000 |

### TRADING FLOOR RU
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 🇷🇺┃general-chat | `1572413608933990603` | text | Russischsprachiger Haupt-Chat |
| 👤┃diyorovvvh-insights | `1572413613736595578` | text | Read-only-Markteinblicke (RU) |
| 🔊┃Trading Room 1 RU | `1572414114318258318` | voice | Bitrate 64 kbps, Nutzerlimit 5 |
| 🔊┃Trading Room 2 RU | `1572414121142521887` | voice | Bitrate 64 kbps, Nutzerlimit 5 |
| 👥┃1-on-1 RU | `1572414129661018413` | voice | Bitrate 64 kbps, Nutzerlimit 2 |
| 🔊┃Livestream RU | `1572414140213895311` | voice | Zuschauer-Pattern |
| 🎤┃Event RU | `1572545364983021691` | stage | Stage-Kanal, Nutzerlimit 10000 |

### HELP DESK
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 🎫┃ticket-support | `1319610281151827968` | text | Ticket-Einstieg über Ticket Tool |
| ❓┃questions | `1319690541272662087` | forum | Community-Fragen (Discord-Forum-Kanal) |
| 💡┃suggestions | `1319690581617934357` | forum | Verbesserungsvorschläge (Discord-Forum-Kanal) |

### OPENED TICKETS
Keine statischen Unterkanäle. Ticket Tool erzeugt hier dynamisch private Kanäle (ein Kanal pro offenem Ticket), jeweils mit individuellem Member-Overwrite für den Ticket-Ersteller plus den Kategorie-Grundrechten von `ADMIN-GLOBAL`/`BULLHAUS AI`/Ticket Tool. Es ist nicht notwendig (und nicht sinnvoll), einzelne Ticket-Instanzen zu dokumentieren — nur das Muster.

### STAFF
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 🔊┃Staff Voice | `1319610393567563797` | voice | Bitrate 64 kbps, unbegrenzt |
| 🔑┃staff-chat | `1319610321182392320` | text | Interne Koordination |
| 🔍┃mod-logs | `1319610351289110528` | text | Moderationslogs, Sicherheitsmeldungen |
| 🤖┃bot-setup | `1319610371237216337` | text | Konfigurationsbereich für Bots/Integrationen |
| 📩┃subscription-logs | `1322990945716928624` | text | Abonnement-/Mitgliedschaftsaktivität |

### STATS
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 👥┃Members: 10 | `1319715804593262626` | voice | Live-Zähler via ServerStats-Bot (Kanalname = Anzeige) |
| 🤖┃Bots: 9 | `1319715808599081033` | voice | Live-Zähler via ServerStats-Bot |

### LOGS
| Kanal | ID | Typ | Details |
|---|---|---|---|
| ⛔┃voice-logs | `1319610747973799946` | text | Dyno-Webhook-Zielkanal |
| ⛔┃channel-logs | `1319610502833246209` | text | Dyno-Webhook-Zielkanal |
| ⛔┃role-logs | `1319610491764477972` | text | Dyno-Webhook-Zielkanal |
| ⛔┃message-logs | `1319610465680228382` | text | Dyno-Webhook-Zielkanal |
| ⛔┃join-leave | `1319610678167998526` | text | Dyno-Webhook-Zielkanal |

### BOTS
| Kanal | ID | Typ | Details |
|---|---|---|---|
| 🤖┃commands | `1319610168685887540` | text | Bot-Befehlskanal |
| 📩┃invites-track | `1319610194098913300` | text | InviteLogger-Tracking |

---

## 4. Kanonische Pinned-Texte

**Live bestätigt** (aus den tatsächlich gepinnten Nachrichten, Autor durchgehend `BULLHAUS AI`). Original-Sprache unverändert übernommen (Englisch/Russisch bleiben im Original, nur die Dokumentation selbst ist Deutsch).

**👋┃welcome:**
> **Welcome to BULLHAUS.**
> **Trading. Insights. Community.**
>
> Trading insights, livestreams and real experiences, shared honestly and connected through a growing community.
>
> BULLHAUS grew out of my own trading journey. Over the past several years I have experienced progress, setbacks, good decisions, mistakes and the constant challenge of improving along the way.
>
> The idea behind BULLHAUS is to share that journey as it actually is — without unrealistic promises and without pretending that everything always goes according to plan.
>
> Here on Discord, the community comes together to exchange experiences, ask questions, learn from each other and work towards individual goals.
>
> **Official BULLHAUS Links**
> Website (bullhaus.ch) - Instagram (@bullhaux) - YouTube (@bullhaux)
>
> BULLHAUS is continuously growing. More free content, resources, community projects and additional features will be added over time.
>
> Selected partner and affiliate links may also be shared in the future. Using an affiliate link may support BULLHAUS at no additional cost to you.
>
> Before getting started, please read #rules-and-disclaimer and complete the verification process in #verify-here.
>
> **Welcome to the house.**
>
> **Community Access**
> After completing verification, please create a ticket in **ticket-support** and let us know how or through which community or invitation you joined the BULLHAUS Discord.
>
> Our team will then assign the appropriate community role and unlock the corresponding areas of the server.

**📜┃rules-and-disclaimer** (zwei Pins: Disclaimer, dann Regeln):
> **Trading & Financial Disclaimer**
> BULLHAUS shares personal trading experiences, market discussions, analyses, educational content and insights from an ongoing journey.
>
> All content shared through BULLHAUS — including analyses, trade ideas, results, screenshots, livestreams, educational material and community discussions — is provided for informational, educational and entertainment purposes only.
>
> Nothing shared within this community constitutes financial, investment or trading advice, an individual recommendation to buy or sell any financial instrument, or a guarantee of future results.
>
> Trading involves substantial risk and losses are possible. Past performance or individual results do not guarantee future performance.
>
> Always make your own decisions, conduct your own research and never risk money you cannot afford to lose.
>
> Content shared by community members represents their own opinions and experiences and should not be interpreted as an official BULLHAUS recommendation.
>
> **Affiliate Disclosure**
> Some links shared by BULLHAUS may be affiliate or partner links. If you choose to use one of these links, BULLHAUS may receive a commission or other benefit at no additional cost to you.
>
> The use of an affiliate link does not change the price for you and does not turn shared content into financial or investment advice.
>
> By participating in the BULLHAUS community, you acknowledge the information above and agree to follow these community rules.

> **Community Rules & Disclaimer**
> BULLHAUS is built around honest exchange, real experiences and learning together. To keep the community useful, respectful and welcoming, please follow a few simple rules.
>
> **Community Rules**
> • Treat everyone with respect. Different opinions are welcome — harassment, insults and personal attacks are not.
> • No spam, scams, malicious links or intentionally misleading content.
> • No unsolicited advertising or promotion of products, services or other communities.
> • Keep discussions constructive and use the appropriate channels whenever possible.
> • Do not impersonate BULLHAUS, staff members or other users.
> • Respect the privacy of other members. Do not share private conversations or personal information without permission.
> • Follow Discord's Terms of Service and Community Guidelines.

**📩┃upgrade-⛔ (Upgrade):**
> **Upgrade**
> Information about BULLHAUS VIP membership, premium courses and additional content.

**📢┃announcements:**
> **Announcements**
> Official BULLHAUS updates, new videos, livestreams and community news.

**💬┃open-chat (LOUNGE):**
> **Open Chat**
> A relaxed space for everyday conversations and exchange within the BULLHAUS community.

**🎲┃general-chat (GAMING FLOOR):**
> **General Chat**
> A community space for games, sessions, recommendations and general gaming conversation.

**💬┃general-chat (TRADING FLOOR):**
> **General Chat**
> The main BULLHAUS chat for markets, trading and community conversation.

**🐂┃bullhaus-insights:**
> **BULLHAUS Insights**
> Market observations, trading ideas and insights shared by BULLHAUS.

**💰┃indices:**
> **Indices**
> Discuss index market analysis, setups and trade ideas with the BULLHAUS community.

**🪙┃crypto:**
> **Crypto**
> Discuss crypto markets, setups and relevant developments with the BULLHAUS community.

**💸┃forex:**
> **Forex**
> Discuss FX markets, currency pairs and trading ideas with the BULLHAUS community.

**📊┃other-markets:**
> **Other Markets**
> Discuss gold, oil, commodities and other instruments with the BULLHAUS community.

**🎉┃success-stories:**
> **Success Stories**
> Share payouts, milestones and personal progress with the BULLHAUS community.

**📂┃resources-and-tools:**
> **Resources and Tools**
> Share and discover useful resources, tools and guides for trading and personal development.

**🇷🇺┃general-chat (TRADING FLOOR RU)** — *Original auf Russisch, unverändert:*
> **General Chat**
> Русскоязычный чат сообщества для обсуждения рынков, торговых идей и обмена мнениями.

**👤┃diyorovvvh-insights** — *Original auf Russisch, unverändert:*
> **Diyorovvvh Insights**
> Аналитика, торговые идеи и наблюдения за рынком от Diyorovvvh для русскоязычного сообщества BULLHAUS.

**📰┃forex-news:**
> **Forex News**
> Currency market updates, central bank decisions and important economic developments affecting the forex market.

**📰┃crypto-news:**
> **Crypto News**
> Cryptocurrency market updates, industry developments and important news from across the crypto ecosystem.

**🎫┃ticket-support:**
> **Ticket Support**
> Create a ticket if you need support or if your community access role still needs to be assigned after verification.

**✅┃verify-here, ❓┃questions, 💡┃suggestions:** Kein Pin hinterlegt — **Nicht aktuell belegt**.

---

## 5. Vollständiges Rolleninventar

**Live bestätigt**, 27 Rollen (inkl. `@everyone`), absteigend nach Position.

| Pos. | Rolle | ID | Farbe (Hex) | Managed | Hoist | Mentionable | Basis-Berechtigungen (Rohbitfeld) | Gated durch Membership Guard | Klassifikation |
|---|---|---|---|---|---|---|---|---|---|
| 25 | OWNER | `1319685469650550904` | #5B0096* | nein | ja | nein | `8` → `ADMINISTRATOR` | nein (ausgenommen) | Mensch, höchste Instanz |
| 24 | BULLHAUS AI | `1553380662738812958` | #349B5B* | **ja** (bot_id `1553378404252778577`) | nein | nein | `2269798679571600` → kein `ADMINISTRATOR`, u.a. `MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_WEBHOOKS, MANAGE_THREADS, MANAGE_EVENTS, MANAGE_MESSAGES, VIEW_AUDIT_LOG, …` | nein | Bot, BULLHAUS-eigen |
| 23 | ADMIN-GLOBAL | `1318670844267855892` | #7F2C9D* | nein | ja | nein | `4360657142546390` → kein `ADMINISTRATOR`, kein `MANAGE_GUILD`; u.a. `KICK_MEMBERS, BAN_MEMBERS, MANAGE_ROLES, MANAGE_CHANNELS, MODERATE_MEMBERS, MUTE/DEAFEN/MOVE_MEMBERS` | **ja** | Mensch, globaler Scoped-Admin |
| 22 | Pandez Guard | `1319702010915852363` | — | ja (bot_id `967155551211491438`) | nein | nein | `275146730694` | nein | Bot, Vendor |
| 21 | Dyno | `1319701549638881324` | — | ja (bot_id `155149108183695360`) | nein | nein | `1375077756038` | nein | Bot, Vendor |
| 20 | Discohook Utils | `1319701338959118338` | — | ja (bot_id `792842038332358656`) | nein | nein | `395674250240` | nein | Bot, Vendor |
| 19 | Upgrade.chat | `1322990318089539638` | — | ja (bot_id `543974987795791872`) | nein | nein | `277293943808` | nein | Bot, Vendor |
| 18 | Booster | `1318983395312930858` | #F4652F* | ja (`premium_subscriber`-Tag) | ja | nein | `0` | nein | System (Discord-eigen) |
| 17 | ADMIN-BULLHAUS | `1572408349780345015` | #8B38D2* | nein | ja | nein | `0` | **ja** | Mensch, Scoped-Admin (Trading EN) |
| 16 | ADMIN-RU | `1572408352846118964` | #4C1B55* | nein | ja | nein | `0` | **ja** | Mensch, Scoped-Admin (Trading RU) |
| 15 | ADMIN-GAMING | `1572408355408969770` | #1E360A* | nein | ja | nein | `0` | **ja** | Mensch, Scoped-Admin (Gaming) |
| 14 | COACH | `1319717394519953479` | #924C0E* | nein | ja | nein | `1024` → `VIEW_CHANNEL` | **ja** | Mensch, funktionale Rolle |
| 13 | VIP | `1503834949436964864` | #D4C037* | nein | ja | nein | `0` | nein (Badge) | Mensch, kosmetisches Abzeichen |
| 12 | INNERCIRCLE | `1554229707589816401` | #5B2676* | nein | ja | nein | `0` | nein (Badge) | Mensch, kosmetisches Abzeichen |
| 11 | DVVV | `1572408328427020388` | #1D493A* | nein | nein | nein | `0` | **ja** | Mensch, Community-Identität/Zugriff (RU) |
| 10 | BULLHAUS | `1572408325688266823` | #0F7C6E* | nein | nein | nein | `0` | **ja** | Mensch, Community-Identität/Zugriff |
| 9 | F3NTM | `1572408331232870460` | #15747D* | nein | nein | nein | `0` | **ja** | Mensch, Community-Identität/Zugriff (Gaming) |
| 8 | TRADING | `1572408334043054230` | #38B6F8* | nein | nein | nein | `0` | **ja** | Mensch, Community-Zugriff (Trading EN+RU) |
| 7 | GAMING | `1572408336295399428` | #A79D3A* | nein | nein | nein | `0` | **ja** | Mensch, Community-Zugriff (Gaming) |
| 6 | MEMBER | `1319685925265211443` | #649A4B* | nein | ja | nein | `515466709569` → u.a. `SEND_MESSAGES, CONNECT, SPEAK, CREATE_INSTANT_INVITE, CHANGE_NICKNAME, …` (**kein** `VIEW_CHANNEL`) | nein (Basisrolle selbst) | Mensch, verifizierte Basisrolle |
| 5 | Beemo | `1319701028186361882` | — | ja (bot_id `515067662028636170`) | nein | nein | `1391569792070` | nein | Bot, Vendor |
| 4 | InviteLogger | `1319701630949789698` | — | ja (bot_id `499595256270946326`) | nein | nein | `268462304` | nein | Bot, Vendor |
| 3 | Ticket Tool | `1319701910571192372` | — | ja (bot_id `557628352828014614`) | nein | nein | `277830822928` | nein | Bot, Vendor |
| 2 | ServerStats | `1319701986165133438` | — | ja (bot_id `458276816071950337`) | nein | nein | `1166352` | nein | Bot, Vendor |
| 1 | SERVER BOTS | `1319688160296439838` | #E92063* | nein | ja | nein | `0` | nein | System/Infrastruktur |
| 1 | **CHOBAN** | `1575829075988193285` | **#EC4899** | nein | nein | nein | `0` | **ja** | Mensch, Community-Zugriff (Gaming-äquivalent) |
| 0 | @everyone | `1307135789364154459` | — | nein | nein | nein | `322124731763520` → u.a. `SEND_MESSAGES, CONNECT, SPEAK, USE_APPLICATION_COMMANDS, …` (**kein** `VIEW_CHANNEL`, **kein** `ADMINISTRATOR`) | n/a | System (Discord-eigen) |

*Farbwerte mit `*` sind aus dem rohen Dezimalwert zurückgerechnet; exakte Hex-Darstellung kann bei Bedarf gegen den Rohwert (`color`-Feld, Dezimal) im Discord-Client verifiziert werden. `CHOBAN`s Farbe ist exakt spezifiziert (#EC4899, Dezimal `15485081`) und live bestätigt — keine Kollision mit einer anderen Rolle.

**Gated-/Badge-Klassifikation (Repository-bestätigt, `src/community/roles.ts`):**
- `MEMBERSHIP_GATED_ROLE_NAMES` (11): `F3NTM, BULLHAUS, DVVV, TRADING, GAMING, CHOBAN, COACH, ADMIN-GLOBAL, ADMIN-BULLHAUS, ADMIN-RU, ADMIN-GAMING`.
- `BADGE_ROLE_NAMES` (2, nie gated): `INNERCIRCLE, VIP`.
- `OWNER` ist bewusst von der Prüfung ausgenommen (muss immer volle Notfall-Kontrolle behalten, unabhängig von `MEMBER`).

**Hinweis zu `CHOBAN`:** `CHOBAN` ist eine reine Zugriffsrolle, funktional identisch zu `GAMING` (siehe Abschnitt 7/8). Ihre Basisberechtigung ist `0`; die gesamte Sichtbarkeit kommt ausschließlich aus kopierten Kategorie-/Kanal-Overwrites (siehe Abschnitt 3, GAMING FLOOR). `CHOBAN` wird aktuell von niemandem gehalten (0 Mitglieder).

---

## 6. Rollenhierarchie

**Live bestätigt**, höchste zu niedrigste Position:

```
OWNER (25)
  └─ BULLHAUS AI (24)            ← eigene Bot-Rolle, muss über allem stehen, das sie verwaltet
       └─ ADMIN-GLOBAL (23)
            └─ Pandez Guard (22) [managed]
                 └─ Dyno (21) [managed]
                      └─ Discohook Utils (20) [managed]
                           └─ Upgrade.chat (19) [managed]
                                └─ Booster (18) [managed, premium_subscriber]
                                     └─ ADMIN-BULLHAUS (17)
                                          └─ ADMIN-RU (16)
                                               └─ ADMIN-GAMING (15)
                                                    └─ COACH (14)
                                                         └─ VIP (13)
                                                              └─ INNERCIRCLE (12)
                                                                   └─ DVVV (11)
                                                                        └─ BULLHAUS (10)
                                                                             └─ F3NTM (9)
                                                                                  └─ TRADING (8)
                                                                                       └─ GAMING (7)
                                                                                            └─ MEMBER (6)
                                                                                                 └─ Beemo (5) [managed]
                                                                                                      └─ InviteLogger (4) [managed]
                                                                                                           └─ Ticket Tool (3) [managed]
                                                                                                                └─ ServerStats (2) [managed]
                                                                                                                     └─ SERVER BOTS (1)
                                                                                                                     └─ CHOBAN (1)   ← siehe Hinweis unten
                                                                                                                          └─ @everyone (0, fix)
```

**Warum die Hierarchie zählt:**
- `OWNER` muss immer über `BULLHAUS AI` stehen — ein Bot kann nie eine Rolle an oder über seiner eigenen Position verwalten; der Discord-Account-Eigentümer muss jederzeit uneingeschränkte Notfallkontrolle behalten.
- `BULLHAUS AI` muss über jeder Rolle stehen, die sie per `createRole`/`modifyRole`/`setChannelPermission` verwaltet — das betrifft praktisch alle Community- und Scoped-Admin-Rollen.
- Gemanagte Rollen (`Pandez Guard, Dyno, Discohook Utils, Upgrade.chat, Beemo, InviteLogger, Ticket Tool, ServerStats, Booster`) werden positionsmäßig von Discord bei der Bot-Installation automatisch eingefügt; ihre Position sollte nicht manuell gegen die Vendor-Erwartung verschoben werden.
- Ein Bot darf laut Discord-API niemals eine Rolle an oder über seiner eigenen höchsten Rolle verschieben — das gilt auch für die eigene Rolle selbst.

**Bekannter aktueller Sonderfall — `CHOBAN`s Position:** `CHOBAN` liegt aktuell auf Position `1` (knapp über `@everyone`, zahlenmäßig gleichauf mit `SERVER BOTS`). Die kosmetisch gewünschte Platzierung ist direkt unter `GAMING` und direkt über `MEMBER`. Das lässt sich nicht per Bot-Schreibzugriff herstellen: Die Rollenhierarchie ist zwischen Position 0 (`@everyone`, fix) und Position 25 (`OWNER`) lückenlos belegt; eine Einfügung an der gewünschten Stelle würde erzwingen, dass auch `BULLHAUS AI` und `OWNER` eine Position höher rutschen — und ein Bot darf nie eine Rolle an oder über seiner eigenen Position verschieben, auch nicht implizit die eigene Rolle. Das ist exakt dieselbe Einschränkung, die beim ursprünglichen Einfügen von `GAMING`/`TRADING` in diese Hierarchie bereits aufgetreten ist.
**Funktionale Auswirkung: keine.** Der Berechtigungsrechner (`computeEffectivePermissions`) berücksichtigt Rollenposition nie — Zugriff wird ausschließlich über Kategorie-/Kanal-Overwrites bestimmt. `CHOBAN`s Basisberechtigung ist `0`, daher hat die Position auch keine `MANAGE_ROLES`-Hierarchiebedeutung.
**Ausstehender manueller Schritt (nur kosmetisch, nur durch den Owner):** In Discord unter Server-Einstellungen → Rollen `CHOBAN` per Drag-and-Drop direkt unter `GAMING` ziehen. Der Owner-Account steht über jeder Rolle, Discord verschiebt `BULLHAUS AI`/`OWNER` dabei automatisch mit.

---

## 7. Zugriffsmatrix

**Live bestätigt** (Lese-Zugriff über den projekteigenen `computeEffectivePermissions`-Rechner gegen den echten Server berechnet). `✓` = Kategorie sichtbar, `—` = nicht sichtbar, `✓*` = sichtbar mit zusätzlichen Sonderrechten (siehe Fußnoten).

| Rolle | LOBBY | BOARD | LOUNGE | HELP DESK | GAMING FLOOR | TRADING FLOOR | TRADING FLOOR RU | OPENED TICKETS | STAFF | STATS | LOGS | BOTS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MEMBER | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — |
| F3NTM | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| GAMING | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| CHOBAN | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| BULLHAUS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| TRADING | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — |
| DVVV | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | — | — | — | — | — |
| INNERCIRCLE (Badge) | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — |
| VIP (Badge) | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — |
| COACH | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — |
| ADMIN-BULLHAUS | ✓ | ✓ | ✓ | ✓ | — | ✓* | — | — | ✓ | — | — | — |
| ADMIN-RU | ✓ | ✓ | ✓ | ✓ | — | — | ✓* | — | ✓ | — | — | — |
| ADMIN-GAMING | ✓ | ✓ | ✓ | ✓ | ✓* | — | — | — | ✓ | — | — | — |
| ADMIN-GLOBAL | ✓ | ✓ | ✓* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OWNER | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Fußnoten / Nuancen (Live bestätigt):**
- Alle Werte sind additiv zur `MEMBER`-Basis zu lesen (jede Zeile außer `MEMBER` selbst geht von `MEMBER + Rolle` aus — Discord-Berechtigungen sind additiv, eine Person hält praktisch immer `MEMBER` zusätzlich zu ihrer Zugriffsrolle).
- `LOBBY`, `BOARD` und `HELP DESK` sind in der Praxis bereits für `@everyone` (auch unverifizierte Nutzer) lesbar — nötig, damit Regeln/Verifizierung/Ticket-Eröffnung vor `MEMBER` funktionieren (siehe Abschnitt 11). `LOUNGE` ist dagegen strikt an `MEMBER` gebunden.
- `ADMIN-BULLHAUS`✓* auf TRADING FLOOR: zusätzlich `MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS` auf den Voice-Kanälen der Kategorie (Scoped-Voice-Moderation).
- `ADMIN-RU`✓* auf TRADING FLOOR RU: gleiches Muster, RU-Voice-Kanäle.
- `ADMIN-GAMING`✓* auf GAMING FLOOR: gleiches Muster, Gaming-Voice-Kanäle.
- `ADMIN-GLOBAL`✓* auf LOUNGE: zusätzliche, eigene `VIEW_CHANNEL`-Freigabe (unabhängig von `MEMBER`).
- `OPENED TICKETS`: pauschal nur `ADMIN-GLOBAL` + `BULLHAUS AI` + Ticket Tool; einzelne Ticket-Instanzen erhalten zusätzlich ein Member-Overwrite für den Ticket-Ersteller.
- Keine der 15 Rollen in dieser Matrix besitzt serverweite `ADMINISTRATOR`-, `MANAGE_GUILD`- oder `MANAGE_ROLES`-Basisberechtigung außer `OWNER` (`ADMINISTRATOR`). `ADMIN-GLOBAL`s weite Sichtbarkeit kommt aus expliziten Kategorie-Overwrites, nicht aus einer serverweiten Admin-Berechtigung.

---

## 8. Community-Rollenmodell

**Live bestätigt (135/135 automatisierte Prüfungen, Read-Only gegen den echten Server):**

- **GAMING** = `MEMBER`-Basis + ausschließlich `GAMING FLOOR`.
- **CHOBAN** = exakt dieselbe Sichtbarkeitsmenge wie `GAMING` (mengengleich geprüft, nicht nur Teilmenge) — gleiche sieben kopierten Overwrites auf Kategorie + 6 Unterkanäle (`general-chat, Gaming Room 1, Gaming Room 2, 1-on-1, Livestream Gaming, Event Gaming`), keine Moderationsrechte.
- **F3NTM** = `MEMBER`-Basis + ausschließlich `GAMING FLOOR`.
- **BULLHAUS** = `MEMBER`-Basis + `GAMING FLOOR` + `TRADING FLOOR` (nicht RU).
- **TRADING** = `MEMBER`-Basis + `TRADING FLOOR` + `TRADING FLOOR RU`, **kein** `GAMING FLOOR`.
- **DVVV** = `MEMBER`-Basis + ausschließlich `TRADING FLOOR RU` (kein `GAMING FLOOR`, kein normales `TRADING FLOOR`).
- **ADMIN-RU** = `DVVV`-äquivalente Basis + `TRADING FLOOR RU` + `STAFF`, mit RU-beschränkter Voice-Moderation (`MUTE/DEAFEN/MOVE_MEMBERS` nur auf RU-Voice-Kanälen); kein `GAMING FLOOR`/`TRADING FLOOR`/`STATS`/`LOGS`/`BOTS`; keine serverweite `ADMINISTRATOR`/`MANAGE_GUILD`/`MANAGE_ROLES`/`KICK`/`BAN`/`MODERATE_MEMBERS`/`MANAGE_CHANNELS`-Basisberechtigung.
- **VIP, INNERCIRCLE** = reine kosmetische Abzeichen; Sichtbarkeit ist exakt gleich der `MEMBER`-Basis, keine zusätzliche Freigabe.
- **COACH** sieht `GAMING FLOOR` + `TRADING FLOOR` + `TRADING FLOOR RU` zusätzlich zur Basis, ohne eigene Moderationsrechte in diesen Kategorien.
- **ADMIN-GLOBAL** sieht alles (inkl. `STAFF`/`STATS`/`LOGS`/`BOTS`), besitzt aber keine serverweite `ADMINISTRATOR`/`MANAGE_GUILD`-Basisberechtigung — die Reichweite kommt aus expliziten Kategorie-Overwrites.
- **BULLHAUS AI** behält Zugriff auf `bot-setup` (STAFF) und ist **nicht** `ADMINISTRATOR` (siehe decodiertes Bitfeld in Abschnitt 5).
- **OWNER** sieht alles und besitzt als einzige Rolle die serverweite `ADMINISTRATOR`-Basisberechtigung.

---

## 9. Schreibrechte-Matrix (ausgewählte wichtige Kanäle)

| Kanal | Wer sieht | Wer schreibt | Wer moderiert | Automatisch bespielt |
|---|---|---|---|---|
| LOBBY/BOARD-Kanäle | `@everyone` (auch unverifiziert) | nur `BULLHAUS AI` (Ankündigungen/News) | `ADMIN-GLOBAL` | News-Kanäle: News Worker (Finnhub) |
| 🐂┃bullhaus-insights | `MEMBER`+`BULLHAUS`/`TRADING`/`GAMING`-Trading-Pfad (TRADING FLOOR) | nur `BULLHAUS AI` (read-only für Mitglieder, kein explizites `SEND_MESSAGES`-Grant an Community-Rollen über die reine Kategoriesicht hinaus) | `ADMIN-BULLHAUS`, `ADMIN-GLOBAL` | Nein, manuell durch BULLHAUS |
| 👤┃diyorovvvh-insights | `MEMBER`+`TRADING`/`DVVV`/`ADMIN-RU` (TRADING FLOOR RU) | nur `BULLHAUS AI` (read-only-Charakter) | `ADMIN-RU`, `ADMIN-GLOBAL` | Nein, manuell |
| 📂┃resources-and-tools | `MEMBER`+`BULLHAUS`/`TRADING` (TRADING FLOOR) | Community-Mitglieder mit TRADING-FLOOR-Zugriff | `ADMIN-BULLHAUS`, `ADMIN-GLOBAL` | Nein |
| Community-Chats (open-chat, general-chat×3) | je nach Kategorie-Zugriff | je nach Kategorie-Zugriff (Standard-Chat-Rechte aus `MEMBER`-Basis) | zuständige Scoped-Admins + `ADMIN-GLOBAL` | Nein |
| 📰┃trading-news / forex-news / crypto-news | `@everyone` | nur `BULLHAUS AI` | `ADMIN-GLOBAL` | **Ja** — News Worker, produktiv aktiv (siehe Abschnitt 19) |
| 🔑┃staff-chat, 🔍┃mod-logs, 🤖┃bot-setup, 📩┃subscription-logs (STAFF) | Scoped-Admins + `ADMIN-GLOBAL` + `BULLHAUS AI` + `SERVER BOTS` | dieselbe Gruppe | `ADMIN-GLOBAL` | Nein |
| ⛔┃*-logs (LOGS) | nur `ADMIN-GLOBAL` (lesend, `SEND_MESSAGES` explizit verweigert) + `BULLHAUS AI` | **niemand aus der Community** — nur Dyno via Webhook | `ADMIN-GLOBAL` (lesend) | **Ja** — Dyno-Webhooks (siehe Abschnitt 18) |

---

## 10. Voice-/Stage-Modell

**Live bestätigt.** Alle Standard-Voice-Kanäle laufen mit 64 kbps Bitrate. Nutzerlimits siehe Abschnitt 3 im Detail; Zusammenfassung:

| Bereich | Voice-Kanäle (Limit) | Stage-Kanal | Besonderheit |
|---|---|---|---|
| LOUNGE | Lounge (10), 1-on-1 (2), AFK (0 = Guild-AFK-Kanal) | — | `AFK` ist der konfigurierte Guild-AFK-Kanal |
| GAMING FLOOR | Gaming Room 1 (5), Gaming Room 2 (5), 1-on-1 (2), Livestream Gaming (0) | Event Gaming (10000) | Livestream/Stage: Zuschauer dürfen `CONNECT`, **nicht** `STREAM`/`SPEAK` — reines Presenter→Zuschauer-Pattern |
| TRADING FLOOR | Trading Floor 1 (5), Trading Floor 2 (5), 1-on-1 (2), Livestream (0) | Event (10000) | gleiches Muster |
| TRADING FLOOR RU | Trading Room 1/2 RU (5/5), 1-on-1 RU (2), Livestream RU (0) | Event RU (10000) | gleiches Muster |
| STAFF | Staff Voice (0) | — | nur Stab-Rollen |

**Moderationsrechte in Voice/Stage:**
- `ADMIN-BULLHAUS`: `MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS` auf allen TRADING-FLOOR-Voice-Kanälen.
- `ADMIN-RU`: dieselben Rechte, aber nur auf TRADING-FLOOR-RU-Voice-Kanälen.
- `ADMIN-GAMING`: dieselben Rechte, aber nur auf GAMING-FLOOR-Voice-Kanälen.
- `ADMIN-GLOBAL`: weiterreichende serverweite Voice-Moderationsrechte (`MUTE/DEAFEN/MOVE_MEMBERS` im Basis-Bitfeld, siehe Abschnitt 5), nicht nur kategorienweit.
- `COACH` hat **keine** zusätzlichen Voice-Moderationsrechte — nur `VIEW_CHANNEL` in seinen drei Zielkategorien. Eine spezifische "Presenter"-Erweiterung für `COACH` auf einem einzelnen Livestream-Kanal ist in den aktuell gelesenen Overwrites nicht als eigener COACH-Eintrag sichtbar; falls ein solcher Sonderfall operativ existiert, ist er **nicht aktuell belegt** und müsste gesondert verifiziert werden.
- `STATS`-Kategorie-Voice-Kanäle (`Members: N`, `Bots: N`) sind reine Anzeige-Kanäle; nur der `ServerStats`-Bot kann sich verbinden (`CONNECT`), für `@everyone` ist `CONNECT` verweigert — die Kanalnamen selbst sind aber die eigentliche Information und für jeden sichtbar, der die STATS-Kategorie sehen darf (aktuell nur `ADMIN-GLOBAL`/`OWNER`/`BULLHAUS AI`).

---

## 11. Onboarding- und Verifizierungsablauf

**Live bestätigt + Repository-bestätigt (zusammengesetzt aus Kanalstruktur, Pinned-Texten und `membership_guard.ts`):**

1. **Beitritt.** Ein neuer Nutzer tritt der Guild bei und erhält zunächst keine Rolle außer `@everyone`.
2. **Unverifizierter Zustand.** `@everyone` kann `LOBBY`, `BOARD` und `HELP DESK` lesen (nicht aber `LOUNGE` oder die Floor-Kategorien) — ausreichend, um sich zu orientieren, Regeln zu lesen und Hilfe zu finden, ohne bereits Mitglied zu sein.
3. **Regeln lesen** in `📜┃rules-and-disclaimer`.
4. **Verifizierung** über `✅┃verify-here` (der genaue technische Verifizierungsmechanismus — Reaction-Role, externer Verify-Bot, Captcha o. Ä. — ist **nicht aktuell belegt**; weder Repository noch Live-Overwrites zeigen einen dedizierten Verifizierungsbot für diesen Kanal. Falls hierfür ein separates Tool im Einsatz ist, gehört es in die Vendor-Konfigurationssicherung, siehe Abschnitt 30).
5. **`MEMBER` wird zugewiesen** (Mechanismus der Zuweisung selbst ebenfalls **nicht aktuell belegt** — ob manuell durch einen Admin oder automatisiert durch ein Verify-Tool).
6. **`ticket-support`**: Laut dem kanonischen Willkommenstext soll der Nutzer nach der Verifizierung ein Ticket öffnen und mitteilen, über welche Community/Einladung er beigetreten ist.
7. **Community-/Kohorten-Identifikation**: Ein Admin liest das Ticket und ordnet den Nutzer einer Kohorte zu (Gaming, Trading EN, Trading RU, …).
8. **Manuelle Rollenzuweisung**: Ein autorisierter Admin weist **von Hand** die passende Zugriffsrolle zu (`F3NTM`, `BULLHAUS`, `DVVV`, `TRADING`, `GAMING`, `CHOBAN`, ggf. einen Scoped-Admin). Dies ist ausdrücklich **kein automatisierter Schritt** — es gibt im gesamten Repository keinen Code-Pfad, der eine gated Rolle automatisch vergibt.
9. **Zugriff öffnet sich** augenblicklich durch die Kategorie-/Kanal-Overwrites, die bereits auf der Zugriffsrolle liegen.
10. **Membership Guard** prüft periodisch read-only, ob jemand eine gated Rolle **ohne** `MEMBER` hält (siehe Abschnitt 12).

**Warum das nicht rein technisch über Discord-Overwrites lösbar ist:** Discord-Berechtigungsüberschreibungen kennen keine boolesche UND-Verknüpfung zwischen zwei beliebigen Rollen ("MEMBER UND GAMING") als Freigabebedingung für einen Kanal — ein Overwrite ist pro Rolle unabhängig, und das Ergebnis mehrerer Rollen-Overwrites wird durch Vereinigung (OR) der Allow-/Deny-Bits gebildet, nicht durch eine Konjunktion. Man könnte zwar rein technisch jeder Zugriffsrolle für sich die Sichtbarkeit geben (was hier auch so gemacht wird — `GAMING` alleine reicht aus, um `GAMING FLOOR` zu sehen) — aber die Regel "**nur** mit zusätzlichem `MEMBER`" lässt sich nicht als Discord-Overwrite-Bedingung ausdrücken, sondern ist eine **organisatorische** Regel ("ein Admin vergibt diese Rolle ohnehin erst nach Verifizierung"). Genau deshalb existiert der **Membership Guard**: nicht als automatischer Durchsetzer (der könnte bei einer legitimen Zwischenzeit — z. B. einer laufenden Neuverifizierung — fälschlich eine Community-Rolle entziehen), sondern als **reines Read-Only-Audit**, das einen Menschen auf eine Abweichung hinweist, damit dieser bewusst entscheidet.

---

## 12. Membership Guard

**Repository-bestätigt** (`src/community/roles.ts`, `src/community/membership_guard.ts`, CLI `src/community/cli.ts`).

- **Zweck:** Read-Only-Prüfung, ob ein Mensch eine gated Community-/Admin-Rolle hält, **ohne** gleichzeitig `MEMBER` zu halten.
- **Gated-Rollenliste (11):** `F3NTM, BULLHAUS, DVVV, TRADING, GAMING, CHOBAN, COACH, ADMIN-GLOBAL, ADMIN-BULLHAUS, ADMIN-RU, ADMIN-GAMING`.
- **Badge-Ausnahmen (2, nie gated):** `INNERCIRCLE, VIP`.
- **`OWNER`** ist immer ausgenommen (muss unabhängig von `MEMBER` volle Notfallkontrolle behalten).
- **Bots** werden immer ignoriert (`user.bot === true` wird übersprungen) — sie sind nie Teil dieses Community-Modells.
- **Warum Read-Only und kein automatischer Korrektor:** Ein automatisches Entziehen einer Community-Rolle wäre eine potenziell destruktive Aktion — ein Mensch könnte `MEMBER` z. B. während einer Neuverifizierung oder einer Moderationsmaßnahme vorübergehend verlieren, ohne dass die Absicht besteht, ihm die Community-Rolle zu entziehen. Es existiert im Code bewusst **kein Ausführungspfad**, der eine Rolle verändert — `auditMembership` ist eine reine, seiteneffektfreie Funktion.
- **CLI:** `npm run membership-guard` (kompilierter Build, `node dist/community/cli.js`) bzw. `npm run membership-guard:dev` (tsx, ohne vorherigen Build).
- **GitHub Actions:** `.github/workflows/community-membership-guard.yml` — Trigger: `workflow_dispatch` (manuell) + `schedule` mit Cron `*/30 * * * *` (alle 30 Minuten). `permissions: contents: read`. Eigene Concurrency-Gruppe `bullhaus-community-membership-guard` mit `cancel-in-progress: true`. Benötigtes Secret: `DISCORD_BOT_TOKEN` (Name only — kein Wert hier).
- **Validierung nach einem Rebuild:** `npm run membership-guard:dev` lokal gegen das echte `.env` ausführen (liest nur, schreibt nichts) und prüfen, dass `0` Violations zurückkommen, nachdem alle Community-Rollen neu zugewiesen wurden.
- **Live bestätigt (letzter Lauf dieser Dokumentationserstellung):** 11 gated Rollen aufgelöst (inkl. `CHOBAN`), 19 Mitglieder gescannt (10 Menschen, 9 Bots), **0 Violations**.

---

## 13. BULLHAUS AI — vollständiger Wiederaufbau

**Repository-/Live-bestätigt, wo möglich; Lücken klar markiert.**

| Feld | Wert |
|---|---|
| Bot-Rollenname in der Guild | `BULLHAUS AI` |
| Bot-User-ID | `1553378404252778577` (aus dem `bot_id`-Tag der gemanagten Rolle) |
| Gemanagte Rolle (ID) | `1553380662738812958`, Position `24` |
| Serverweite Basisberechtigungen | **Kein** `ADMINISTRATOR`. Gewährt: `MANAGE_CHANNELS, VIEW_AUDIT_LOG, VIEW_CHANNEL, SEND_MESSAGES, MANAGE_MESSAGES, EMBED_LINKS, ATTACH_FILES, READ_MESSAGE_HISTORY, MANAGE_ROLES, MANAGE_WEBHOOKS, USE_APPLICATION_COMMANDS, MANAGE_EVENTS, MANAGE_THREADS, CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS, SEND_MESSAGES_IN_THREADS, CREATE_EVENTS, PIN_MESSAGES` |
| Explizit **nicht** gewährt | `ADMINISTRATOR, MANAGE_GUILD, KICK_MEMBERS, BAN_MEMBERS, MODERATE_MEMBERS, MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS` |
| Benötigte privilegierte Gateway-Intents | **Keine.** Dieser Server arbeitet ausschließlich über REST, öffnet nie eine Gateway-Verbindung (Repository-bestätigt, README: *"No privileged gateway intents are needed; this server uses REST only."*). **Ausnahme:** Das MCP-Tool `list_role_members` (und der zugrunde liegende `GET /guilds/{guild}/members`-Endpunkt) verlangt trotzdem, dass **Server Members Intent** im Developer Portal (Bot-Tab) aktiviert ist — Discord sperrt diesen REST-Endpunkt hinter demselben Schalter wie den Gateway-Intent, auch ohne Gateway-Verbindung. Ohne aktivierten Intent antwortet Discord nicht mit einer leeren Liste, sondern mit `403`/Code `50001`. |
| OAuth2-Scopes / Invite-Flow | Minimalpermissions laut README: `bot`-Scope, Berechtigungsintegerwert `268436496` (`MANAGE_CHANNELS + VIEW_CHANNEL + MANAGE_ROLES`). Invite-URL-Muster: `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot&permissions=268436496`. Die einladende Person braucht `Manage Server` auf der Zielguild. |
| Token-Handling | Umgebungsvariable `DISCORD_BOT_TOKEN` (nur Name, nie Wert hier). Wird von der Logger-Redaction-Liste erfasst und erscheint nie in Logs/Fehlermeldungen/Tool-Ausgaben. |
| GitHub-Secret-Nutzung | `secrets.DISCORD_BOT_TOKEN` in beiden Workflow-Dateien. |
| MCP-/News-Worker-/Kanonische-Nachrichten-Nutzung | BULLHAUS AI führt alle MCP-Schreibwerkzeuge aus, postet alle kanonischen Pinned-Texte (Autor in allen Pins), publiziert die News-Kanäle. |
| `bot-setup`-Zugriff | Ja (STAFF-Kategorie, eigenes Overwrite). |
| `SERVER BOTS`-Mitgliedschaft | Ja — hält `SERVER BOTS` + `BULLHAUS AI`. |
| Härtungshinweise | Kein `ADMINISTRATOR`; Self-Role-Edit-Schutz im MCP (kann die eigene gemanagte Rolle nicht editieren); Hierarchie-Schutz (kann keine Rolle an/über eigener Position verändern); keine Tools zum Kicken/Bannen/Guild-löschen/Ownership-Transfer im MCP-Tool-Set. |
| Discord-App-Name, genaue Bot-Account-Anzeigenamen-Historie, exakte OAuth-Redirect-URIs (falls je verwendet) | **MUSS VERIFIZIERT / ERFASST WERDEN** — nicht aus Repository/Live-Daten ableitbar. |

**Rebuild-Schritte (Repository-bestätigt, README "Creating the Discord application and bot"):**
1. `https://discord.com/developers/applications` → *New Application*.
2. Bot-Tab öffnen → *Reset Token* → als `DISCORD_BOT_TOKEN` speichern (wie ein Passwort behandeln).
3. Keine privilegierten Gateway-Intents aktivieren (nicht nötig für den MCP-Teil) — **außer** `list_role_members` soll genutzt werden, dann `Server Members Intent` im Bot-Tab aktivieren.
4. Invite-Link mit `bot`-Scope und Minimalberechtigung `268436496` erzeugen und auf der Zielguild mit `Manage Server`-Rechten öffnen.
5. Rollenhierarchie: `BULLHAUS AI`-Rolle in Server-Einstellungen → Rollen über alle Rollen ziehen, die sie verwalten soll.

---

## 14. Discord Developer Portal — Anwendungen

**Repository-/Live-bestätigt:** `BULLHAUS AI` ist die **einzige bestätigte BULLHAUS-eigene** Discord-Developer-Portal-Anwendung. Alle anderen Bots in der Guild (`Dyno, Ticket Tool, ServerStats, InviteLogger, Beemo, Upgrade.Chat, Discohook Utils, Pandez Guard Beta`) sind **Drittanbieter-/Vendor-Anwendungen**, die nicht im BULLHAUS-eigenen Developer Portal verwaltet werden und dort auch nicht erscheinen sollten. Es gibt keinen Hinweis auf weitere, historische oder aktuell noch existierende, BULLHAUS-eigene Custom-Anwendungen über `BULLHAUS AI` hinaus.

---

## 15. Vendor-Bots (Drittanbieter)

**Live bestätigt für Rollen-/Berechtigungsdaten; externe Dashboard-Konfiguration ist grundsätzlich "Externe Vendor-Konfiguration ausstehend", sofern nicht anders vermerkt.**

| Bot | Zweck in BULLHAUS | Rollen-ID / Position | SERVER BOTS? | Kanalzugriff (Auszug) | Bestätigter Stand |
|---|---|---|---|---|---|
| **Pandez Guard Beta** | Moderations-/Schutz-Bot | `1319702010915852363` / Pos. 22 | ja | Guild-weit (`VIEW_CHANNEL`, `MANAGE_MESSAGES`, `MANAGE_ROLES` u.a. im Basis-Bitfeld) | Rollenrechte live bestätigt; Dashboard-Konfiguration ausstehend |
| **Dyno** | Logging (5 Webhooks in LOGS) + Moderation | `1319701549638881324` / Pos. 21 | ja | LOGS-Kanäle via Webhook (siehe Abschnitt 18) | Webhook-Ziele live bestätigt; übrige Dyno-Dashboard-Regeln ausstehend |
| **ServerStats** | Live-Mitglieder-/Bot-Zähler (STATS) | `1319701986165133438` / Pos. 2 | ja | `CONNECT` in STATS-Voice-Kanälen | Kanalbindung live bestätigt |
| **InviteLogger** | Invite-Tracking (`invites-track`) | `1319701630949789698` / Pos. 4 | ja | BOTS-Kategorie | Rollenrechte live bestätigt; Dashboard-Regeln ausstehend |
| **Beemo** | Moderations-Bot | `1319701028186361882` / Pos. 5 | ja | Guild-weit laut Basis-Bitfeld (`KICK/BAN/MODERATE_MEMBERS` u.a.) | Rollenrechte live bestätigt; Dashboard-Regeln ausstehend |
| **Upgrade.Chat** | Zahlungs-/VIP-Abonnementabwicklung | `1322990318089539638` / Pos. 19 | ja | u.a. `MANAGE_ROLES` im Basis-Bitfeld (vergibt wahrscheinlich VIP-Rolle bei Zahlung) | Rollenrechte live bestätigt; Zahlungs-/Produktkonfiguration ausstehend |
| **Ticket Tool** | Ticket-System (`ticket-support` → `OPENED TICKETS`) | `1319701910571192372` / Pos. 3 | ja | HELP DESK + OPENED TICKETS (eigene Overwrites, inkl. `MANAGE_ROLES`/`MANAGE_CHANNELS` zum Erzeugen privater Ticket-Kanäle) | Kanalbindung live bestätigt; Panel-/Formular-Konfiguration ausstehend |
| **Discohook Utils** | Embed-/Nachrichten-Hilfswerkzeug | `1319701338959118338` / Pos. 20 | ja | Guild-weit laut Basis-Bitfeld | Rollenrechte live bestätigt; Nutzungskontext ausstehend |

**Keine dieser acht Anwendungen ist eine BULLHAUS-eigene Developer-Portal-Anwendung** (siehe Abschnitt 14). Für jede gilt: Deren Konfiguration (Server-Regeln, Panels, Trigger, Zahlungsprodukte) liegt außerhalb dieses Repositorys in den jeweiligen Vendor-Dashboards und ist **"Externe Vendor-Konfiguration ausstehend"** — siehe Abschnitt 30 (Vendor Configuration Backup).

---

## 16. Booster-Rolle

**Live bestätigt.** `Booster` (`1318983395312930858`, Position 18) ist Discords **native, automatisch verwaltete** Server-Booster-Rolle (`tags.premium_subscriber`-Markierung, `managed: true`). Discord vergibt und entzieht diese Rolle vollautomatisch, sobald ein Nutzer den Server boostet bzw. den Boost beendet. **Diese Rolle darf nie manuell neu angelegt oder gelöscht werden** — sie wird von Discord selbst bei Bedarf (re-)erzeugt und ist nicht Teil des Blueprint-/Overwrite-Modells dieses Repositorys.

---

## 17. SERVER BOTS-Rolle

**Live bestätigt.** `SERVER BOTS` (`1319688160296439838`, Position 1) ist eine normale (nicht gemanagte), hoist-aktive Rolle mit **Basisberechtigung `0`**. Zweck: gemeinsamer Container, dem jeder Vendor-Bot zusätzlich zu seiner eigenen gemanagten Rolle beitritt, damit Kategorien eine einzige, konsistente "ist irgendein Bot"-Bedingung für Overwrites nutzen können (z. B. `SEND_MESSAGES`-Verweigerung für alle Bots in LOUNGE/Floor-Kategorien, oder gezielte Freigaben in STAFF/BOTS). Sie ist **keine** Administrator-Rolle — alle tatsächlichen Fähigkeiten kommen aus der jeweiligen gemanagten Bot-Rolle selbst plus gezielten Kanal-Overwrites, nie aus `SERVER BOTS` selbst.

---

## 18. Webhooks

**Live bestätigt.** Genau **5 Webhooks**, alle vom Namen `Dyno`, `application_id` `161660517914509312` (Dyno), jeweils einem der fünf LOGS-Kanäle zugeordnet:

| Webhook-ID | Zielkanal |
|---|---|
| `1319714677881835561` | ⛔┃role-logs |
| `1319715037958639726` | ⛔┃channel-logs |
| `1319716209314369546` | ⛔┃join-leave |
| `1319721773134119083` | ⛔┃message-logs |
| `1320660445081636924` | ⛔┃voice-logs |

Kein Webhook-Token und keine Ausführungs-URL ist in dieser Dokumentation oder im Repository enthalten — beide sind Bearer-Credentials und werden von diesem Projekt nirgends gespeichert oder ausgegeben (Repository-bestätigt, README "Security notes": `publicWebhook()` filtert Token/URL aus jeder Tool-Ausgabe).

---

## 19. News Worker (Finnhub)

**Repository-bestätigt** (`src/news/`, `src/config/bullhaus.ts`, `.github/workflows/news-worker.yml`). **Wichtig:** Die README-Beschreibung dieses Workflows ("prepared but not activated … no cron schedule … runs `npm run news:dry`") ist **veraltet** — der tatsächliche, aktuell committete Workflow-Inhalt zeigt einen aktiven Cron-Zeitplan und produktive Veröffentlichung. Dieser Abschnitt folgt dem **aktuellen Dateiinhalt**, nicht der älteren README-Prosa.

| Aspekt | Aktueller Stand |
|---|---|
| Quellpfad | `src/news/` (CLI: `src/news/cli.ts`, Formatierung: `format.ts`, Deduplizierung: `dedup.ts`, Flood-Control: `flood_control.ts`, Impact-Heuristik: `impact.ts`, Konfiguration: `config.ts`, Provider: `providers/`) |
| Workflow-Pfad | `.github/workflows/news-worker.yml` |
| Produktiv aktiver Provider | `finnhub` (Finnhub Market News API) |
| Zielkanäle (`src/config/bullhaus.ts`) | `general` → `1554782909272039476` (trading-news), `forex` → `1554783055535804470` (forex-news), `crypto` → `1554838955294195863` (crypto-news) |
| Ausführender Bot | `BULLHAUS AI` (postet direkt über den Bot, kein eingehender Webhook nötig) |
| Cron (aktueller Workflow-Inhalt) | `*/10 * * * *` (alle 10 Minuten) + `workflow_dispatch` für manuelle Läufe |
| Veröffentlichungs-Limit pro Lauf | `workflow_dispatch` → `NEWS_MAX_POSTS_PER_CHANNEL=1` (kontrollierte Validierung); `schedule` → `3` (Normalbetrieb), direkt im Workflow über eine GitHub-Actions-Ausdrucksbedingung gesteuert |
| Node-Runtime | `node-version: "20"` (Workflow-bestätigt) |
| Umgebungsvariablen (nur Namen) | `DISCORD_BOT_TOKEN, FINNHUB_API_KEY, DRY_RUN, NEWS_DRY_RUN, NEWS_PUBLISH_ENABLED, NEWS_LICENSE_APPROVED, NEWS_PROVIDERS, NEWS_MAX_AGE_MINUTES, NEWS_HISTORY_LOOKBACK, NEWS_MAX_POSTS_PER_CHANNEL` |
| Dry-Run/Produktiv-Schalter im aktuellen Workflow | `DRY_RUN=false`, `NEWS_DRY_RUN=false`, `NEWS_PUBLISH_ENABLED=true`, `NEWS_LICENSE_APPROVED=true`, `NEWS_PROVIDERS=finnhub` — der Worker läuft im produktiven, veröffentlichenden Modus. |
| Freshness-Fenster | `NEWS_MAX_AGE_MINUTES=60` (Standard) — ältere Items werden nie veröffentlicht |
| Deduplizierung | Scannt bis zu `NEWS_HISTORY_LOOKBACK` (Standard 100) letzte Nachrichten des Zielkanals, berücksichtigt nur eigene, nicht gepinnte Posts des Bots, extrahiert Artikel-Links als "bereits veröffentlicht"-Menge. Schlägt der Verlaufs-Scan fehl, wird für diesen Lauf **nicht** veröffentlicht (fail-safe, nie "Verlauf als leer annehmen"). |
| Impact-Klassifizierung | `Low/Medium/High`, eine **BULLHAUS-eigene, deterministische Heuristik** (`impact.ts`) aus Kategorie + Schlagzeile — **nicht** von Finnhub geliefert, nie als "Finnhub Impact" bezeichnet, keine Handelsempfehlung. |
| Nachrichtenformat | Schlagzeile, Publisher, Europe/Zürich-Ortszeit (DST-bewusst, nie fixer Offset), Impact-Zeile, Original-Link; kein Emoji, kein Artikeltext, keine Bilder; `@`-Zeichen werden mit Zero-Width-Space entschärft, jede Nachricht mit `suppress_embeds: true`. |
| Fehlerverhalten | Ein fehlschlagender Provider/RSS-Quelle/fehlender API-Key stoppt nie den gesamten Lauf — nur diese Quelle liefert in diesem Lauf keine Items; der einzige Fall, der Veröffentlichung in einen Kanal stoppt, ist ein fehlgeschlagener Duplikat-Check für genau diesen Kanal. |
| Sicher testen | `npm run news:dry` — vollständig offline, Mock-Provider, keine Zugangsdaten nötig. |
| Produktion verifizieren | `npm run membership-guard`-ähnlich: Workflow-Lauf-Logs in GitHub Actions prüfen, Zielkanäle auf neue Posts sichten, `NEWS_MAX_POSTS_PER_CHANNEL`-Limit beachten. |
| Mock-Provider | Nur Entwicklung/Test, im Code **hart blockiert** von echter Veröffentlichung, unabhängig von jeder Konfiguration. |
| Official-RSS-Provider | Implementiert, aber inaktiv — jede Quelle in `src/news/rss/sources.ts` trägt `enabled: false, approved: false`. |

---

## 20. Discord MCP — vollständige Wiederaufbauanleitung

**Repository-bestätigt** (`package.json`, `README.md`, `src/`).

- **Zweck:** MCP-Server, der einen KI-Assistenten befähigt, Discord-Guilds (Kategorien, Kanäle, Rollen, Berechtigungs-Overwrites) aus einem deklarativen Blueprint heraus zu provisionieren — plus direkte Rollen-/Mitglieder-Werkzeuge für gezielte Einzeländerungen.
- **Repository/Paketname:** `discord-provisioner-mcp`, Version `0.2.0`.
- **Node-Anforderung:** `>=20`.
- **Architektur:** TypeScript, spricht die Discord-REST-API direkt an (kein `discord.js`), Laufzeitabhängigkeiten nur `@modelcontextprotocol/sdk ^1.17.0` und `zod ^3.25.76`.
- **Transportarten:**
  - **stdio** (Standard) — für Claude Code und andere lokale Clients: `node dist/index.js`.
  - **Streamable HTTP** mit Bearer-Auth — für claude.ai-Custom-Connector: `MCP_AUTH_TOKEN=<token> node dist/index.js --http --port 3000`. Endpunkt `POST/GET/DELETE http://127.0.0.1:3000/mcp`, zusätzlich unauthentifiziertes `GET /healthz`. Bindet standardmäßig nur `127.0.0.1`; `--host 0.0.0.0` erfordert vorgeschaltetes TLS.
- **Sicherheitskontrollen:**
  - Rate-Limiting: verfolgt `X-RateLimit-*`-Header, serialisiert Schreibvorgänge pro Bucket, behandelt globale 429 mit Pause aller Requests, bricht nach 10 aufeinanderfolgenden 429 ab; 5xx/Netzwerkfehler mit Backoff bis 5 Versuche; alle Schreibvorgänge zusätzlich seriell mit `WRITE_DELAY_MS` (Standard 250 ms) zwischen den Aufrufen.
  - Hierarchie-Schutz: vor jedem Rollen-Schreibzugriff wird die eigene höchste Bot-Rolle ermittelt; ein Versuch, eine Rolle an oder über dieser Position zu ändern, wird mit `ROLE_HIERARCHY_BLOCKED` verweigert — auch `@everyone` (immer Position 0) ist damit geschützt.
  - Self-Role-Schutz: Der Bot kann seine eigene gemanagte Integrationsrolle nie editieren (`SELF_ROLE_EDIT_BLOCKED`).
  - Administrator-Opt-in: `edit_role_permissions` vergibt `ADMINISTRATOR` nie stillschweigend — erfordert explizit `allow_administrator: true`, sonst `ADMINISTRATOR_OPT_IN_REQUIRED`.
  - `dry_run` ist bei den direkten Rollen-/Mitglieder-Werkzeugen standardmäßig `true`; der Umgebungswert `DRY_RUN=true` erzwingt einen Dry-Run auch dann, wenn ein Aufruf explizit `dry_run: false` verlangt.
  - Jede Schreibaktion sendet einen `X-Audit-Log-Reason`-Header — alle Änderungen sind im Discord-Audit-Log nachvollziehbar.
  - Destruktive Werkzeuge (`delete_channel`, `delete_role`, `delete_message`, `delete_webhook`) verlangen einen expliziten Bestätigungs-Flag; es existiert **kein** `delete_guild`-Werkzeug und **keine** Werkzeuge zum Kicken/Bannen von Mitgliedern oder Massen-Löschen von Nachrichten.
  - Bot-Token und `MCP_AUTH_TOKEN` werden aus jeder Log-Zeile redigiert und erscheinen nie in Tool-Ausgaben oder Fehlermeldungen.
- **Wichtige Quellpfade:** `src/discord/client.ts` (REST-Client, Rate-Limiting), `src/discord/endpoints.ts` (typisierte Endpunkt-Wrapper), `src/discord/effective_permissions.ts` (reiner Berechtigungsrechner), `src/discord/permissions.ts` (Bitfeld-/Namens-Mapping), `src/community/` (Membership Guard), `src/news/` (News Worker), `src/blueprint/` (Blueprint-Schema, Planer, Templates), `src/tools/` (MCP-Tool-Implementierungen), `src/server.ts` / `src/index.ts` (Server-Aufbau, Transport-Auswahl), `src/config/bullhaus.ts` (Guild-ID, News-Kanal-Mapping).

**Einrichtung auf einem neuen Windows-Rechner (konkrete Schritte, Repository-bestätigt):**
1. Git installieren.
2. Node.js ≥ 20 installieren.
3. Repository klonen: `git clone https://github.com/fatihatl1/discord-mcp.git` (bzw. den aktuell autoritativen Fork).
4. `npm ci` (reproduzierbarer Install aus der Lockfile).
5. `npm run build` (TypeScript-Kompilierung nach `dist/`).
6. `.env.example` nach `.env` kopieren, mindestens `DISCORD_BOT_TOKEN` setzen (siehe Abschnitt 24 für die vollständige Variablenliste — nur Namen, keine Werte hier dokumentiert).
7. Zuerst mit `DRY_RUN=true` starten.
8. Verbindung read-only prüfen (z. B. nach dem Muster von `scripts/role_mgmt_live_readonly_check.ts`: `list_guilds`/`get_bot_info`/`list_roles` aufrufen, nichts schreiben).
9. Ein vollständiges Read-Only-Inventar ziehen (Rollen, Kanäle, Mitglieder, Webhooks, Pins) bevor irgendein Schreibzugriff erfolgt.
10. Erst danach `DRY_RUN=false` setzen und produktive Schreibvorgänge zulassen — immer zuerst mit `dry_run: true` am jeweiligen Tool selbst gegenprüfen.
11. Start: `node dist/index.js` (stdio) oder `npm run dev` (tsx, Entwicklung) oder mit `--http --port <port>` für den HTTP-Modus.

---

## 21. Claude Code-Einrichtung

**Repository-bestätigt** (README "Registering with Claude Code"):

```bash
claude mcp add discord \
  -e DISCORD_BOT_TOKEN=your-bot-token \
  -- node /absolute/path/to/discord-mcp/dist/index.js
```

Alternativ über eine Projekt-`.mcp.json`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/to/discord-mcp/dist/index.js"],
      "env": {
        "DISCORD_BOT_TOKEN": "your-bot-token"
      }
    }
  }
}
```

**Voraussetzungen:** `npm run build` muss vorher gelaufen sein (der Pfad zeigt auf `dist/index.js`, nicht auf die TypeScript-Quelle). **Verbindung prüfen:** Nach dem Hinzufügen ein einfaches Read-Only-Tool aufrufen (`list_guilds` oder `get_bot_info`). **Empfehlung:** `DRY_RUN=true` setzen, bis die erste Read-Only-Inventur erfolgreich war. **Häufige Fehlerquelle:** Hierarchie-/Berechtigungsfehler (`403`/`50013`) bedeuten praktisch immer, dass die Bot-Rolle in Server-Einstellungen → Rollen zu niedrig steht.

---

## 22. ChatGPT / andere MCP-kompatible Clients

**Repository-bestätigt für den generischen Transport; produktspezifische Registrierung nicht belegt.**

Dieser Server unterstützt zusätzlich zum stdio-Transport einen **Streamable-HTTP**-Transport mit Bearer-Authentifizierung:
- Start: `MCP_AUTH_TOKEN=<langer, zufälliger Wert> node dist/index.js --http --port 3000`.
- Endpunkt: `POST/GET/DELETE http://127.0.0.1:3000/mcp`; zusätzlich ein unauthentifizierter Health-Check unter `GET /healthz`.
- Jede `/mcp`-Anfrage muss `Authorization: Bearer <MCP_AUTH_TOKEN>` senden (zeitkonstanter Vergleich); alles andere erhält `401`.
- Sessions folgen der Streamable-HTTP-Spezifikation (`mcp-session-id`-Header bei `initialize`, spätere Requests spiegeln ihn, `DELETE` beendet die Session).
- Standardmäßig nur an `127.0.0.1` gebunden; `--host 0.0.0.0` erfordert vorgeschaltetes TLS (z. B. Reverse Proxy/Tunnel).

**Belegt ist konkret die Registrierung als claude.ai-Custom-Connector:** HTTP-Modus hinter einer öffentlichen HTTPS-URL betreiben, in claude.ai unter Einstellungen → Connectors → Custom Connector die `https://<host>/mcp`-URL eintragen. Da die claude.ai-Connector-UI keinen beliebigen statischen Bearer-Header erlaubt, muss die Token-Injektion in diesem Fall im vorgeschalteten Proxy erfolgen.

**Für ChatGPT oder andere MCP-Clients gilt ausdrücklich: Eine spezifische, produktseitige Registrierungsmöglichkeit für diesen Server ist in diesem Repository nicht belegt und nicht Teil dieses Projekts.** Der Server selbst ist protokollkonform (Streamable HTTP + Bearer-Auth) und sollte mit jedem MCP-Client funktionieren, der diesen Transport unterstützt — ob und wie ein konkretes Produkt (z. B. ChatGPT) eigene MCP-Server registrieren lässt, ist allein von diesem Client-Produkt abhängig und **nicht aktuell belegt**.

---

## 23. GitHub / CI/CD

**Repository-bestätigt.**

| Aspekt | Wert |
|---|---|
| Repository (Push-Ziel) | `https://github.com/fatihatl1/discord-mcp.git` (origin) |
| Zusätzlicher Remote | `https://github.com/TinyGecko920/discord-mcp.git` (upstream, nur Referenz — Push dorthin schlug historisch mit `403 Permission denied` fehl) |
| Standard-Branch | `main` |
| Workflow 1 | `.github/workflows/news-worker.yml` — Trigger `workflow_dispatch` + `schedule` (`*/10 * * * *`); `permissions: contents: read`; Concurrency-Gruppe `bullhaus-news-worker`, `cancel-in-progress: false` (ein laufender Publish-Durchlauf wird nie mitten im Schreiben abgebrochen); Node 20; Secrets: `DISCORD_BOT_TOKEN`, `FINNHUB_API_KEY`. |
| Workflow 2 | `.github/workflows/community-membership-guard.yml` — Trigger `workflow_dispatch` + `schedule` (`*/30 * * * *`); `permissions: contents: read`; Concurrency-Gruppe `bullhaus-community-membership-guard`, `cancel-in-progress: true`; Node 20; Secret: `DISCORD_BOT_TOKEN`. |

---

## 24. Umgebungsvariablen- und Secrets-Register

**Repository-bestätigt** (`.env.example` + beide Workflow-Dateien). **Keine Werte — nur Namen und Speicherorte.**

| Name | Komponente | Zweck | Pflicht? | Speicherort | Geheim? |
|---|---|---|---|---|---|
| `DISCORD_BOT_TOKEN` | MCP-Server, News Worker, Membership Guard | Discord-Bot-Token | Ja | lokal `.env` / GitHub Secret | **Ja** |
| `DISCORD_API_VERSION` | MCP-Server | REST-API-Version (Standard `v10`) | Nein | lokal `.env` | Nein |
| `DRY_RUN` | MCP-Server | `true` = kein Schreibzugriff erreicht Discord | Nein | lokal `.env` / Workflow-Env | Nein |
| `LOG_LEVEL` | MCP-Server | Log-Stufe (`debug/info/warn/error/silent`) | Nein | lokal `.env` | Nein |
| `WRITE_DELAY_MS` | MCP-Server | Mindestabstand zwischen Schreibvorgängen | Nein | lokal `.env` | Nein |
| `MCP_AUTH_TOKEN` | MCP-Server (nur HTTP-Modus) | Bearer-Token für HTTP-Clients | nur im HTTP-Modus | lokal `.env` | **Ja** |
| `DISCORD_GUILD_ID` | MCP-Server (Webhooks), News Worker | Guild-Einschränkung (Standard: BULLHAUS-Guild-ID) | Nein | lokal `.env` | Nein |
| `NEWS_DRY_RUN` | News Worker | Verhindert jede Discord-Schreibaktion | Nein | lokal `.env` / Workflow-Env | Nein |
| `NEWS_PUBLISH_ENABLED` | News Worker | Master-Schalter Veröffentlichung | Nein | lokal `.env` / Workflow-Env | Nein |
| `NEWS_LICENSE_APPROVED` | News Worker | Finnhub-Lizenz-Freigabe | Nein | lokal `.env` / Workflow-Env | Nein |
| `NEWS_PROVIDERS` | News Worker | Aktive Provider (kommagetrennt) | Nein | lokal `.env` / Workflow-Env | Nein |
| `NEWS_MAX_AGE_MINUTES` | News Worker | Frische-Fenster | Nein | lokal `.env` / Workflow-Env | Nein |
| `NEWS_MAX_POSTS_PER_CHANNEL` | News Worker | Veröffentlichungslimit pro Kanal/Lauf | Nein | lokal `.env` / Workflow-Env | Nein |
| `NEWS_HISTORY_LOOKBACK` | News Worker | Fenstergröße für Duplikat-Check | Nein | lokal `.env` / Workflow-Env | Nein |
| `FINNHUB_API_KEY` | News Worker (Finnhub-Provider) | Finnhub-API-Zugang | nur wenn `finnhub` in `NEWS_PROVIDERS` | lokal `.env` / GitHub Secret | **Ja** |

---

## 25. Rebuild-Reihenfolge / Disaster-Recovery-Verfahren

**Empfohlene Reihenfolge** (abgeleitet aus den tatsächlichen Abhängigkeiten dieses Systems):

1. Eigentümerschaft/Accounts klären (Discord-Account, GitHub-Account, Finnhub-Account, Vendor-Bot-Dashboards — siehe Abschnitt 30).
2. Discord-Guild anlegen/übernehmen.
3. BULLHAUS-eigene Developer-Portal-Anwendung (`BULLHAUS AI`) anlegen, Bot-Token sichern.
4. Repository klonen, `npm ci`, `npm run build`, `.env` lokal konfigurieren, `DRY_RUN=true`.
5. Bot in die Guild einladen (Minimalberechtigungen gemäß Abschnitt 13).
6. Rollenhierarchie anlegen (Abschnitt 5/6), `BULLHAUS AI`-Rolle über alles ziehen, das sie verwalten soll.
7. Kategorien anlegen (Abschnitt 2, exakte Reihenfolge).
8. Kanäle je Kategorie anlegen (Abschnitt 3).
9. Kategorie-/Kanal-Overwrites anwenden (Abschnitt 7/8, am besten über `apply_blueprint` mit vorherigem `dry_run: true`).
10. Drittanbieter-Bots installieren/konfigurieren (Abschnitt 15; externe Dashboard-Einstellungen aus der Vendor-Konfigurationssicherung, falls vorhanden).
11. Verifizierungsmechanismus einrichten (Abschnitt 11 — Mechanismus ist aktuell nicht vollständig belegt und muss ggf. neu entschieden werden).
12. Ticket Tool konfigurieren (`ticket-support` → `OPENED TICKETS`-Muster).
13. Logging/Webhooks einrichten (Dyno → 5 LOGS-Kanäle, Abschnitt 18).
14. News Worker konfigurieren (Secrets setzen, zunächst `npm run news:dry`, dann produktiv, Abschnitt 19).
15. Membership Guard konfigurieren (`src/community/roles.ts` korrekt pflegen, Workflow-Secret setzen, Abschnitt 12).
16. Kanonische Pinned-Nachrichten veröffentlichen (Abschnitt 4).
17. Voice-/Stage-Konfiguration (Limits, Audience-Pattern) anwenden (Abschnitt 10).
18. AFK-Kanal konfigurieren (`💤┃AFK` in LOUNGE).
19. Effektive Berechtigungen validieren (`computeEffectivePermissions`-gestützte Skripte, Abschnitt 26).
20. Membership Guard laufen lassen, `0` Violations bestätigen.
21. Vollständiges Read-Only-Audit (Rollen, Kanäle, Overwrites, Webhooks, Pins) gegen diese Dokumentation abgleichen.
22. Erst danach produktive Automatisierungen (News Worker Cron, Membership Guard Cron) aktivieren.

---

## 26. Berechtigungs-Validierungs-Checkliste

Für jede der 15 Community-/Admin-Rollen positiv **und** negativ gegen repräsentative Kanäle prüfen (abgeleitet aus den tatsächlich in dieser Sitzung live ausgeführten 135 Prüfungen):

| Rolle | Positiv-Check | Negativ-Check |
|---|---|---|
| MEMBER | sieht LOBBY, BOARD, LOUNGE, HELP DESK | sieht **nicht** GAMING FLOOR, TRADING FLOOR, TRADING FLOOR RU, STAFF |
| F3NTM | + GAMING FLOOR | **nicht** TRADING FLOOR, TRADING FLOOR RU |
| GAMING | + GAMING FLOOR | **nicht** TRADING FLOOR, TRADING FLOOR RU |
| CHOBAN | + GAMING FLOOR (mengengleich zu GAMING) | **nicht** TRADING FLOOR, TRADING FLOOR RU, STAFF, STATS, LOGS, BOTS |
| BULLHAUS | + GAMING FLOOR + TRADING FLOOR | **nicht** TRADING FLOOR RU |
| TRADING | + TRADING FLOOR + TRADING FLOOR RU | **nicht** GAMING FLOOR |
| DVVV | + TRADING FLOOR RU | **nicht** GAMING FLOOR, **nicht** normales TRADING FLOOR |
| INNERCIRCLE | = MEMBER-Basis | keine Zusatzsicht |
| VIP | = MEMBER-Basis | keine Zusatzsicht |
| COACH | + GAMING FLOOR + TRADING FLOOR + TRADING FLOOR RU | keine Moderationsrechte dort |
| ADMIN-BULLHAUS | + STAFF, Voice-Mod auf TRADING FLOOR | **nicht** GAMING FLOOR, **nicht** serverweites `ADMINISTRATOR`/`MANAGE_GUILD`/`MANAGE_ROLES` |
| ADMIN-RU | + STAFF, TRADING FLOOR RU, Voice-Mod nur dort | **nicht** GAMING FLOOR, **nicht** normales TRADING FLOOR, kein serverweites Admin-Bitfeld |
| ADMIN-GAMING | + STAFF, Voice-Mod auf GAMING FLOOR | **nicht** TRADING FLOOR/RU |
| ADMIN-GLOBAL | sieht alles inkl. STAFF/STATS/LOGS/BOTS | **kein** serverweites `ADMINISTRATOR`/`MANAGE_GUILD` |
| OWNER | sieht alles, einzige Rolle mit `ADMINISTRATOR` | — |

---

## 27. Sicherheitsbasis

- **`ADMINISTRATOR`** ist ausschließlich bei `OWNER` gesetzt (live bestätigt, Rohbitfeld `8`).
- **`BULLHAUS AI`** und **`ADMIN-GLOBAL`** besitzen **kein** `ADMINISTRATOR` und **kein** `MANAGE_GUILD` (live bestätigtes, decodiertes Bitfeld, Abschnitt 5/13).
- Alle Scoped-Admin-Rollen (`ADMIN-BULLHAUS, ADMIN-RU, ADMIN-GAMING`) haben Basisberechtigung `0` — jede Fähigkeit kommt ausschließlich aus Kategorie-Overwrites.
- `SERVER BOTS` hat Basisberechtigung `0`.
- `CHOBAN` hat Basisberechtigung `0`, keine Administrator-/Moderationsrechte irgendwo (live geprüft gegen 13 Berechtigungsnamen über alle 7 betroffenen Kanäle).
- Rollenhierarchie-Schutz: Ein Bot kann nie eine Rolle an oder über seiner eigenen Position verändern (MCP-seitig zusätzlich aktiv durchgesetzt, nicht nur von Discord erzwungen).
- Private Ticket-Isolation: `OPENED TICKETS` ist für `@everyone` gesperrt; einzelne Ticket-Kanäle erhalten gezielte Member-Overwrites nur für den jeweiligen Ticket-Ersteller plus Stab/Bot.
- Bot-Token-, Webhook-Token- und GitHub-Secret-Werte sind an keiner Stelle dieses Repositorys oder dieser Dokumentation enthalten — nur Namen und Speicherorte.
- `DRY_RUN` ist auf allen Ebenen (Umgebungsvariable, Tool-Parameter, Test-Client) verfügbar und wird in den reinen Read-Only-Skripten dieses Projekts zusätzlich hart erzwungen, unabhängig vom `.env`-Wert.
- Jede produktive Änderung an diesem Server sollte dem in Abschnitt 28 beschriebenen Audit-first-Verfahren folgen.

---

## 28. Betriebsverfahren für zukünftige Änderungen

1. **Read-Only-Snapshot** des aktuellen Live-Zustands ziehen, bevor irgendetwas verändert wird.
2. **Zielzustand** präzise definieren (welche Rolle, welcher Kanal, welches Overwrite).
3. **Effektive Berechtigungen vorab berechnen** (`computeEffectivePermissions`) für Vorher/Nachher-Vergleich.
4. **Kleinste deterministische Änderung** wählen — keine wahllosen Mehrfachänderungen in einem Schritt.
5. **Keine experimentellen Schreibzugriffe gegen Produktion** — immer zuerst `dry_run: true`/Plan-Modus, dann erst Apply.
6. **Read-Only-Nachkontrolle** direkt nach der Änderung gegen den echten Server.
7. **Tests** (`npm run typecheck`, `npm run build`, `npm test`) müssen grün sein, wenn Quellcode verändert wurde.
8. **Dokumentation aktualisieren**, wenn sich der dokumentierte Zustand ändert.
9. **Rollback-/Wiederherstellungs-Nachweis** aufbewahren (Snapshot-JSON, Commit-Hash) — dieses Repository hält solche Snapshots unter `reports/` (vollständig von Git ignoriert, bewusst nie öffentlich/versioniert).

---

## 29. Grenzen dieser Dokumentation

- Der genaue Verifizierungsmechanismus für `✅┃verify-here` ist **Nicht aktuell belegt**.
- Der genaue Zuweisungsmechanismus für `MEMBER` (manuell vs. automatisiert) ist **Nicht aktuell belegt**.
- Exakte Discord-Developer-Portal-Einstellungen für `BULLHAUS AI` (App-Name-Historie, ggf. je verwendete Redirect-URIs) sind **Eigentümerprüfung ausstehend / Muss verifiziert werden**.
- Alle Dashboard-/Panel-Konfigurationen der acht Vendor-Bots (Abschnitt 15) sind **Externe Vendor-Konfiguration ausstehend**.
- Eine mögliche COACH-spezifische Presenter-Sonderregel auf einzelnen Livestream-Kanälen ist in den aktuell gelesenen Overwrites nicht nachweisbar und daher **Nicht aktuell belegt**.
- Diese Dokumentation beschreibt den Stand vom 2026-11-27; der Server wird weiterhin aktiv betrieben und kann sich seitdem verändert haben — das Live-System und das Repository bleiben die jeweils aktuelle Quelle der Wahrheit.
- Alle älteren, internen Architektur-Zwischenschritte (z. B. eine frühere, inzwischen entfernte interne "Access-*"-Rollenebene) sind **Historische Referenz** und nicht Teil der aktuellen Architektur — die aktuellen Community-Rollen (`F3NTM, BULLHAUS, DVVV, TRADING, GAMING, CHOBAN`) binden die Kategorie-Overwrites direkt, ohne eine solche Zwischenschicht.

---

## 30. Geplante nächste Schritte

Die folgenden Arbeiten sind bewusst **ausstehend** und wurden im Rahmen dieser Dokumentation **nicht** ausgeführt:

**Ownership & Access Migration**
Dokumentation und Migration der Eigentümerschaft/Zugriffsverantwortung für alle relevanten Systeme, Accounts, Anwendungen, Dashboards und Infrastruktur, damit BULLHAUS nicht von persönlichen oder externen Eigentümerschaften abhängig bleibt.

**Vendor Configuration Backup**
Erstellung einer autoritativen Sicherung/Dokumentation aller Drittanbieter-Dashboard-Konfigurationen und extern gespeicherten Einstellungen, die sich nicht allein aus Discord selbst rekonstruieren lassen (siehe Abschnitt 15).

**Recovery Kit**
Erstellung/Aktualisierung des vollständigen Disaster-Recovery-Kits, nachdem Ownership & Access Migration und Vendor Configuration Backup abgeschlossen sind, sodass das Recovery Kit das endgültige, autoritative Wiederaufbau-Paket enthält.
