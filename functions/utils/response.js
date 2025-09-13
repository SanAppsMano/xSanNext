export function json(statusCode, data, headers) {
  return {
    statusCode,
    body: JSON.stringify(data),
    ...(headers ? { headers } : {}),
  };
}

export function error(statusCode, message, headers) {
  return json(statusCode, { error: message }, headers);
}
