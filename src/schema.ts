type PrimitiveType = "string" | "number" | "boolean" | "date";
type ComplexType =
  | "object"
  | "array"
  | "email"
  | "url"
  | "ip"
  | "json"
  | "port";
type SchemaType = PrimitiveType | ComplexType;

export interface SchemaRule {
  type: SchemaType;
  required?: boolean;
  default?: any;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  validate?: (value: any) => boolean;
  transform?: (value: any) => any;
  sensitive?: boolean;
  /**
   * When true, the value must be stored encrypted in the .env file using the
   * dotenv-gad ECIES scheme. The validator will automatically decrypt the value
   * before type-checking and returning it to the application.
   * Use `npx dotenv-gad keygen` and `npx dotenv-gad encrypt` to manage keys.
   */
  encrypted?: boolean;
  docs?: string;
  enum?: any[];
  regex?: RegExp;
  regexError?: string;
  error?: string;
  items?: SchemaRule;
  properties?: Record<string, SchemaRule>;
  // Optional prefix for grouped environment variables. When set, variables
  // like `PREFIX_KEY` will be mapped into the object. If omitted but
  // `properties` exists, the default prefix `
  // <SCHEMA_KEY>_` will be used when grouping is detected.
  envPrefix?: string;
  env?: { [envName: string]: Partial<SchemaRule> };
}

export type SchemaDefinition = Record<string, SchemaRule>;

export interface EncryptedEnvKey {
  /** Name of the variable as it appears in the .env file / process.env. */
  envKey: string;
  /** Top-level schema key that owns this variable. */
  schemaKey: string;
}

/**
 * Enumerates the .env variable names of every field marked `encrypted: true`:
 * top-level schema keys, plus `<prefix><PROP>` for object groups whose
 * properties declare `encrypted: true` (grouped via `envPrefix`, defaulting
 * to `<SCHEMA_KEY>_`).
 */
export function getEncryptedEnvKeys(
  schema: SchemaDefinition
): EncryptedEnvKey[] {
  const keys: EncryptedEnvKey[] = [];
  for (const [key, rule] of Object.entries(schema)) {
    if (rule.encrypted === true) {
      keys.push({ envKey: key, schemaKey: key });
    }
    if (rule.type === "object" && rule.properties) {
      const prefix = rule.envPrefix ?? `${key}_`;
      for (const [prop, propRule] of Object.entries(rule.properties)) {
        if (propRule.encrypted !== true) continue;
        const envKey = `${prefix}${prop}`;
        // A prefixed name that collides with an explicit schema key belongs
        // to that key, not the group.
        if (Object.prototype.hasOwnProperty.call(schema, envKey)) continue;
        keys.push({ envKey, schemaKey: key });
      }
    }
  }
  return keys;
}

/**
 * A type-safe way to define your environment schema.
 *
 * @example
 * const schema = defineSchema({
 *   APP_NAME: { type: "string", required: true },
 *   APP_PORT: { type: "number", default: 3000 },
 * });
 *
 * @template S
 * @param {S} schema - Environment schema definition
 * @returns {S} - The same schema definition, but with type safety
 */
export function defineSchema<const S extends SchemaDefinition>(schema: S): S {
  return schema;
}
