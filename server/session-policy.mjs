export const SESSION_IDLE_MINUTES = 30;
export const SESSION_TOUCH_INTERVAL_MINUTES = 5;

export function sessionTokenFromRequest(req, cookieName, parseCookies) {
  return parseCookies(req)[cookieName] ?? null;
}

export function shouldTouchSession(lastSeenAt, now = Date.now()) {
  return now - new Date(lastSeenAt).getTime() >= SESSION_TOUCH_INTERVAL_MINUTES * 60 * 1000;
}
