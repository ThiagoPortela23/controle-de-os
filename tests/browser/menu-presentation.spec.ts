import { expect, test, type Page } from '@playwright/test';
import type { DashboardData } from '../../client/src/types.js';

async function login(page: Page, email: string, password = 'TestPassword123!') {
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na central' }).click();
  await expect(page.getByRole('heading', { name: 'Ordens de serviço.' })).toBeVisible();
}
const trigger = (page: Page) => page.getByRole('button', { name: 'Menu do usuário', exact: true });
for (const [email, password, name, role] of [
  ['ana@example.com', 'TestPassword123!', 'Ana Solicitante', 'Solicitante'],
  ['carlos@example.com', 'TestPassword123!', 'Carlos Técnico', 'Técnico'],
  ['admin@example.com', 'InitialAdmin123!', 'Admin Teste', 'Administrador'],
]) {
  test(`menu de usuário: ${role}, teclado, navegação e logout`, async ({ page }) => {
    await login(page, email, password);
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
    await trigger(page).focus(); await page.keyboard.press('ArrowDown');
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
    await expect(menu.getByText(role, { exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Alterar senha' })).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Sair', exact: true })).toBeFocused();
    await page.keyboard.press('Home'); await expect(page.getByRole('menuitem', { name: 'Alterar senha' })).toBeFocused();
    await page.keyboard.press('End'); await expect(page.getByRole('menuitem', { name: 'Sair', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(trigger(page)).toBeFocused();
    await trigger(page).click(); await page.getByRole('heading', { name: 'Ordens de serviço.' }).click();
    await expect(menu).toHaveCount(0); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
    await trigger(page).focus(); await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: 'Sair', exact: true })).toBeFocused();
    await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/senha$/); await expect(page.getByRole('heading', { name: 'Trocar senha', exact: true })).toBeVisible();
    await expect(menu).toHaveCount(0);
    await trigger(page).click(); await page.keyboard.press('Tab'); await expect(menu).toHaveCount(0);
    await trigger(page).click(); await page.goBack(); await expect(menu).toHaveCount(0);
    if (role === 'Administrador') {
      await page.route('**/api/auth/logout', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Falha simulada de logout.' }) }));
      await trigger(page).click(); await page.getByRole('menuitem', { name: 'Sair', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Falha simulada de logout.'); await expect(trigger(page)).toBeVisible();
      await page.unroute('**/api/auth/logout');
    }
    await trigger(page).click(); await page.getByRole('menuitem', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible();
  });
}

function largeDashboard(): DashboardData {
  const ranks = Array.from({ length: 5 }, (_, index) => ({ id: `fixture-${index}`, name: `Técnico ${index + 1} · ${'Nome longo do profissional '.repeat(4)}`, total: 999999 - index }));
  return { dailyTotal: 2000000000, monthlyTotal: 2000000000, open: 123456789, assigned: 999999, pendingAcceptance: 99999,
    assignedRanking: ranks, resolvedRanking: ranks,
    monthlySeries: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, opened: 1000 * (index + 1), resolved: 700 * (index + 1) })) };
}
test('apresentação 16:9 cabe sem cortes, mantém filtros/tema e restaura foco/rolagem', async ({ page }) => {
  await page.route('**/api/dashboard?*', route => route.fulfill({ json: largeDashboard() }));
  await login(page, 'admin@example.com', 'InitialAdmin123!');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.getByLabel('Ano', { exact: true }).fill('2025'); await page.getByLabel('Mês', { exact: true }).selectOption('12');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await expect(page.getByText('Período: Dezembro de 2025.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Usar tema escuro' }).click();
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 1024 }]) {
    await page.setViewportSize(size);
    const enter = page.getByRole('button', { name: 'Apresentar em tela cheia', exact: true });
    await enter.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollTo(0, 80));
    const scrollBefore = await page.evaluate(() => window.scrollY); expect(scrollBefore).toBeGreaterThan(0);
    await enter.click(); const stage = page.getByRole('region', { name: 'Dashboard em apresentação', exact: true });
    await expect(stage).toBeVisible(); await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await expect(page.locator('.sidebar')).toBeHidden(); await expect(page.locator('.topbar')).toBeHidden(); await expect(page.locator('.workspace-footer')).toBeHidden();
    await expect(page.getByLabel('Ano', { exact: true })).toBeHidden(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(stage.getByText('Dezembro de 2025 · Fila atual e indicadores do período')).toBeVisible();
    await expect(stage.locator('.ranking-list li')).toHaveCount(10);
    const layout = await stage.evaluate(element => {
      const canvas = element.querySelector<HTMLElement>('.dashboard-canvas')!;
      const board = canvas.getBoundingClientRect();
      const contents = [...canvas.querySelectorAll<HTMLElement>('.stat-card, .dashboard-visuals>.panel, .ranking-panel, .ranking-list li')];
      return { ratio: board.width / board.height, inside: contents.every(item => {
        const bounds = item.getBoundingClientRect(); return bounds.left >= board.left - 1 && bounds.top >= board.top - 1 && bounds.right <= board.right + 1 && bounds.bottom <= board.bottom + 1;
      }), panelsFit: [...canvas.querySelectorAll<HTMLElement>('.ranking-panel')].every(item => item.scrollHeight <= item.clientHeight + 1),
        numbersFit: [...canvas.querySelectorAll<HTMLElement>('.stat-card strong')].every(item => item.scrollWidth <= item.clientWidth + 1) };
    });
    expect(layout.ratio).toBeCloseTo(16 / 9, 3); expect(layout.inside).toBe(true); expect(layout.panelsFit).toBe(true); expect(layout.numbersFit).toBe(true);
    await page.screenshot({ path: `test-results/presentation-${size.width}x${size.height}.png` });
    if (size.width === 1366) await page.keyboard.press('Escape'); else await page.getByRole('button', { name: 'Voltar ao dashboard', exact: true }).click();
    await expect(stage).toHaveCount(0); await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
    await expect(enter).toBeFocused(); await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0);
    await expect(page.getByLabel('Ano', { exact: true })).toHaveValue('2025'); await expect(page.getByLabel('Mês', { exact: true })).toHaveValue('12');
  }
});
test('apresentação mantém SSE, relógio e áudio; sessão encerrada sai da tela cheia', async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await adminContext.addInitScript(() => {
    const state = window as unknown as { eventSources: number; audioStarts: number; audioStops: number; sounds: number };
    state.eventSources = 0; state.audioStarts = 0; state.audioStops = 0; state.sounds = 0;
    const Source = EventSource; window.EventSource = class extends Source { constructor(url: string | URL, options?: EventSourceInit) { super(url, options); state.eventSources++; } };
    const Audio = AudioContext; window.AudioContext = class extends Audio {
      constructor(options?: AudioContextOptions) { super(options); state.audioStarts++; }
      createOscillator() { state.sounds++; return super.createOscillator(); }
      close() { state.audioStops++; return super.close(); }
    };
  });
  const requesterContext = await browser.newContext(); const admin = await adminContext.newPage(); const requester = await requesterContext.newPage();
  await login(admin, 'admin@example.com', 'InitialAdmin123!'); await login(requester, 'bruno@example.com');
  await admin.getByRole('link', { name: 'Dashboard', exact: true }).click();
  const before = Number(await admin.getByTestId('metric-dailyTotal').innerText());
  await admin.getByRole('button', { name: 'Ativar som', exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Desativar som', exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Apresentar em tela cheia', exact: true }).click();
  const stage = admin.getByRole('region', { name: 'Dashboard em apresentação', exact: true }); await expect(stage).toBeVisible();
  const clock = await stage.getByLabel('Hora de Brasília').innerText();
  await expect.poll(() => stage.getByLabel('Hora de Brasília').innerText()).not.toBe(clock);
  await requester.getByRole('link', { name: 'Nova ordem' }).click();
  await requester.getByLabel('Título do chamado').fill('Chamado durante apresentação');
  await requester.getByLabel('Descrição', { exact: true }).fill('Verificar atualização e áudio sem reconectar.');
  await requester.getByRole('button', { name: 'Abrir ordem de serviço' }).click();
  await expect(requester.getByRole('heading', { name: 'Chamado durante apresentação' })).toBeVisible();
  await expect(stage.getByTestId('metric-dailyTotal')).toHaveText(String(before + 1));
  expect(await admin.evaluate(() => { const state = window as unknown as { eventSources: number; audioStarts: number; audioStops: number; sounds: number }; return { sources: state.eventSources, starts: state.audioStarts, stops: state.audioStops, sounds: state.sounds }; }))
    .toEqual({ sources: 1, starts: 1, stops: 0, sounds: 1 });
  await admin.getByRole('button', { name: 'Voltar ao dashboard', exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Desativar som', exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Apresentar em tela cheia', exact: true }).click(); await expect(stage).toBeVisible();
  const session = await (await admin.request.get('/api/auth/me')).json();
  expect((await admin.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': session.csrfToken, Origin: 'http://127.0.0.1:3317' } })).status()).toBe(200);
  await expect(admin.getByRole('heading', { name: 'Acesse sua conta' })).toBeVisible();
  await expect.poll(() => admin.evaluate(() => document.fullscreenElement)).toBe(null);
  await expect(admin.locator('body')).not.toHaveClass(/dashboard-presenting/);
  await adminContext.close(); await requesterContext.close();
});
test('recusa da Fullscreen API usa apresentação ampliada e Esc restaura a página', async ({ page }) => {
  await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('Denied for test')); });
  await login(page, 'admin@example.com', 'InitialAdmin123!'); await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  const enter = page.getByRole('button', { name: 'Apresentar em tela cheia', exact: true }); await enter.click();
  const stage = page.getByRole('region', { name: 'Dashboard em apresentação', exact: true }); await expect(stage).toBeVisible();
  await expect(stage.getByText('Tela cheia nativa indisponível. Apresentação ampliada nesta janela.')).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBe(null);
  await page.keyboard.press('Escape'); await expect(stage).toHaveCount(0); await expect(enter).toBeFocused();
  await expect(page.locator('.sidebar')).toBeVisible(); await expect(page.locator('.topbar')).toBeVisible();
});
