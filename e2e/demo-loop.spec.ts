import { expect, test } from '@playwright/test';
import { P, freshDemo, viewAs } from './helpers';

test('3-minute demo script: reflect → invite coach → guardian-visible request → coach publishes one action → athlete chooses NEXT → guardian sees support cue', async ({ page }) => {
  await freshDemo(page);
  await expect(page.getByRole('region', { name: 'Demo mode' })).toContainText('Synthetic data');

  // 1. Fictional minor athlete reflects (exact prompts, ~90 seconds).
  await viewAs(page, P.max);
  await expect(page.getByRole('heading', { name: 'Hi Max O.' })).toBeVisible();
  await page.getByRole('link', { name: 'Reflect now' }).click();
  await page.getByLabel('What did you do well?').fill('I won most of my headers and talked to my centre-back.');
  await page.getByLabel('What moment would you like back?').fill('I hesitated before the shot in the second half. I waited for a perfect touch.');
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Save reflection' }).click();
  await expect(page.getByRole('heading', { name: 'Reflection saved' })).toBeVisible();

  // 2. Invite a real coach: simulated, copyable link; no diary data in the invite.
  await page.getByRole('link', { name: 'Coaches' }).click();
  await page.getByLabel('Coach’s name').fill('Coach Riley N.');
  await page.getByLabel('Coach’s email').fill('riley@coach.example.test');
  await page.getByRole('button', { name: 'Create invite' }).click();
  const link = await page.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/coach\/accept#token=[A-Za-z0-9_-]{43}$/);
  expect(link).not.toContain('hesitated');
  await expect(page.getByText('Demo: nothing was emailed')).toBeVisible();
  await expect(page.getByText('Verification pending')).toBeVisible(); // Coach Kim: pending coaches can't receive

  // 3. Ask the verified coach; audience (incl. guardian as second adult) shown before submission.
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('link', { name: 'Ask a coach about this' }).first().click();
  await expect(page.getByText('Who will see this', { exact: true })).toBeVisible();
  await expect(page.getByText('Second adult (guardian)')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/demo-1-request-audience.png', fullPage: true });
  await page.getByLabel('Your question').fill('How can I shoot sooner when I get the ball near the box?');
  await page.getByLabel('I’ve checked who will see this').check();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Awaiting coach')).toBeVisible();

  // 4. Guardian sees the actual shared request (Rule of Two) but not the private diary.
  await viewAs(page, P.pat);
  await expect(page.getByRole('heading', { name: 'Family' })).toBeVisible();
  await expect(page.getByText('I hesitated before the shot in the second half.').first()).toBeVisible();
  await expect(page.getByText('I won most of my headers')).toHaveCount(0);

  // 5. Coach reviews: AI organizes (labeled, draft-only), coach writes ONE action, previews, confirms, publishes.
  await viewAs(page, P.sam);
  await page.getByRole('link', { name: /Max O\./ }).first().click();
  await page.getByRole('button', { name: 'Organize with AI (draft only)' }).click();
  await expect(page.getByText('Generated suggestion — not a coach')).toBeVisible();
  await page.getByLabel('One next action').fill('Shoot within two touches');
  await page.getByLabel('In which situation').fill('When you receive the ball at the edge of the box');
  await page.getByLabel('Simple measure').fill('3 first-time attempts next session');
  await page.getByRole('button', { name: 'Preview before publishing' }).click();
  await expect(page.getByRole('heading', { name: 'Exactly what will be published' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/demo-2-coach-preview.png', fullPage: true });
  await page.getByLabel(/I confirm the recipient/).check();
  await page.getByRole('button', { name: 'Confirm review' }).click();
  await page.getByRole('button', { name: 'Publish to Max O.' }).dblclick(); // retries/double taps never publish twice
  await expect(page.getByRole('heading', { name: /^Published/ })).toBeVisible();
  const pubs = await page.evaluate(() => JSON.parse(localStorage.getItem('loop.demo.state.v3')!).publications.length);
  expect(pubs).toBe(2); // 1 fixture + exactly 1 new

  // Optional support cue for the guardian, reviewed then published.
  await page.getByLabel('Something to say').fill('Shooting earlier is the focus this week.');
  await page.getByLabel('A question to ask').fill('Which chance felt best today?');
  await page.getByLabel('A habit to praise').fill('Asking for feedback');
  await page.getByRole('button', { name: 'Save support cue draft' }).click();
  await page.getByRole('link', { name: 'Coach', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await page.getByRole('button', { name: 'Publish to guardian' }).click();

  // 6. Athlete sees verified attribution and explicitly chooses NEXT → Loop closed.
  await viewAs(page, P.max);
  await expect(page.getByText('Coach responded')).toBeVisible();
  await page.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByText('Verified coach')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/demo-3-athlete-feedback.png', fullPage: true });
  await page.getByRole('button', { name: 'Make this my NEXT' }).click();
  await expect(page.getByText('Loop closed').first()).toBeVisible();
  await page.goto('/home');
  await expect(page.getByText('Shoot within two touches')).toBeVisible();

  // 7. Guardian sees the support cue — not a raw diary.
  await viewAs(page, P.pat);
  await expect(page.getByText('Asking for feedback')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/demo-4-guardian-cue.png', fullPage: true });
  await expect(page.getByText('Shoot within two touches').first()).toBeVisible();
  await expect(page.getByText('I won most of my headers')).toHaveCount(0);
});
