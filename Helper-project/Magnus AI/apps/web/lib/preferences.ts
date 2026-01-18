export const USERNAME_COOKIE = 'magnus_username';
export const ANON_COOKIE = 'magnus_anonymize';

export function decodeCookieValue(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
