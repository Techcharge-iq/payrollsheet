import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = "https://milcjipktyhlwiriujrw.supabase.co";
const userId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-05T00:00:00.000Z";

interface MockState {
  employees: Array<Record<string, unknown>>;
  payroll_batches: Array<Record<string, unknown>>;
  payroll_lines: Array<Record<string, unknown>>;
  advance_transactions: Array<Record<string, unknown>>;
  timesheets: Array<Record<string, unknown>>;
  payroll_site_allocations: Array<Record<string, unknown>>;
}

async function mockPayrollBackend(page: Page, role: "admin" | "hr") {
  const state: MockState = {
    employees: [
      {
        id: 1,
        name: "Asha Khan",
        trade: "HELPER",
        id_number: "E-001",
        hourly_rate: 3,
        status: "Active",
        created_at: timestamp,
      },
    ],
    payroll_batches: [],
    payroll_lines: [],
    advance_transactions: [],
    timesheets: [],
    payroll_site_allocations: [],
  };
  const reads = new Map<string, number>();
  let publishRealtime: (
    table: keyof MockState,
    eventType: "INSERT" | "UPDATE" | "DELETE",
    row: Record<string, unknown>,
  ) => void = () => {
    throw new Error("Realtime socket is not connected.");
  };

  await page.addInitScript(
    ({ userId, timestamp }) => {
      const session = {
        access_token: "mock-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "mock-refresh-token",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "payroll@example.test",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: timestamp,
        },
      };
      localStorage.setItem("sb-milcjipktyhlwiriujrw-auth-token", JSON.stringify(session));
    },
    { userId, timestamp },
  );

  await page.route(`${supabaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split("/").at(-1) ?? "";
    const method = request.method();

    if (table === "users" && method === "GET") {
      await route.fulfill({ json: { role } });
      return;
    }

    if (table in state) {
      const records = state[table as keyof MockState];
      if (method === "GET") {
        reads.set(table, (reads.get(table) ?? 0) + 1);
        await route.fulfill({ json: records });
        return;
      }

      if (method === "POST") {
        const requestBody = request.postDataJSON() as
          Record<string, unknown> | Array<Record<string, unknown>>;
        const rows = Array.isArray(requestBody) ? requestBody : [requestBody];
        const created = rows.map((row) => ({
          id: row["id"] ?? randomUUID(),
          created_at: timestamp,
          status: table === "payroll_batches" ? "DRAFT" : undefined,
          ...row,
        }));
        records.push(...created);
        await route.fulfill({
          status: 201,
          json: Array.isArray(requestBody) ? created : created[0],
        });
        return;
      }

      if (method === "PATCH") {
        const patch = request.postDataJSON() as Record<string, unknown>;
        const requestedStatus = patch["status"];
        if (role !== "admin" && requestedStatus) {
          await route.fulfill({
            status: 403,
            json: { message: "Only an administrator can change payroll status." },
          });
          return;
        }
        const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
        const updated = records
          .filter((row) => !idFilter || String(row["id"]) === idFilter)
          .map((row) => Object.assign(row, patch));
        const response = request.headers()["accept"]?.includes("vnd.pgrst.object")
          ? (updated[0] ?? null)
          : updated;
        await route.fulfill({
          json: request.headers()["prefer"]?.includes("return=representation") ? response : null,
        });
        return;
      }

      if (method === "DELETE") {
        const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
        const retained = records.filter((row) => String(row["id"]) !== idFilter);
        records.splice(0, records.length, ...retained);
        await route.fulfill({ status: 204, body: "" });
        return;
      }
    }

    await route.fulfill({
      status: 404,
      json: { message: `Unexpected Supabase request: ${method} ${url.pathname}` },
    });
  });

  await page.routeWebSocket(
    /wss:\/\/milcjipktyhlwiriujrw\.supabase\.co\/realtime\/v1\/websocket/,
    (socket) => {
      let topic = "";
      const idsByTable = new Map<string, number>();
      socket.onMessage((message) => {
        if (typeof message !== "string") return;
        const packet = JSON.parse(message) as unknown[];
        const event = packet[3];
        if (event === "phx_join") {
          topic = String(packet[2]);
          const joinPayload = packet[4] as {
            config?: { postgres_changes?: Array<Record<string, unknown>> };
          };
          const postgresChanges = (joinPayload.config?.postgres_changes ?? []).map(
            (filter, index) => {
              const id = index + 1;
              idsByTable.set(String(filter["table"]), id);
              return { ...filter, id };
            },
          );
          socket.send(
            JSON.stringify([
              packet[0],
              packet[1],
              packet[2],
              "phx_reply",
              { status: "ok", response: { postgres_changes: postgresChanges } },
            ]),
          );
        } else if (event === "heartbeat") {
          socket.send(
            JSON.stringify([
              packet[0],
              packet[1],
              packet[2],
              "phx_reply",
              { status: "ok", response: {} },
            ]),
          );
        }
      });
      publishRealtime = (table, eventType, row) => {
        const id = idsByTable.get(table);
        if (!topic || !id) throw new Error(`No Realtime binding was registered for ${table}.`);
        socket.send(
          JSON.stringify([
            null,
            null,
            topic,
            "postgres_changes",
            {
              ids: [id],
              data: {
                type: eventType,
                schema: "public",
                table,
                commit_timestamp: timestamp,
                columns: [],
                record: row,
                old_record: row,
                errors: null,
              },
            },
          ]),
        );
      };
    },
  );

  return {
    state,
    reads,
    publishRealtime: (...args: Parameters<typeof publishRealtime>) => publishRealtime(...args),
  };
}

async function openTab(page: Page, label: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: /Menu ·/ }).click();
  } else {
    await page.mouse.move(4, Math.round((await page.evaluate(() => innerHeight)) / 2));
    await page
      .getByRole("navigation", { name: "Application menu" })
      .getByRole("button", { name: label })
      .click();
    return;
  }
  await page
    .getByRole("navigation", { name: "Application menu" })
    .getByRole("button", { name: label })
    .click();
}

test.describe("responsive application navigation and dialogs", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 960, mobile: false },
    { name: "tablet", width: 820, height: 1180, mobile: false },
    { name: "mobile", width: 390, height: 844, mobile: true },
  ]) {
    test(`${viewport.name}: menu navigation and payroll dialog layering`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const backend = await mockPayrollBackend(page, "admin");
      await page.goto("/");
      await expect(page.getByText("Syncing payroll data…")).toBeHidden({ timeout: 20_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);

      await openTab(page, "Monthly Payroll", viewport.mobile);
      await openTab(page, "Employees", viewport.mobile);
      await openTab(page, "Monthly Payroll", viewport.mobile);
      for (const table of [
        "employees",
        "payroll_batches",
        "payroll_lines",
        "advance_transactions",
        "timesheets",
        "payroll_site_allocations",
      ]) {
        expect(backend.reads.get(table)).toBe(1);
      }
      await expect(page.getByRole("button", { name: "New payroll batch" })).toBeVisible();
      await page.getByRole("button", { name: "New payroll batch" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Create payroll batch")).toBeVisible();

      const menuZIndex = await page
        .locator("#application-menu")
        .evaluate((element) => getComputedStyle(element).zIndex);
      const dialogZIndex = await dialog.evaluate((element) => getComputedStyle(element).zIndex);
      expect(Number(dialogZIndex)).toBeGreaterThan(Number(menuZIndex));
      expect(backend.reads.get("payroll_batches")).toBe(1);
    });
  }
});

test("admin can create, submit, and approve a payroll batch", async ({ page }) => {
  const backend = await mockPayrollBackend(page, "admin");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByText("Syncing payroll data…")).toBeHidden({ timeout: 20_000 });
  await openTab(page, "Monthly Payroll", false);
  await page.getByRole("button", { name: "New payroll batch" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Site / project").fill("North Campus");
  await dialog.getByPlaceholder("Foreman name").first().fill("Samir");
  await dialog.getByPlaceholder("Search name, trade or ID…").first().fill("Asha");
  await page
    .getByRole("button", { name: /Asha Khan/ })
    .first()
    .click();
  const row = dialog.locator("tbody tr").first();
  await row.locator('input[type="number"]').first().fill("160");
  await dialog.getByRole("button", { name: "Save batch" }).click();

  await expect(page.getByText("North Campus")).toBeVisible();
  expect(backend.state.payroll_batches).toHaveLength(1);
  expect(backend.state.payroll_lines).toHaveLength(1);

  await page.getByRole("button", { name: "Submit review" }).click();
  const batchCard = page.locator(".mobile-batch-card").filter({ hasText: "North Campus" });
  await expect(batchCard).toContainText("REVIEW");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(batchCard).toContainText("APPROVED");
  expect(backend.state.payroll_batches[0]?.["status"]).toBe("APPROVED");
  expect(backend.reads.get("payroll_batches")).toBe(1);
});

test("attendance report shows daily hours and hover details in the site matrix", async ({
  page,
}) => {
  const backend = await mockPayrollBackend(page, "admin");
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const date = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  const firstFriday = Array.from(
    { length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() },
    (_, index) => index + 1,
  ).find((day) => day > 3 && new Date(`${date(day)}T00:00:00`).getDay() === 5);

  expect(firstFriday).toBeDefined();
  backend.state.timesheets.push(
    {
      id: randomUUID(),
      employee_id: 1,
      site: "North Campus",
      foreman: "Samir",
      work_date: date(1),
      status: "PRESENT",
      in_time: "07:00:00",
      out_time: "18:30:00",
      break_hours: 1,
      total_hours: 10.5,
      regular_hours: 10.5,
      overtime_hours: 0,
      remarks: null,
      created_at: timestamp,
    },
    {
      id: randomUUID(),
      employee_id: 1,
      site: "Remote site",
      foreman: "Samir",
      work_date: date(2),
      status: "PRESENT",
      in_time: "08:00:00",
      out_time: "17:00:00",
      break_hours: 1,
      total_hours: 8,
      regular_hours: 8,
      overtime_hours: 0,
      remarks: null,
      created_at: timestamp,
    },
    {
      id: randomUUID(),
      employee_id: 1,
      site: "North Campus",
      foreman: "Samir",
      work_date: date(3),
      status: "ABSENT",
      in_time: null,
      out_time: null,
      break_hours: 0,
      total_hours: null,
      regular_hours: 0,
      overtime_hours: 0,
      remarks: null,
      created_at: timestamp,
    },
    {
      id: randomUUID(),
      employee_id: 1,
      site: "North Campus",
      foreman: "Samir",
      work_date: date(firstFriday!),
      status: "WEEKLY_OFF",
      in_time: null,
      out_time: null,
      break_hours: 0,
      total_hours: null,
      regular_hours: 0,
      overtime_hours: 0,
      remarks: null,
      created_at: timestamp,
    },
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByText("Syncing payroll data…")).toBeHidden({ timeout: 20_000 });
  await openTab(page, "Attendance Report", false);
  await expect(page.getByRole("heading", { name: "Attendance report" })).toBeVisible();
  await page.getByRole("button", { name: "Filter by site" }).click();
  await page.getByLabel("Site").selectOption({ label: "North Campus" });

  await expect(page.getByText("10.5", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label$=": T"]')).toBeVisible();
  await expect(page.locator('[aria-label$=": A"]')).toBeVisible();
  await expect(page.locator('[aria-label$=": F"]').first()).toBeVisible();
  await page.locator('[aria-label$=": T"]').hover();
  await expect(page.getByText("Worked at: Remote site")).toBeVisible();
  await expect(page.getByText("Check-in: 08:00 · Check-out: 17:00")).toBeVisible();
  await expect(page.getByText("Break: 1.00 hrs")).toBeVisible();
});

test("Supabase Realtime updates Dexie without another table fetch", async ({ page }) => {
  const backend = await mockPayrollBackend(page, "admin");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Application menu" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Asha Khan" })).toBeVisible();

  const updatedEmployee = { ...backend.state.employees[0], name: "Asha Realtime" };
  backend.state.employees[0] = updatedEmployee;
  backend.publishRealtime("employees", "UPDATE", updatedEmployee);
  await page.getByPlaceholder("Search by name or ID…").fill("Asha Realtime");
  await expect(page.getByRole("cell", { name: "Asha Realtime" })).toBeVisible();
  expect(backend.reads.get("employees")).toBe(1);
});

test("HR can prepare payroll but does not get approval or deletion controls", async ({ page }) => {
  const backend = await mockPayrollBackend(page, "hr");
  backend.state.payroll_batches.push({
    id: "review-1",
    month: new Date().toISOString().slice(0, 7),
    site: "Review site",
    foreman: "Samir",
    status: "REVIEW",
    approved_by: null,
    approved_at: null,
    locked_by: null,
    locked_at: null,
    paid_by: null,
    paid_at: null,
    created_at: timestamp,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.getByText("Syncing payroll data…")).toBeHidden({ timeout: 20_000 });
  await openTab(page, "Monthly Payroll", false);
  await page.getByRole("button", { name: "New payroll batch" }).click();
  await expect(page.getByRole("button", { name: "Save batch" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Review site")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit review" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
