// Fetches latest METAR + all NOTAMs for VOHS and writes data.json.
// Runs server-side in GitHub Actions (no CORS / no proxy needed).
const fs = require('fs');

const STATION = 'VOHS';

async function getMetar() {
  const url = `https://aviationweather.gov/api/data/metar?ids=${STATION}&format=raw&hours=6`;
  const r = await fetch(url, { headers: { 'Accept': 'text/plain' } });
  if (!r.ok) throw new Error('METAR HTTP ' + r.status);
  const lines = (await r.text()).split('\n').map((s) => s.trim()).filter(Boolean);
  let best = '', bestT = -1, now = Date.now(), d = new Date();
  for (const ln of lines) {
    const m = ln.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
    if (!ln.includes(STATION) || !m) continue;
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), +m[1], +m[2], +m[3]);
    if (t > now + 3600000) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, +m[1], +m[2], +m[3]);
    if (t > bestT) { bestT = t; best = ln; }
  }
  return best || (lines[0] || '');
}

async function getNotams() {
  const all = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const body = new URLSearchParams({
      searchType: '0',
      designatorsForLocation: STATION,
      offset: String(offset),
      notamsOnly: 'false',
      sortColumns: '5 false',
      sortDirection: 'true',
    });
    const r = await fetch('https://notams.aim.faa.gov/notamSearch/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) throw new Error('NOTAM HTTP ' + r.status);
    const j = await r.json();
    const list = j.notamList || [];
    all.push(...list);
    const total = j.totalNotamCount || all.length;
    offset += list.length;
    if (list.length === 0 || all.length >= total) break;
  }
  return all.map((n) => ({
    notamNumber: n.notamNumber,
    facilityDesignator: n.facilityDesignator,
    featureName: n.featureName,
    issueDate: n.issueDate,
    startDate: n.startDate,
    endDate: n.endDate,
    icaoMessage: (n.icaoMessage || '').trim(),
    traditionalMessage: (n.traditionalMessage || '').trim(),
  }));
}

(async () => {
  const data = { generatedAt: new Date().toISOString(), station: STATION };
  try { data.metar = await getMetar(); }
  catch (e) { data.metar = ''; data.metarError = String(e); }
  try { data.notams = await getNotams(); }
  catch (e) { data.notams = []; data.notamError = String(e); }
  fs.writeFileSync('data.json', JSON.stringify(data, null, 1));
  console.log(`Wrote data.json: metar=${data.metar ? 'ok' : 'ERR'}, notams=${(data.notams || []).length}`);
})();
