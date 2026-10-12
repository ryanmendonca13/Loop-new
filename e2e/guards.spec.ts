import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { P, freshDemo, noHorizontalOverflow, viewAs } from './helpers';

test('pending minor cannot reach the reflection form before guardian activation', async ({ page }) => {
  await freshDemo(page);
  await viewAs(page, P.avaR);
  await expect(page.getByRole('heading', { name: 'Almost ready' })).toBeVisible();
  await page.goto('/reflect');
  await expect(page.getByRole('heading', { name: 'Almost ready' })).toBeVisible();
  await expect(page.getByLabel('What did you do well?')).toHaveCount(0);
});

test('adult athlete reflects solo without a team; solo never claims coach feedback', async ({ page }) => {
  await freshDemo(page);
  await viewAs(page, P.avaT);
  await expect(page.getByText('Personal reflection mode').or(page.getByText('No coach request yet'))).toBeVisible();
  await page.getByRole('link', { name: 'Reflect now' }).click();
  await page.getByLabel('What did you do well?').fill('My serve was consistent.');
  await page.getByLabel('What moment would you like back?').fill('I froze on serve receive in the third set.');
  // Double tap: submitted exactly once.
  await page.getByRole('button', { name: 'Save reflection' }).dblclick();
  await page.getByRole('link', { name: 'Choose my NEXT step' }).click();
  await expect(page.getByText('This is your notebook, not coach feedback.')).toBeVisible();
  await page.getByLabel('I will…').fill('Call the ball early');
  await page.getByLabel('When…').fill('On serve receive');
  await page.getByLabel('I’ll know it worked if…').fill('I call 5 times');
  await page.getByRole('button', { name: 'Make this my focus' }).click();
  await expect(page.getByText('Call the ball early')).toBeVisible();
  await expect(page.getByText('Loop closed')).toHaveCount(0);
  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('loop.demo.state.v3')!).reflections.filter((r: { athleteId: string }) => r.athleteId === 'e0000000-0000-4000-8000-000000000002').length);
  expect(count).toBe(1);
});

test('draft survives reload (local recovery) and keyboard-only submission works', async ({ page }) => {
  await freshDemo(page);
  await viewAs(page, P.avaT);
  await page.goto('/reflect');
  await page.getByLabel('What did you do well?').focus();
  await page.keyboard.type('Kept my footwork tidy.');
  await page.keyboard.press('Tab'); // next focusable control is the second prompt
  await expect(page.getByLabel('What moment would you like back?')).toBeFocused();
  await page.keyboard.type('Late on the block.');
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.getByLabel('What did you do well?')).toHaveValue('Kept my footwork tidy.');
  await page.getByRole('button', { name: 'Save reflection' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Reflection saved' })).toBeVisible();
  // Local draft cleared after submit.
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('loop.draft')));
  expect(keys).toEqual([]);
});

test('pending coach sees no athlete content', async ({ page }) => {
  await freshDemo(page);
  await viewAs(page, P.kim);
  await expect(page.getByText('Verification pending').first()).toBeVisible();
  await expect(page.getByText('Nothing waiting')).toBeVisible();
});

const SCREENS: [string, string, string][] = [
  ['welcome', '', '/welcome'],
  ['athlete home', P.max, '/home'],
  ['reflect', P.max, '/reflect'],
  ['coaches', P.max, '/coaches'],
  ['history', P.max, '/profile'],
  ['pending', P.avaR, '/pending'],
  ['guardian', P.pat, '/guardian'],
  ['coach inbox', P.sam, '/coach'],
  ['settings', P.max, '/settings'],
  ['admin', P.jordan, '/admin'],
];

for (const [name, persona, path] of SCREENS) {
  test(`a11y + no overflow at 320px and 390px: ${name}`, async ({ page }) => {
    await freshDemo(page);
    if (persona) await viewAs(page, persona);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noHorizontalOverflow(page);
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await page.screenshot({ path: `test-results/screens/${name.replace(/\s+/g, '-')}-320.png`, fullPage: true });
  });
}
