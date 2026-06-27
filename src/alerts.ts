// Cadence — alert dispatch (Telegram)
import type { Env } from './types';
import type { AlertCandidate } from './db';

function penceToGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function formatAlert(c: AlertCandidate): string {
  const days = c.days_until;
  const dueStr = c.due_date;
  let urgency: string;
  if (days <= 0) urgency = '🚨 DUE NOW';
  else if (days === 1) urgency = '⏰ Tomorrow';
  else if (days <= 3) urgency = `🔔 In ${days} days`;
  else if (days <= 7) urgency = `📅 In ${days} days`;
  else urgency = `🗓 In ${days} days`;
  const kindLabel =
    c.kind === 'subscription' ? 'Subscription' : c.kind === 'reminder' ? 'Reminder' : 'Watchlist';
  const lines = [
    `${urgency} — ${kindLabel}: *${c.title}*`,
    `Due: ${dueStr}`,
  ];
  if (c.notes) lines.push(`Notes: ${c.notes.slice(0, 200)}`);
  return lines.join('\n');
}

export async function sendTelegram(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log('[alert] telegram not configured; would send:', text);
    return false;
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error('[alert] telegram non-2xx:', r.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[alert] telegram exception:', err);
    return false;
  }
}

export async function batchTelegram(env: Env, messages: string[]): Promise<number> {
  if (messages.length === 0) return 0;
  // Send each individually; simple, reliable, no message-size surprises.
  let sent = 0;
  for (const m of messages) {
    const ok = await sendTelegram(env, m);
    if (ok) sent++;
    // Polite gap to avoid Telegram's anti-flood limits (1 msg/sec to same chat)
    if (m !== messages[messages.length - 1]) await new Promise((res) => setTimeout(res, 1100));
  }
  return sent;
}