import { describe, expect, it } from "vitest";
import {
  DiscordAPIError,
  DiscordClient,
  majorRoute,
} from "../src/discord/client.js";
import { fakeTime, fetchStub } from "./helpers.js";

const TOKEN = "test-token";

function makeClient(
  fn: typeof fetch,
  time: ReturnType<typeof fakeTime>,
  extra: Partial<ConstructorParameters<typeof DiscordClient>[0]> = {},
): DiscordClient {
  return new DiscordClient({
    token: TOKEN,
    fetchFn: fn,
    sleep: time.sleep,
    now: time.now,
    writeDelayMs: 0,
    ...extra,
  });
}

describe("route keys", () => {
  it("keeps major ids and collapses minor ids", () => {
    expect(majorRoute("/guilds/123456789012345678/roles/876543210987654321")).toBe(
      "/guilds/123456789012345678/roles/:id",
    );
    expect(majorRoute("/channels/123456789012345678/permissions/876543210987654321")).toBe(
      "/channels/123456789012345678/permissions/:id",
    );
  });
});

describe("rate limiting", () => {
  it("retries a bucket-scoped 429 after retry_after from the body", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub((_call, i) =>
      i === 1
        ? {
            status: 429,
            body: {
              message: "You are being rate limited.",
              retry_after: 1.5,
              global: false,
            },
            headers: { "x-ratelimit-scope": "user" },
          }
        : { status: 200, body: { ok: true } },
    );
    const client = makeClient(fn, time);
    const result = await client.request<{ ok: boolean }>(
      "GET",
      "/guilds/123456789012345678/roles",
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(time.sleeps).toContain(1500);
  });

  it("a bucket-scoped 429 does NOT pause other routes", async () => {
    const time = fakeTime();
    const { fn } = fetchStub((call, _i) =>
      call.url.includes("/roles") && time.sleeps.length === 0
        ? {
            status: 429,
            body: { message: "slow down", retry_after: 2, global: false },
            headers: { "x-ratelimit-scope": "user" },
          }
        : { status: 200, body: { ok: true } },
    );
    const client = makeClient(fn, time);
    await client.request("GET", "/guilds/123456789012345678/roles");
    const sleepsAfterFirst = time.sleeps.length;
    await client.request("GET", "/guilds/123456789012345678/channels");
    // The second route slept zero additional times.
    expect(time.sleeps.length).toBe(sleepsAfterFirst);
  });

  it("a global-scoped 429 pauses ALL routes", async () => {
    const time = fakeTime();
    let sent429 = false;
    const { fn, calls } = fetchStub((call, _i) => {
      if (call.url.endsWith("/users/@me") && !sent429) {
        sent429 = true;
        return {
          status: 429,
          body: { message: "global limit", retry_after: 5, global: true },
          headers: { "x-ratelimit-scope": "global" },
        };
      }
      return { status: 200, body: { ok: true } };
    });
    const client = makeClient(fn, time);

    await client.request("GET", "/users/@me");
    expect(time.sleeps).toEqual([5000]); // its own retry wait

    // A different route (different bucket) must also wait out the global
    // window (the fake clock is frozen, so the window is still open).
    await client.request("GET", "/guilds/123456789012345678/channels");
    expect(time.sleeps).toEqual([5000, 5000]);
    expect(calls.filter((c) => c.url.includes("/channels"))).toHaveLength(1);
  });

  it("sleeps until reset when a bucket is exhausted (remaining 0)", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub(() => ({
      status: 200,
      body: { ok: true },
      headers: {
        "x-ratelimit-bucket": "abcd1234",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset-after": "2.5",
      },
    }));
    const client = makeClient(fn, time);
    await client.request("GET", "/guilds/123456789012345678/roles");
    expect(time.sleeps).toHaveLength(0);
    await client.request("GET", "/guilds/123456789012345678/roles");
    expect(time.sleeps).toContain(2500);
    expect(calls).toHaveLength(2);
  });

  it("gives up after too many consecutive 429s", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub(() => ({
      status: 429,
      body: { message: "still limited", retry_after: 0.1, global: false },
      headers: { "x-ratelimit-scope": "user" },
    }));
    const client = makeClient(fn, time, { max429Retries: 3 });
    await expect(
      client.request("GET", "/guilds/123456789012345678/roles"),
    ).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(4); // initial + 3 retries
  });
});

describe("retries", () => {
  it("retries 5xx with exponential backoff and succeeds", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub((_call, i) =>
      i <= 2 ? { status: 502, body: {} } : { status: 200, body: { ok: true } },
    );
    const client = makeClient(fn, time);
    const result = await client.request<{ ok: boolean }>("GET", "/users/@me");
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(time.sleeps).toHaveLength(2);
    const first = time.sleeps[0] ?? 0;
    const second = time.sleeps[1] ?? 0;
    expect(first).toBeGreaterThanOrEqual(1000);
    expect(first).toBeLessThanOrEqual(1250);
    expect(second).toBeGreaterThanOrEqual(2000);
    expect(second).toBeLessThanOrEqual(2500);
  });

  it("gives up on 5xx after 5 attempts", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub(() => ({ status: 500, body: {} }));
    const client = makeClient(fn, time);
    await expect(client.request("GET", "/users/@me")).rejects.toBeInstanceOf(
      DiscordAPIError,
    );
    expect(calls).toHaveLength(5);
  });

  it("never retries a non-429 4xx and surfaces Discord's error detail", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub(() => ({
      status: 400,
      body: {
        code: 50035,
        message: "Invalid Form Body",
        errors: {
          channels: {
            "0": {
              name: {
                _errors: [
                  { code: "BASE_TYPE_REQUIRED", message: "This field is required" },
                ],
              },
            },
          },
        },
      },
    }));
    const client = makeClient(fn, time);
    try {
      await client.request("POST", "/guilds", { body: { name: "x" } });
      expect.unreachable();
    } catch (err) {
      const apiErr = err as DiscordAPIError;
      expect(apiErr).toBeInstanceOf(DiscordAPIError);
      expect(apiErr.status).toBe(400);
      expect(apiErr.code).toBe(50035);
      expect(apiErr.details[0]).toContain("channels.0.name");
      expect(apiErr.details[0]).toContain("This field is required");
      expect(apiErr.hint).toContain("Invalid Form Body");
    }
    expect(calls).toHaveLength(1);
  });
});

describe("write serialisation", () => {
  it("serialises writes globally and spaces them with WRITE_DELAY_MS", async () => {
    const time = fakeTime();
    let inFlight = 0;
    let maxInFlight = 0;
    const { fn } = fetchStub(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { status: 200, body: {} };
    });
    const client = makeClient(fn, time, { writeDelayMs: 250 });
    await Promise.all([
      client.request("POST", "/guilds/123456789012345678/roles", { body: {} }),
      client.request("POST", "/guilds/123456789012345678/channels", {
        body: {},
      }),
    ]);
    expect(maxInFlight).toBe(1);
    expect(time.sleeps).toContain(250);
  });

  it("serialises reads on the same route", async () => {
    const time = fakeTime();
    let inFlight = 0;
    let maxInFlight = 0;
    const { fn, calls } = fetchStub(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { status: 200, body: {} };
    });
    const client = makeClient(fn, time);
    await Promise.all([
      client.request("GET", "/guilds/123456789012345678/roles"),
      client.request("GET", "/guilds/123456789012345678/roles"),
    ]);
    expect(maxInFlight).toBe(1);
    expect(calls).toHaveLength(2);
  });
});

describe("request shape", () => {
  it("sends Bot auth and the URL-encoded audit log reason", async () => {
    const time = fakeTime();
    const { fn, calls } = fetchStub(() => ({ status: 200, body: {} }));
    const client = makeClient(fn, time);
    await client.request("POST", "/guilds/123456789012345678/roles", {
      body: { name: "x" },
      reason: 'create role "x"',
    });
    const call = calls[0];
    expect(call?.headers["Authorization"]).toBe(`Bot ${TOKEN}`);
    expect(call?.headers["X-Audit-Log-Reason"]).toBe(
      encodeURIComponent('create role "x"'),
    );
    expect(call?.headers["Content-Type"]).toBe("application/json");
  });
});
