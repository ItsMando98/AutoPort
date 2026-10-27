<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/2ce26987-91b0-4243-8c0e-d94d5059869a

## Run Locally

**Prerequisites:** Node.js (v20+ empfohlen)

1. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
2. Backend starten (Terminal 1):
   ```bash
   npm run dev:server
   ```
3. Frontend starten (Terminal 2):
   ```bash
   npm run dev
   ```
4. Im Browser öffnen: [http://localhost:3000](http://localhost:3000)

## Umfassende Dokumentation

Eine detaillierte Beschreibung aller Features, der Multi-Agenten-Architektur, der Risiko-Engine, der KI-Provider-Integration und der Alpaca-Broker-Konfiguration befindet sich in der [Plattform-Dokumentation](PLATFORM_DOCUMENTATION.md).

For the backend, copy the documented variables from `AGENTS.md` into `.env`. The API binds to `127.0.0.1` by default. If you intentionally expose it on another interface with `API_HOST`, you must also set `API_AUTH_TOKEN`; set the same value as `VITE_API_AUTH_TOKEN` in `.env.local` so the frontend can authenticate state-changing requests.
