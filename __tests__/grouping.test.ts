import { defineSchema, EnvValidator, EnvAggregateError } from "../src/index.js";

describe("grouped env variables (envPrefix)", () => {
  test("maps prefixed envs into an object", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: {
          DB_NAME: { type: "string", required: true },
          PORT: { type: "port", default: 5432 },
          PWD: { type: "string", sensitive: true },
        },
      },
    });

    const env = {
      DATABASE_DB_NAME: "mydb",
      DATABASE_PORT: "5432",
      DATABASE_PWD: "supersecret",
    };

    const v = new EnvValidator(schema);
    const validated = v.validate(env);

    expect(validated.DATABASE).toBeDefined();
    expect(validated.DATABASE.DB_NAME).toBe("mydb");
    expect(validated.DATABASE.PORT).toBe(5432);
    expect(validated.DATABASE.PWD).toBe("supersecret");
  });

  test("prefixed variables take precedence over top-level JSON and warn", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { DB_NAME: { type: "string" } },
      },
    });

    const env = {
      DATABASE: JSON.stringify({ DB_NAME: "jsondb" }),
      DATABASE_DB_NAME: "prefdb",
    };

    const originalWarn = console.warn;
    let wasWarned = false;
    console.warn = () => {
      wasWarned = true;
    };
    const v = new EnvValidator(schema);
    const validated = v.validate(env);
    expect(validated.DATABASE.DB_NAME).toBe("prefdb");
    expect(wasWarned).toBe(true);
    console.warn = originalWarn;
  });

  test("strict mode flags unexpected grouped properties", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { DB_NAME: { type: "string" } },
      },
    });

    const env = {
      DATABASE_DB_NAME: "mydb",
      DATABASE_EXTRA: "unexpected",
    };

    const v = new EnvValidator(schema, { strict: true });
    expect(() => v.validate(env)).toThrow();
  });

  test("schema-declared sibling keys are not folded into a group (strict)", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { DB_NAME: { type: "string", default: "mydb" } },
      },
      DATABASE_URL: { type: "url", required: true },
    });

    const v = new EnvValidator(schema, { strict: true });
    const validated = v.validate({ DATABASE_URL: "https://db.example.com" });
    expect(validated.DATABASE_URL).toBe("https://db.example.com");
    expect(validated.DATABASE).toEqual({ DB_NAME: "mydb" });
  });

  // Issue #58: object groups were skipped entirely when no prefixed variable was set
  test("applies property defaults when no prefixed variable is set", () => {
    const schema = defineSchema({
      GROUP_WITH_DEFAULT: {
        type: "object",
        envPrefix: "ABSENT_",
        properties: { VALUE: { type: "string", default: "fallback" } },
      },
    });

    const v = new EnvValidator(schema);
    const validated = v.validate({});
    expect(validated.GROUP_WITH_DEFAULT).toEqual({ VALUE: "fallback" });
  });

  test("enforces required properties when no prefixed variable is set", () => {
    const schema = defineSchema({
      GROUP_WITH_REQUIRED: {
        type: "object",
        envPrefix: "ALSOABSENT_",
        properties: { VALUE: { type: "string", required: true } },
      },
    });

    const v = new EnvValidator(schema);
    expect(() => v.validate({})).toThrow(EnvAggregateError);
  });

  test("group-level required is enforced when the whole group is absent", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        required: true,
        properties: { DB_NAME: { type: "string", default: "mydb" } },
      },
    });

    const v = new EnvValidator(schema);
    expect(() => v.validate({})).toThrow(/Missing required/);
  });

  test("group-level default wins when the whole group is absent", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        default: { DB_NAME: "from-group-default" },
        properties: { DB_NAME: { type: "string", default: "from-prop-default" } },
      },
    });

    const v = new EnvValidator(schema);
    const validated = v.validate({});
    expect(validated.DATABASE).toEqual({ DB_NAME: "from-group-default" });
  });

  test("partial group still merges defaults for unset properties", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: {
          DB_NAME: { type: "string", required: true },
          PORT: { type: "port", default: 5432 },
        },
      },
    });

    const v = new EnvValidator(schema);
    const validated = v.validate({ DATABASE_DB_NAME: "mydb" });
    expect(validated.DATABASE).toEqual({ DB_NAME: "mydb", PORT: 5432 });
  });

  test("includeRaw shows raw grouped values when enabled", () => {
    const schema = defineSchema({
      DATABASE: {
        type: "object",
        properties: { DB_NAME: { type: "number" } },
      },
    });

    const v = new EnvValidator(schema, { includeRaw: true });
    try {
      v.validate({ DATABASE_DB_NAME: "not-a-number" });
      throw new Error("should have thrown");
    } catch (err: any) {
      const agg = err as EnvAggregateError;
      const e = agg.errors.find((x: any) => x.key === "DATABASE");
      expect(e).toBeDefined();
    }
  });
});
