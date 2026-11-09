import { expect, test } from '@playwright/test';

test('the production starter serves a visible page without a browser exception', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
  await expect(page).not.toHaveTitle('');
  expect(errors).toEqual([]);
});
