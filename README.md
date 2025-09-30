# HomeAssistant WhatsApp Bot (SQLite)

Lightweight WhatsApp bot to track household inventory via WhatsApp.

## Features
- `add / get / list / find`
- `inc / dec` quantities (no negatives)
- `move` items between locations
- attach photo URLs (`photo`), delete (`del`)
- Helpful replies, usage hints, and friendly errors
- SQLite persistence with WAL mode
- Unique `(user_id, name)` so each user’s item names are unique

---

## Setup
1. Install deps
   ```bash
   npm install
