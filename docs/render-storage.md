Render storage notes
====================

The server can store uploaded heads and runtime state in two modes:

1. Local/project mode
   - Used by default.
   - Runtime state: database/runtime-state.json
   - Approved heads: public/assets/admin-heads
   - Player submissions: public/assets/user-submissions

2. Render persistent disk mode
   - Add a Render persistent disk mounted at /var/data.
   - The app auto-detects /var/data when Render exposes process.env.RENDER.
   - You can also set DATA_DIR=/var/data manually.

Without a persistent disk or external storage, files uploaded from /admin on Render can disappear after restart or redeploy.
