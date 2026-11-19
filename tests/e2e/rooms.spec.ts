import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:5341/test/reset");
  await page.addInitScript(() => {
    const session = { baseUrl: "http://127.0.0.1:5341", username: "Alice", userId: "alice-id", token: "fixture-only", endpointMap: { profile: { id: "profile", endpoint: "/api/auth/me" }, rooms: { id: "rooms", endpoint: "/api/user/rooms" } }, verifiedAt: "2026-11-17T00:00:00Z", probes: [] };
    localStorage.setItem("screeps-dashboard-auth", JSON.stringify({ state: { session }, version: 0 }));
  });
  await page.goto("/#/rooms");
  await expect(page.locator(".room-workbench-card")).toHaveCount(5);
  await expect(page.locator(".room-card-status").filter({ hasText: "最近拉取" })).toHaveCount(5);
});

test("compares room inventories across shards and exports the visible resource data", async ({ page }) => {
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("tab", { name: "资源库存", exact: true }).click();
  const energy = page.locator(".room-resource-matrix tbody tr").filter({ hasText: "Energy" });
  await expect(energy).toContainText("1,243,850");
  await expect(energy).toContainText("246,850");
  await expect(energy).toContainText("251,650");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  expect((await download).suggestedFilename()).toBe("screeps-resources.csv");
  await page.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(page.getByText("请选择至少一个房间查看资源与建筑汇总。")).toBeVisible();
  await page.goto("/#/login");
  await expect(page.getByRole("heading", { name: "房间工作台", exact: true })).toBeVisible();
});

test("filters buildings and exposes detailed inventory, IDs and capacity", async ({ page }) => {
  await page.getByRole("tab", { name: "建筑", exact: true }).click();
  await page.getByRole("combobox", { name: "对象类型", exact: true }).selectOption("storage");
  await expect(page.locator(".room-data-table tbody tr")).toHaveCount(4);
  await page.locator(".room-object-detail summary").first().click();
  await expect(page.locator(".room-object-detail[open]")).toContainText("1,000,000");
  await expect(page.locator(".room-object-detail[open]")).toContainText("XGH2O");
  await page.getByRole("combobox", { name: "对象类型", exact: true }).selectOption("tower");
  await page.getByLabel("仅受损对象").check();
  await expect(page.locator(".room-data-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".room-data-table tbody tr")).toContainText("W2N1");
});

test("requires confirmation and posts each batch intent once", async ({ page, request }) => {
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("tab", { name: "房间管理", exact: true }).click();
  await page.getByRole("button", { name: "核对 10 个对象" }).click();
  expect(await (await request.get("http://127.0.0.1:5341/test/intents")).json()).toHaveLength(0);
  await expect(page.getByRole("region", { name: "确认目标与操作" })).toContainText("shard1/W1N1");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await (await request.get("http://127.0.0.1:5341/test/intents")).json()).toHaveLength(0);
  await page.getByRole("button", { name: "核对 10 个对象" }).click();
  await page.getByRole("button", { name: "确认并提交" }).click();
  await expect(page.getByRole("status")).toContainText("已提交 10 项，失败 0 项");
  const intents = await (await request.get("http://127.0.0.1:5341/test/intents")).json();
  expect(intents).toHaveLength(10);
  expect(intents.every((item: { body: { name: string; intent: { isPublic: boolean } } }) => item.body.name === "setPublic" && item.body.intent.isPublic === false)).toBe(true);
});

test("reviews construction coordinates before submitting one construction request", async ({ page, request }) => {
  await page.getByRole("tab", { name: "房间管理", exact: true }).click();
  await page.getByText("创建建筑工地", { exact: true }).click();
  await page.getByLabel("X", { exact: true }).fill("12");
  await page.getByLabel("Y", { exact: true }).fill("18");
  await page.getByRole("button", { name: "核对工地", exact: true }).click();
  await expect(page.getByRole("region", { name: "确认目标与操作" })).toContainText("road (12, 18)");
  await expect(page.getByLabel("X", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Y", { exact: true })).toBeDisabled();
  expect(await (await request.get("http://127.0.0.1:5341/test/intents")).json()).toHaveLength(0);
  await page.getByRole("button", { name: "确认并提交" }).click();
  await expect(page.getByRole("status")).toContainText("已提交 1 项，失败 0 项");
  const intents = await (await request.get("http://127.0.0.1:5341/test/intents")).json();
  expect(intents).toEqual([{ endpoint: "/api/game/create-construction", body: { room: "E2S3", shard: "main", x: 12, y: 18, structureType: "road" } }]);
});

test("renders the official room map and keeps details accessible after returning", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".room-workbench-card footer a").first().click();
  await expect(page.locator(".room-official-map-host canvas")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".room-game-map-fallback")).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("official-room-map.png") });
  expect(errors).toEqual([]);
  await page.getByRole("tab", { name: "建筑", exact: true }).click();
  await page.getByRole("combobox", { name: "对象类型", exact: true }).selectOption("constructionSite");
  await expect(page.locator(".room-data-table tbody tr")).toHaveCount(1);
  await page.locator(".room-object-detail summary").click();
  await expect(page.locator(".room-object-detail[open]")).toContainText("600 / 3,000");
});

test("keeps the previous snapshot after refresh failure and shows per-room errors", async ({ page, request }) => {
  await request.post("http://127.0.0.1:5341/test/fail", { data: { room: "W1N1" } });
  await page.getByRole("button", { name: "刷新全部", exact: true }).click();
  await expect(page.locator(".room-card-status").filter({ hasText: "旧快照" })).toHaveCount(2);
  const card = page.locator(".room-workbench-card").filter({
    has: page.locator('input[aria-label="选择房间: W1N1 shard0"]'),
  });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("旧快照");
  await expect(card).not.toContainText("246,850");
  await expect(card.locator(".entity-chip")).toHaveText("RCL —");
  await card.getByText("查看请求错误").click();
  await expect(card).toContainText("Room objects unavailable");
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("tab", { name: "资源库存", exact: true }).click();
  const energy = page.locator(".room-resource-matrix tbody tr").filter({ hasText: "Energy" });
  await expect(energy).toContainText("745,350");
  const headers = await page.locator(".room-resource-matrix thead th").allTextContents();
  const staleColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes("W1N1") && header.includes("旧快照"));
  expect(staleColumns).toHaveLength(2);
  for (const { index } of staleColumns) {
    await expect(energy.locator("td").nth(index - 1)).toHaveText("—");
  }
});

test("mobile layout remains contained and single-room resources stay accessible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".shell-nav")).toBeHidden();
  await expect(page.locator(".nav-drawer-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator(".nav-drawer-toggle").click();
  await expect(page.locator(".shell-nav")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".shell-nav")).toBeHidden();
  await expect(page.locator(".nav-drawer-toggle")).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-workbench.png"), fullPage: true });
  await page.locator(".room-workbench-card footer a").first().click();
  await expect(page.getByRole("tab", { name: "房间地图" })).toBeVisible();
  await page.getByRole("tab", { name: "资源库存", exact: true }).click();
  await expect(page.locator(".room-resource-matrix tbody tr")).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("watch list, private shard lookup and English locale work together", async ({ page }) => {
  await page.getByRole("textbox", { name: "房间名", exact: true }).fill("W9N9");
  await page.locator(".room-watch-form input[aria-label='分片']").fill("main");
  await page.getByRole("button", { name: "添加关注" }).click();
  await expect(page.locator(".room-workbench-card")).toHaveCount(6);
  await expect(page.locator(".room-workbench-card").filter({ hasText: "W9N9" })).toContainText("加载失败");
  await page.evaluate(() => localStorage.setItem("screeps-dashboard-i18n", JSON.stringify({ state: { locale: "en-US" }, version: 0 })));
  // Switch through the store module is avoided; set the documented persisted key and reload.
  await page.reload();
  await expect(page.locator(".room-workbench-card")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Room Workbench", exact: true })).toBeVisible();
});
