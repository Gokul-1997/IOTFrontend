import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { jwtDecode } from 'jwt-decode';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private api = environment.apiUrl + '/auth';
  private refreshTimer: any;

  /** Fires when a refresh brings a different set of grants than the browser
   *  held — so the header can rebuild its menu instead of showing a page the
   *  company no longer has until the next reload. */
  readonly grantsChanged$ = new Subject<void>();

  constructor(private http: HttpClient, private router: Router) {}

  private setSession(res: any): void {
    localStorage.setItem('token', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem('user', JSON.stringify(res.user));
    this.scheduleRefresh(res.accessToken);
  }

  login(data: any) {
    return this.http.post<any>(`${this.api}/login`, data).pipe(
      tap(res => this.setSession(res))
    );
  }

  refreshToken() {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.http.post<any>(`${this.api}/refresh`, { refreshToken }).pipe(
      tap(res => {
        localStorage.setItem('token', res.accessToken);
        this.mergeGrants(res);
        this.scheduleRefresh(res.accessToken);
      })
    );
  }

  /**
   * Keep the stored grants in step with the server.
   *
   * hasPermission/hasAction/hasWidget all read `permissions` and
   * `company_permissions` out of the user object saved at login, and nothing
   * ever rewrote them: a page an admin revoked in Manage Access stayed usable
   * in the UI until the person signed out and back in. The refresh response
   * now carries both lists, so they are refreshed here every time the token
   * is — roughly every 14 minutes for anyone with the app open.
   *
   * Only fields the server actually sent are applied. An older API that
   * returns just a token must not blank the lists (an empty company list
   * reads as "unrestricted").
   */
  private mergeGrants(res: any): void {
    const hasPerms   = Array.isArray(res?.permissions);
    const hasCompany = Array.isArray(res?.company_permissions);
    if (!hasPerms && !hasCompany) return;

    const user = this.getUser();
    if (!user || !Object.keys(user).length) return;

    const before = JSON.stringify([user.permissions, user.company_permissions]);
    if (hasPerms)   user.permissions         = res.permissions;
    if (hasCompany) user.company_permissions = res.company_permissions;
    localStorage.setItem('user', JSON.stringify(user));

    // Order-insensitive: the API does not promise a stable row order, and a
    // reshuffled but identical list is not a change worth rebuilding a menu for.
    const norm = (v: any) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
    if (norm(user.permissions) + norm(user.company_permissions) !==
        norm(JSON.parse(before)[0]) + norm(JSON.parse(before)[1])) {
      this.grantsChanged$.next();
    }
  }

  /** `reason`, when given, is shown on the sign-in page — so someone signed
   *  out by the server (their company was turned off) is told why. */
  logout(reason?: string): void {
    clearTimeout(this.refreshTimer);
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      this.http.post(`${this.api}/logout`, { refreshToken }).subscribe({ error: () => {} });
    }
    localStorage.clear();
    if (reason) {
      try { sessionStorage.setItem('signedOutReason', reason); } catch { /* shown only if storage works */ }
    }
    this.router.navigate(['/login']);
  }

  /** The reason set by logout(), read once. */
  takeSignedOutReason(): string {
    try {
      const reason = sessionStorage.getItem('signedOutReason') || '';
      sessionStorage.removeItem('signedOutReason');
      return reason;
    } catch { return ''; }
  }

  scheduleRefresh(token: string): void {
    clearTimeout(this.refreshTimer);
    try {
      const decoded: any = jwtDecode(token);
      const refreshTime = decoded.exp * 1000 - Date.now() - 60_000;
      if (refreshTime <= 0) return;
      this.refreshTimer = setTimeout(() => this.refreshToken().subscribe(), refreshTime);
    } catch { this.logout(); }
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  // ── User Context Helpers ───────────────────────
  getUser(): any {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  }

  getRoles(): string[] {
    return this.getUser().roles || [];
  }

  getPermissions(): string[] {
    return this.getUser().permissions || [];
  }

  isSntSuper(): boolean {
    return this.getRoles().includes('SNT_SUPER');
  }

  isCompanyAdmin(): boolean {
    return this.getRoles().includes('COMPANY_ADMIN');
  }

  isAdmin(): boolean {
    const roles = this.getRoles();
    return roles.includes('SNT_SUPER') || roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN');
  }

  getCompanyId(): number | null {
    return this.getUser().company_id || null;
  }

  getPlan(): any {
    return this.getUser().plan || null;
  }

  /** Permissions the company is allowed (set by super user). */
  getCompanyPermissions(): string[] {
    return this.getUser().company_permissions || [];
  }

  /**
   * Check if user has a specific permission.
   * Admins always return true.
   * Also matches `page:machines` if user has `page:machines:view`.
   */
  hasPermission(permission: string): boolean {
    if (this.isSntSuper()) return true;
    // Company admin: check company_permissions
    if (this.isCompanyAdmin()) return this.companyAllows(permission);

    /* Any other role needs the permission on the role AND the page granted to
       its company. Only the role was checked, so a role could go on showing —
       and opening — a page its company had since been refused. The API checks
       both (middleware/access.middleware.js); the menu and the route guard now
       agree with it. */
    const perms = this.getPermissions();
    const roleAllows = perms.includes(permission) || perms.some(p => p.startsWith(permission + ':'));
    return roleAllows && this.companyAllows(permission);
  }

  /** Has the company been granted this page? A company with no grants at all
   *  is fresh and unrestricted — the reading everything else here takes. */
  private companyAllows(permission: string): boolean {
    const companyPerms = this.getCompanyPermissions();
    if (companyPerms.length === 0) return true;
    return companyPerms.includes(permission) || companyPerms.some(p => p.startsWith(permission + ':'));
  }

  /**
   * Check if user has a specific CRUD action on a page.
   * e.g. hasAction('machines', 'create')
   * Company admins check company_permissions; regular users need the role permission and the company grant.
   */
  hasAction(module: string, action: string): boolean {
    if (this.isSntSuper()) return true;
    const key = `page:${module}:${action}`;

    // Company admin: check company_permissions (what super user allowed)
    if (this.isCompanyAdmin()) {
      const companyPerms = this.getCompanyPermissions();
      return companyPerms.length === 0 || companyPerms.includes(key);
    }

    // Regular user: the role must hold it AND the company must have been
    // granted it (an empty grant list is a fresh, unrestricted company) — the
    // same rule as hasWidget, and as the API for the analytics dashboards.
    const companyPerms = this.getCompanyPermissions();
    if (companyPerms.length > 0 && !companyPerms.includes(key)) return false;
    return this.getPermissions().includes(key);
  }

  /**
   * Check if a widget/section is visible for this user's company.
   * First checks company_permissions (what super user allowed),
   * then checks user's own role permissions.
   * e.g. hasWidget('dashboard', 'partcount')
   */
  hasWidget(module: string, widget: string): boolean {
    if (this.isSntSuper()) return true;
    const key = `page:${module}:${widget}`;
    const companyPerms = this.getCompanyPermissions();
    // Company admin sees everything their company has access to
    if (this.isCompanyAdmin()) {
      return companyPerms.length === 0 || companyPerms.includes(key);
    }
    // Regular users: check company-level access first, then role permissions
    if (companyPerms.length > 0 && !companyPerms.includes(key)) return false;
    return this.getPermissions().includes(key);
  }

  /** The nine dashboards, in the order a user should land on them. */
  private static readonly ANALYTICS_LANDINGS = [
    { permission: 'page:analytics-factory',     path: '/factory' },
    { permission: 'page:analytics-oee',         path: '/oee-dashboard' },
    { permission: 'page:analytics-maintenance', path: '/maintenance-dashboard' },
    { permission: 'page:analytics-preventive',  path: '/preventive-maintenance' },
    { permission: 'page:analytics-periodic',    path: '/periodic-maintenance' },
    { permission: 'page:analytics-downtime',    path: '/downtime-analysis' },
    { permission: 'page:analytics-alarms',      path: '/alarm-report' },
    { permission: 'page:analytics-operators',   path: '/operator-performance' },
    { permission: 'page:analytics-energy',      path: '/energy-dashboard' },
  ];

  /** Every page someone can land on, in the order they should land on them.
   *  It used to stop at a handful, so a role holding only Program Transfer
   *  (SETTER), or only Quality, signed in to "Access Denied" although the
   *  menu offered it a page. Order follows the menu. */
  private static readonly LANDINGS = [
    { permission: 'page:dashboard',          path: '/dashboard' },
    ...AuthService.ANALYTICS_LANDINGS,
    { permission: 'page:maintenance-report', path: '/maintenance-report' },
    { permission: 'page:oee-reports',        path: '/oee-reports' },
    { permission: 'page:reports',            path: '/reports' },
    { permission: 'page:charts',             path: '/charts' },
    { permission: 'page:quality',            path: '/quality' },
    { permission: 'page:programs',           path: '/programs' },
    { permission: 'page:maintenance',        path: '/maintenance' },
    { permission: 'page:alarms',             path: '/alarms' },
    { permission: 'page:downtime',           path: '/downtime' },
    { permission: 'page:machines',           path: '/machines' },
    { permission: 'page:component',          path: '/component' },
    { permission: 'page:job',                path: '/job' },
    { permission: 'page:shifts',             path: '/shifts' },
    { permission: 'page:operators',          path: '/operators' },
    { permission: 'page:assignments',        path: '/assignments' },
    { permission: 'page:machine-shifts',     path: '/machine-shifts' },
    { permission: 'page:plants',             path: '/plants' },
    { permission: 'page:lines',              path: '/lines' },
  ];

  /** The first page this person can open — after sign-in, and for the
   *  app's home address. Role AND company, as hasPermission: landing on a
   *  page the API would then refuse is worse than falling through. */
  getFirstAccessibleRoute(): string {
    try {
      // SNT_SUPER only accesses admin pages
      if (this.isSntSuper()) return '/admin/companies';

      const first = AuthService.LANDINGS.find(r => this.hasPermission(r.permission));
      if (first) return first.path;
      // a company admin whose company has no pages yet still runs its users
      return this.isCompanyAdmin() ? '/admin/users' : '/no-access';
    } catch {
      return '/no-access';
    }
  }

  /* ── Self-service profile ──────────────────────────────────
     Every authenticated user reaches their own account through these — the
     admin-only GET/PUT /api/users/:id routes cannot answer "what is my own
     profile", so a MANAGER/SUPERVISOR/OPERATOR had no route to it at all. */

  getMyProfile() {
    return this.http.get<any>(`${this.api}/me`);
  }

  updateMyProfile(patch: { email?: string; mobile?: string }) {
    return this.http.patch<any>(`${this.api}/me`, patch).pipe(
      tap(res => {
        // Keep the cached user in sync so the header reflects the new email
        // immediately, without asking the user to log in again to see it.
        if (res?.data) {
          const user = this.getUser();
          localStorage.setItem('user', JSON.stringify({ ...user, ...res.data }));
        }
      })
    );
  }

  changeMyPassword(current_password: string, new_password: string) {
    return this.http.post(`${this.api}/change-password`, { current_password, new_password });
  }

  forgotPassword(email: string) {
    return this.http.post(`${this.api}/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post(`${this.api}/reset-password`, { token, password });
  }
}
