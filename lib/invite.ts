import { createHmac, timingSafeEqual } from 'node:crypto';

// Ссылка-приглашение: ?invite=<exp>.<подпись>. exp — unix-время окончания в секундах,
// подпись — HMAC-SHA256 строки "invite|<комната>|<exp>" секретом LiveKit, в base64url.
// Действует для одной комнаты и до exp; начатый звонок по истечении не рвётся.
// Генератор ссылок — vm/invite.sh в репозитории проекта livekit-1on1.
const INVITE_RE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export function isInviteValid(roomName: string, invite: string | null, secret: string): boolean {
  const m = invite ? INVITE_RE.exec(invite) : null;
  if (!m) return false;
  if (Number(m[1]) * 1000 <= Date.now()) return false;
  const expected = createHmac('sha256', secret).update(`invite|${roomName}|${m[1]}`).digest();
  const got = Buffer.from(m[2], 'base64url');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
