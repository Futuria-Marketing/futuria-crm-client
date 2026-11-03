// Fixture comuni per riconoscere un config.json della skill: le usano i test
// di credential-wizard.mjs, di state-dir.ps1 e di state-dir.sh.
// Per ogni caso: il contenuto e l’ID atteso su Windows (win32) e su macOS
// (darwin), oppure null se il file non va considerato della skill.
// Nessun valore reale: ID e chiavi sono inventati.

export const DEMO_ID = "demoAccount1234567890";
const WIN_DATE = "2026-10-14T09:12:33.1234567Z";
const MAC_DATE = "2026-11-03T10:11:12.345Z";

// Store dell’app desktop (electron-store): chiavi di primo livello come
// deviceId, authState, sessionState, credentials. Valori fittizi.
export const APP_STORE_TEXT = `${JSON.stringify({
  deviceId: "device-fittizio-0001",
  authState: { token: "valore-fittizio-app", expiresAt: 1790000000 },
  sessionState: { lastVisitedUrl: "https://app.futuriamarketing.com/" },
  credentials: { push: "valore-fittizio-push" },
}, null, "\t")}`;

const windows13x = `{\r\n    "location":  "${DEMO_ID}",\r\n    "updated_at":  "${WIN_DATE}",\r\n    "storage":  "windows-dpapi"\r\n}\r\n`;
const macSetupSh = `{\n  "location": "${DEMO_ID}",\n  "storage": "macos-keychain"\n}\n`;
const macWizard = `${JSON.stringify({ location: DEMO_ID, storage: "macos-keychain", updated_at: MAC_DATE }, null, 2)}\n`;

function padTo(text, bytes) {
  // Spazi prima della graffa finale fino alla dimensione richiesta.
  const index = text.lastIndexOf("}");
  const missing = bytes - Buffer.byteLength(text, "utf8");
  return `${text.slice(0, index)}${" ".repeat(Math.max(0, missing))}${text.slice(index)}`;
}

export const CONFIG_CASES = [
  { name: "store dell’app desktop", text: APP_STORE_TEXT, win32: null, darwin: null },
  {
    name: "file misto con chiavi dell’app (Windows)",
    text: JSON.stringify({ location: DEMO_ID, updated_at: WIN_DATE, storage: "windows-dpapi", deviceId: "device-fittizio-0001" }),
    win32: null,
    darwin: null,
  },
  {
    name: "file misto con chiavi dell’app (macOS)",
    text: JSON.stringify({ deviceId: "device-fittizio-0001", location: DEMO_ID, storage: "macos-keychain" }, null, 2),
    win32: null,
    darwin: null,
  },
  { name: "formato 1.3.x di Windows", text: windows13x, win32: DEMO_ID, darwin: null },
  { name: "formato 1.3.x di Windows con BOM", text: `﻿${windows13x}`, win32: DEMO_ID, darwin: null },
  {
    name: "formato Windows compatto",
    text: `{"storage":"windows-dpapi","location":"${DEMO_ID}","updated_at":"2026-11-03T10:11:12Z"}`,
    win32: DEMO_ID,
    darwin: null,
  },
  { name: "formato di setup-credentials.sh", text: macSetupSh, win32: null, darwin: DEMO_ID },
  { name: "formato di setup-credentials.sh con BOM", text: `﻿${macSetupSh}`, win32: null, darwin: DEMO_ID },
  { name: "formato del configuratore macOS", text: macWizard, win32: null, darwin: DEMO_ID },
  { name: "JSON non valido", text: `{"location": "${DEMO_ID}", "storage": "macos-keychain",`, win32: null, darwin: null },
  { name: "file vuoto", text: "", win32: null, darwin: null },
  { name: "oggetto vuoto", text: "{}", win32: null, darwin: null },
  {
    name: "array con un solo oggetto",
    text: `[{"location":"${DEMO_ID}","storage":"macos-keychain","updated_at":"${MAC_DATE}"}]`,
    win32: null,
    darwin: null,
  },
  { name: "location troppo corta", text: `{"location":"abc12","storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "location con caratteri non ammessi", text: `{"location":"demo.Account123","storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "storage sconosciuto", text: `{"location":"${DEMO_ID}","storage":"in-chiaro","updated_at":"${MAC_DATE}"}`, win32: null, darwin: null },
  { name: "storage mancante", text: `{"location":"dashboard-principale"}`, win32: null, darwin: null },
  { name: "updated_at mancante su Windows", text: `{"location":"${DEMO_ID}","storage":"windows-dpapi"}`, win32: null, darwin: null },
  { name: "updated_at non in formato ISO", text: `{"location":"${DEMO_ID}","storage":"macos-keychain","updated_at":"ieri"}`, win32: null, darwin: null },
  { name: "updated_at numerico", text: `{"location":"${DEMO_ID}","storage":"macos-keychain","updated_at":1790000000}`, win32: null, darwin: null },
  { name: "Location con la maiuscola", text: `{"Location":"${DEMO_ID}","storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "Storage con la maiuscola", text: `{"location":"${DEMO_ID}","Storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "chiave duplicata", text: `{"location":"${DEMO_ID}","location":"otherAccount123","storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "chiave in più", text: `{"location":"${DEMO_ID}","storage":"macos-keychain","theme":"dark"}`, win32: null, darwin: null },
  { name: "virgola finale", text: `{"location":"${DEMO_ID}","storage":"macos-keychain",}`, win32: null, darwin: null },
  { name: "valore con escape", text: `{"location":"demoAccount\\u0031234","storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "valore non ASCII", text: `{"location":"demoAccountè1234","storage":"macos-keychain"}`, win32: null, darwin: null },
  { name: "esattamente 1 KiB", text: padTo(macSetupSh, 1024), win32: null, darwin: DEMO_ID },
  { name: "oltre 1 KiB", text: padTo(macSetupSh, 1025), win32: null, darwin: null },
];
