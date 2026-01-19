const { URL } = require('url');

function buildDiscordMessage({ subject, runAt, matches, notifyWindowDays, apptUrl, mentionUserId }) {
  const lines = [];
  if (mentionUserId) {
    lines.push(`<@${mentionUserId}>`);
  }
  lines.push(subject || 'DMV Appointment Alert');
  if (runAt) lines.push(`Run: ${runAt}`);
  lines.push('');
  lines.push(`Appointments within ${notifyWindowDays} days:`);
  for (const match of matches || []) {
    const loc = match.locationName || 'Unknown';
    const dateText = match.dateText || '';
    const timeText = match.timeText || '';
    const daysOut = match.daysOut != null ? `${match.daysOut}d out` : '';
    lines.push(`- ${loc}: ${dateText} ${timeText} ${daysOut}`.trim());
  }
  lines.push('');
  lines.push(`Book here: ${apptUrl}`);
  return lines.join('\n');
}

async function sendDiscordAlert(webhookUrl, payload) {
  if (!webhookUrl) {
    throw new Error('Missing Discord webhook URL');
  }
  const message = buildDiscordMessage(payload);
  const url = new URL(webhookUrl);
  const mentionUserId = payload && payload.mentionUserId ? String(payload.mentionUserId) : '';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      allowed_mentions: mentionUserId ? { users: [mentionUserId] } : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${text}`.trim());
  }
}

module.exports = { sendDiscordAlert };
