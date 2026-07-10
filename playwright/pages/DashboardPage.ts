import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

export type DashboardSection = 'profile' | 'settings' | 'users' | 'analytics'

const SECTION_PATHS: Record<DashboardSection, string> = {
  profile: '/profile',
  settings: '/settings',
  users: '/users',
  analytics: '/analytics',
}

export class DashboardPage {
  readonly page: Page

  readonly heading: Locator
  readonly userMenuButton: Locator
  readonly userDisplayName: Locator
  readonly userDisplayEmail: Locator
  readonly logoutButton: Locator
  readonly navLinks: Locator
  readonly pageContent: Locator
  readonly loadingIndicator: Locator
  readonly notificationBadge: Locator

  constructor(page: Page) {
    this.page = page

    this.heading = page
      .getByTestId('dashboard-heading')
      .or(page.getByRole('heading', { level: 1 }))
    this.userMenuButton = page
      .getByTestId('user-menu-button')
      .or(page.getByRole('button', { name: /user menu|account|profile/i }))
    this.userDisplayName = page
      .getByTestId('user-display-name')
      .or(page.getByRole('status').filter({ hasText: /^[A-Z]/ }))
    this.userDisplayEmail = page.getByTestId('user-display-email')
    this.logoutButton = page
      .getByTestId('logout-button')
      .or(page.getByRole('button', { name: /log out|sign out|logout/i }))
    this.navLinks = page
      .getByTestId('dashboard-nav')
      .or(page.getByRole('navigation'))
      .locator('a')
    this.pageContent = page
      .getByTestId('dashboard-content')
      .or(page.getByRole('main'))
    this.loadingIndicator = page
      .getByTestId('loading-indicator')
      .or(page.getByRole('status', { name: /loading/i }))
    this.notificationBadge = page
      .getByTestId('notification-badge')
      .or(page.locator('[aria-label*="notification"]'))
  }

  async goto(): Promise<void> {
    await this.page.goto('/dashboard')
    await this.page.waitForURL(/\/dashboard/)
    await this.waitForContentReady()
  }

  /** Wait for the main content to appear and spinner to disappear. */
  async waitForContentReady(): Promise<void> {
    // Wait for loading indicators to vanish (best-effort — skip if absent)
    const loadingCount = await this.loadingIndicator.count()
    if (loadingCount > 0) {
      await expect(this.loadingIndicator).not.toBeVisible({ timeout: 10_000 })
    }
    await expect(this.pageContent).toBeVisible()
  }

  /** Open the user dropdown / account menu. */
  async openUserMenu(): Promise<void> {
    await this.userMenuButton.click()
    await expect(this.logoutButton).toBeVisible()
  }

  /** Click logout and wait for redirect to /login. */
  async logout(): Promise<void> {
    await this.openUserMenu()
    await this.logoutButton.click()
    await this.page.waitForURL(/\/login/)
  }

  /** Navigate to a named dashboard section. */
  async navigateTo(section: DashboardSection): Promise<void> {
    const targetPath = SECTION_PATHS[section]
    await this.page.goto(targetPath)
    await this.page.waitForURL(new RegExp(targetPath))
  }

  /** Click a nav link by its visible label. */
  async clickNavLink(label: string | RegExp): Promise<void> {
    const link = this.page.getByRole('navigation').getByRole('link', { name: label })
    await link.click()
  }

  /** Assert the page loaded and the heading is visible. */
  async expectLoaded(): Promise<void> {
    await expect(this.pageContent).toBeVisible()
    await expect(this.heading).toBeVisible()
  }

  /** Assert the displayed user name matches the expected value. */
  async expectUserName(name: string | RegExp): Promise<void> {
    await this.openUserMenu()
    const nameText = typeof name === 'string' ? name : name
    await expect(this.userDisplayName).toContainText(nameText)
  }

  /** Assert a nav link with the given label is present. */
  async expectNavLinkVisible(label: string | RegExp): Promise<void> {
    const link = this.page.getByRole('navigation').getByRole('link', { name: label })
    await expect(link).toBeVisible()
  }

  /** Assert the page redirected away from dashboard (e.g. after logout). */
  async expectRedirectedToLogin(): Promise<void> {
    await this.page.waitForURL(/\/login/)
  }

  /** Assert notification badge count (pass 0 to assert absence). */
  async expectNotificationCount(count: number): Promise<void> {
    if (count === 0) {
      const badgeCount = await this.notificationBadge.count()
      if (badgeCount === 0) return
      await expect(this.notificationBadge).not.toBeVisible()
    } else {
      await expect(this.notificationBadge).toContainText(String(count))
    }
  }
}
