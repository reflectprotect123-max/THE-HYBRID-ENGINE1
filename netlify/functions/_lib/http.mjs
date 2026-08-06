export function json(body, status = 200, headers = {}) {
  return { statusCode: status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(body) };
}

export function redirect(location, headers = {}) {
  return { statusCode: 302, headers: { location, ...headers }, body: '' };
}

export function method(event, allowed) {
  if (event.httpMethod && !allowed.includes(event.httpMethod.toUpperCase())) return json({ error: 'method_not_allowed' }, 405, { allow: allowed.join(', ') });
  return null;
}

export function safeError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}
