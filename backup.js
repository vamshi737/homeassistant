// backup.js
const fs = require('fs');
const path = require('path');

const DB_BASENAME = 'homebot.db'; // your SQLite filename
const files = [DB_BASENAME, `${DB_BASENAME}-shm`, `${DB_BASENAME}-wal`];

(async () => {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
    const outDir = path.join(__dirname, 'backup', ts);
    fs.mkdirSync(outDir, { recursive: true });

    let copied = 0;
    for (const f of files) {
      const src = path.join(__dirname, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(outDir, f));
        copied++;
      }
    }
    console.log(`Backup saved to ${outDir} (${copied} files).`);
  } catch (e) {
    console.error('Backup failed:', e.message);
    process.exit(1);
  }
})();
