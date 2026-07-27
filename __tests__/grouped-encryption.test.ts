/**
 * Encrypted properties inside envPrefix object groups.
 *
 * Property-level `encrypted: true` was previously ignored end-to-end: the
 * validator never decrypted prefixed variables, and an encrypted-looking
 * grouped value was rejected with "schema does not declare encrypted: true"
 * even when the property declared it.
 */
import { describe, test, expect, afterEach } from "vitest";
import { defineSchema, getEncryptedEnvKeys } from "../src/schema.js";
import { EnvValidator } from "../src/validator.js";
import { EnvAggregateError } from "../src/errors.js";
import { generateKeyPair, encryptEnvValue } from "../src/crypto.js";

afterEach(() => {
  delete process.env.ENVGAD_PRIVATE_KEY;
});

describe("getEncryptedEnvKeys", () => {
  test("collects top-level and grouped encrypted keys", () => {
    const schema = defineSchema({
      API_KEY: { type: "string", encrypted: true },
      PORT: { type: "number" },
      DATABASE: {
        type: "object",
        properties: {
          PWD: { type: "string", encrypted: true },
          HOST: { type: "string" },
        },
      },
      CACHE: {
        type: "object",
        envPrefix: "REDIS_",
        properties: { AUTH: { type: "string", encrypted: true } },
      },
    });

    expect(getEncryptedEnvKeys(schema)).toEqual([
      { envKey: "API_KEY", schemaKey: "API_KEY" },
      { envKey: "DATABASE_PWD", schemaKey: "DATABASE" },
      { envKey: "REDIS_AUTH", schemaKey: "CACHE" },
    ]);
  });

  test("skips grouped names that collide with explicit schema keys", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { URL: { type: "string", encrypted: true } },
      },
      DATABASE_URL: { type: "url" },
    });

    expect(getEncryptedEnvKeys(schema)).toEqual([]);
  });
});

describe("Validator: encrypted grouped properties", () => {
  test("decrypts an encrypted grouped property", () => {
    const { publicKeyHex, privateKeyHex } = generateKeyPair();
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: {
          NAME: { type: "string", required: true },
          PWD: { type: "string", required: true, encrypted: true },
        },
      },
    });

    const env = {
      DATABASE_NAME: "mydb",
      DATABASE_PWD: encryptEnvValue("supersecret", publicKeyHex, "DATABASE_PWD"),
    };

    const v = new EnvValidator(schema, { keysPath: ".nonexistent-xyz.keys" });
    process.env.ENVGAD_PRIVATE_KEY = privateKeyHex;
    const result = v.validate(env);
    expect(result.DATABASE).toEqual({ NAME: "mydb", PWD: "supersecret" });
  });

  test("plaintext value for an encrypted grouped property is rejected", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { PWD: { type: "string", encrypted: true } },
      },
    });

    const v = new EnvValidator(schema, { keysPath: ".nonexistent-xyz.keys" });
    try {
      v.validate({ DATABASE_PWD: "plaintext-oops" });
      throw new Error("should have thrown");
    } catch (err: any) {
      const agg = err as EnvAggregateError;
      const e = agg.errors.find((x: any) => x.key === "DATABASE_PWD");
      expect(e).toBeDefined();
      expect(e!.message).toMatch(/Must be encrypted/);
    }
  });

  test("allowPlaintext warns and passes the plaintext grouped value through", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { PWD: { type: "string", encrypted: true } },
      },
    });

    const originalWarn = console.warn;
    let warned = "";
    console.warn = (msg: string) => {
      warned = msg;
    };
    try {
      const v = new EnvValidator(schema, {
        allowPlaintext: true,
        keysPath: ".nonexistent-xyz.keys",
      });
      const result = v.validate({ DATABASE_PWD: "plaintext-ok" });
      expect(result.DATABASE.PWD).toBe("plaintext-ok");
      expect(warned).toContain("DATABASE_PWD");
    } finally {
      console.warn = originalWarn;
    }
  });

  test("encrypted-looking grouped value without encrypted: true still errors", () => {
    const { publicKeyHex } = generateKeyPair();
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { PWD: { type: "string" } }, // not declared encrypted
      },
    });

    const env = {
      DATABASE_PWD: encryptEnvValue("secret", publicKeyHex, "DATABASE_PWD"),
    };

    const v = new EnvValidator(schema, { keysPath: ".nonexistent-xyz.keys" });
    try {
      v.validate(env);
      throw new Error("should have thrown");
    } catch (err: any) {
      const agg = err as EnvAggregateError;
      const e = agg.errors.find((x: any) => x.key === "DATABASE_PWD");
      expect(e).toBeDefined();
      expect(e!.message).toMatch(/does not declare encrypted/);
    }
  });

  test("wrong key: decryption failure is reported and the group is skipped", () => {
    const { publicKeyHex } = generateKeyPair();
    const wrongPair = generateKeyPair();
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { PWD: { type: "string", encrypted: true } },
      },
    });

    const env = {
      DATABASE_PWD: encryptEnvValue("secret", publicKeyHex, "DATABASE_PWD"),
    };

    const v = new EnvValidator(schema, { keysPath: ".nonexistent-xyz.keys" });
    process.env.ENVGAD_PRIVATE_KEY = wrongPair.privateKeyHex;
    try {
      v.validate(env);
      throw new Error("should have thrown");
    } catch (err: any) {
      const agg = err as EnvAggregateError;
      expect(agg.errors).toHaveLength(1);
      expect(agg.errors[0].key).toBe("DATABASE_PWD");
    }
  });

  test("top-level encrypted fields still work alongside grouped ones", () => {
    const { publicKeyHex, privateKeyHex } = generateKeyPair();
    const schema = defineSchema({
      API_KEY: { type: "string", required: true, encrypted: true },
      DATABASE: {
        type: "object",
        properties: { PWD: { type: "string", required: true, encrypted: true } },
      },
    });

    const env = {
      API_KEY: encryptEnvValue("sk-123", publicKeyHex, "API_KEY"),
      DATABASE_PWD: encryptEnvValue("dbpass", publicKeyHex, "DATABASE_PWD"),
    };

    const v = new EnvValidator(schema, { keysPath: ".nonexistent-xyz.keys" });
    process.env.ENVGAD_PRIVATE_KEY = privateKeyHex;
    const result = v.validate(env);
    expect(result.API_KEY).toBe("sk-123");
    expect(result.DATABASE).toEqual({ PWD: "dbpass" });
  });
});