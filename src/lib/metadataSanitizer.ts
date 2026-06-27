type SanitizeContext = {
  entity?: string;
  entityId?: string | number | null;
  field?: string;
};

function replaceMalformedSurrogates(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\ufffd";
    } else {
      result += value[index];
    }
  }
  return result;
}

export function sanitizeMetadataString(value: string): string {
  return replaceMalformedSurrogates(value)
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u001f\u007f-\u009f]/g, " ");
}

export function sanitizeOptionalMetadataString(
  value: unknown,
  context: SanitizeContext = {},
): string | null {
  if (value === null || value === undefined) return null;
  const original = String(value);
  const sanitized = sanitizeMetadataString(original);
  if (sanitized !== original) {
    const location = [
      context.entity,
      context.entityId != null ? `id=${sanitizeMetadataString(String(context.entityId))}` : null,
      context.field ? `field=${context.field}` : null,
    ].filter(Boolean).join(" ");
    console.warn(`[MetadataSanitizer] Removed or replaced unsafe characters${location ? ` (${location})` : ""}.`);
  }
  return sanitized;
}

export function sanitizeRequiredMetadataString(
  value: unknown,
  context: SanitizeContext = {},
): string {
  return sanitizeOptionalMetadataString(value, context) ?? "";
}
