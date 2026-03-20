// ============================================================
// PCT Hiker Tracker — Code.gs
// Deploy this in Google Apps Script (script.google.com)
//
// Setup steps:
// 1. Create a new Google Sheet with columns:
//    A: timestamp | B: lat | C: lon | D: message
// 2. Paste this file into Apps Script editor
// 3. Update SHEET_ID below with your Sheet's ID
//    (from the URL: .../spreadsheets/d/SHEET_ID/edit)
// 4. Run setupTrigger() once from the editor to install
//    the Gmail trigger (Triggers → Add Trigger → or run manually)
// 5. Authorize when prompted
// ============================================================

const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
const SHEET_TAB_NAME = 'Sheet1'; // Change if your tab has a different name
const ZOLEO_SENDER_DOMAIN = 'zoleo.com';

// ============================================================
// Main entry point — called by Gmail trigger
// Processes all unread emails from Zoleo since last run.
// ============================================================
function processZoleoEmails() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_TAB_NAME);
  if (!sheet) {
    console.error('Sheet tab not found: ' + SHEET_TAB_NAME);
    return;
  }

  // Search for unread Zoleo emails
  const query = `from:${ZOLEO_SENDER_DOMAIN} is:unread`;
  const threads = GmailApp.search(query);

  let newRows = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      if (message.isUnread()) {
        const row = parseZoleoMessage(message);
        if (row) {
          sheet.appendRow(row);
          newRows++;
        }
        // Mark as read so we don't process it again
        message.markRead();
      }
    });
  });

  console.log(`Processed ${newRows} new location(s) from Zoleo emails.`);
}

// ============================================================
// Parse a Zoleo email message into a sheet row
// Returns [timestamp, lat, lon, message] or null if no location found
// ============================================================
function parseZoleoMessage(message) {
  const body = message.getPlainBody();
  const subject = message.getSubject();

  // Extract coordinates: "My location is {lat}, {lon}"
  const coordMatch = body.match(/My location is\s*([-\d.]+),\s*([-\d.]+)/i);
  if (!coordMatch) {
    console.warn('No coordinates found in email: ' + subject);
    return null;
  }

  const lat = parseFloat(coordMatch[1]);
  const lon = parseFloat(coordMatch[2]);

  if (isNaN(lat) || isNaN(lon)) {
    console.warn('Invalid coordinates parsed from email: ' + subject);
    return null;
  }

  // Extract check-in time: "Check-in sent at: {datetime}"
  // Falls back to email date if not found
  let timestamp;
  const timeMatch = body.match(/Check-in sent at:\s*(.+)/i);
  if (timeMatch) {
    const parsedDate = new Date(timeMatch[1].trim());
    timestamp = isNaN(parsedDate.getTime()) ? message.getDate().toISOString() : parsedDate.toISOString();
  } else {
    timestamp = message.getDate().toISOString();
  }

  // Extract optional text message (everything before "My location is")
  // Zoleo format: "Zoleo:  I'm OK. My location is ..."
  let textMessage = '';
  const msgMatch = body.match(/Zoleo:\s*(.*?)My location is/is);
  if (msgMatch) {
    textMessage = msgMatch[1].replace(/\s+/g, ' ').trim();
  } else {
    // Fallback: use first non-empty line of body
    const firstLine = body.split('\n').map(l => l.trim()).find(l => l.length > 0);
    textMessage = firstLine || '';
  }

  return [timestamp, lat, lon, textMessage];
}

// ============================================================
// Install Gmail trigger (run this once from the editor)
// This sets up a time-based trigger that runs every 15 minutes
// to check for new Zoleo emails.
// ============================================================
function setupTrigger() {
  // Remove any existing triggers for processZoleoEmails
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processZoleoEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create a new time-based trigger: every 15 minutes
  ScriptApp.newTrigger('processZoleoEmails')
    .timeBased()
    .everyMinutes(15)
    .create();

  console.log('Trigger installed: processZoleoEmails runs every 15 minutes.');
}

// ============================================================
// Manual test: add a fake location row to the sheet
// Run this from the editor to verify sheet connectivity
// ============================================================
function testAddRow() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_TAB_NAME);
  if (!sheet) {
    console.error('Sheet tab not found: ' + SHEET_TAB_NAME);
    return;
  }

  const fakeRow = [
    new Date().toISOString(),
    32.6273,
    -116.5100,
    "Test check-in from Apps Script",
  ];

  sheet.appendRow(fakeRow);
  console.log('Test row added: ' + JSON.stringify(fakeRow));
}

// ============================================================
// Utility: print all recent Zoleo emails (for debugging)
// ============================================================
function debugListEmails() {
  const threads = GmailApp.search('from:' + ZOLEO_SENDER_DOMAIN, 0, 5);
  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      console.log('--- Email ---');
      console.log('Subject: ' + msg.getSubject());
      console.log('Date: ' + msg.getDate());
      console.log('Body (first 500 chars): ' + msg.getPlainBody().substring(0, 500));
    });
  });
}
