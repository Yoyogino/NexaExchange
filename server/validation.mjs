export class ValidationError extends Error {
  constructor(message) { super(message); this.name = "ValidationError"; this.status = 400; }
}

export const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function email(value) {
  if (typeof value !== "string") throw new ValidationError("Email must be text.");
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ValidationError("Enter a valid email address.");
  return normalized;
}

export function password(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new ValidationError("Password must contain between 8 and 128 characters.");
  return value;
}

export function shortCode(value, label = "Code") {
  if (typeof value !== "string" || value.length < 6 || value.length > 32 || !/^[A-Za-z0-9-]+$/.test(value)) throw new ValidationError(`${label} has an invalid format.`);
  return value;
}

export function uuid(value, label = "ID") {
  if (!isUuid(value)) throw new ValidationError(`${label} has an invalid format.`);
  return value;
}

export function boolean(value, label) {
  if (typeof value !== "boolean") throw new ValidationError(`${label} must be true or false.`);
  return value;
}

export function text(value, label, maxLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new ValidationError(`${label} is required and must be ${maxLength} characters or fewer.`);
  return value.trim();
}
