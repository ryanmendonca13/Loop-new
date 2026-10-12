import { expect, type Page } from '@playwright/test';

export const P = {
  max: 'Max O.',
  avaT: 'Ava T.',
  avaR: 'Ava R.',
  pat: 'Pat O.',
  sam: 'Coach Sam R.',
  kim: 'Coach Kim O.',
  riley: 'Coach Riley N.',
  jordan: 'Jordan B.',
};

export async function freshDemo(page: Page) {
  await page.goto('/welcome');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/welcome');
}

/** DEMO-ONLY role switcher (never present in Supabase mode). */
export async function viewAs(page: Page, name: string) {
  const select = page.getByLabel('View as');
  const value = await select.locator('option', { hasText: name }).first().getAttribute('value');
  await select.selectOption(value!);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}
