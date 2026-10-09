import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SocketService {
  /** Every time the live connection comes up — the first time and after each drop. */
  readonly connected$ = new Subject<void>();
  /** The live connection dropped (not when it is closed on purpose: sign-out, another user). */
  readonly disconnected$ = new Subject<void>();
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private cancelConnect?: () => void;
  private paused = false;
  private refreshing = false;
  private userId: number | null = null;
  private plantId?: number;
  private machineListeners = new Set<(data: any) => void>();
  private jobListeners = new Set<(job: any) => void>();
  /* The unread count's listener belongs to NotificationService, a root
     service that lives as long as the app: a sign-out closes the socket but
     keeps it, so the next session's socket delivers to it as well. */
  private unreadListeners = new Set<(count: number) => void>();
  private scopes = new Map<string, number[]>();

  constructor(private zone: NgZone, private auth: AuthService) {
    this.auth.sessionChanged$.subscribe(() => this.disconnect());
  }

  connect(): Promise<void> {
    const userId = this.auth.getUser()?.id ?? null;
    if (this.socket && this.userId !== userId) this.disconnect();
    if (this.socket?.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (!this.socket) {
      this.userId = userId;
      const socket = this.socket = io(environment.socketUrl, {
        transports: ['websocket'], autoConnect: false, reconnection: true,
        reconnectionAttempts: Infinity, reconnectionDelay: 2000,
        reconnectionDelayMax: 30000, randomizationFactor: 0.5,
        auth: { token: localStorage.getItem('token') }
      });
      socket.on('connect', () => {
        if (socket !== this.socket) return;
        this.refreshing = false;
        this.sendScope();
        if (this.plantId) socket.emit('joinPlant', this.plantId);
        this.connected$.next();
      });
      socket.on('machineUpdate', data => {
        if (this.paused || document.hidden) return;
        this.zone.run(() => { for (const callback of this.machineListeners) callback(data); });
      });
      socket.on('programJob', job => this.zone.run(() => {
        for (const callback of this.jobListeners) callback(job);
      }));
      // the server says when this person's unread count changes (Backend notifications announceUnread)
      socket.on('unreadCount', payload => {
        if (socket !== this.socket) return;
        const count = Number(payload?.count);
        if (!Number.isFinite(count) || count < 0) return;
        this.zone.run(() => { for (const callback of this.unreadListeners) callback(count); });
      });
      socket.on('disconnect', () => {
        if (socket === this.socket) this.disconnected$.next();
      });
      socket.on('connect_error', err => {
        if (socket !== this.socket) return;
        if (err.message === 'TOKEN_EXPIRED' && !this.refreshing) {
          this.refreshing = true;
          this.auth.refreshToken().subscribe({
            next: res => {
              if (socket !== this.socket) return;
              this.refreshing = false;
              socket.auth = { token: res.accessToken };
              socket.connect();
            },
            error: err => {
              if (socket !== this.socket) return;
              this.refreshing = false;
              if (err?.status === 401 || err?.status === 403) this.auth.logout();
              else this.cancelConnect?.();
            }
          });
        } else if (err.message === 'Unauthorized') this.auth.logout();
      });
    }
    const socket = this.socket;
    const attempt = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        socket.off('connect', connected);
        socket.off('connect_error', failed);
        if (this.cancelConnect === cancelled) this.cancelConnect = undefined;
        error ? reject(error) : resolve();
      };
      const connected = () => finish();
      const failed = (error: Error) => { if (error.message !== 'TOKEN_EXPIRED') finish(error); };
      const cancelled = () => finish(new Error('Session ended'));
      const timeout = setTimeout(() => finish(new Error('Live connection timed out')), 15000);
      this.cancelConnect = cancelled;
      socket.on('connect', connected);
      socket.on('connect_error', failed);
      socket.connect();
    });
    const pending = attempt.finally(() => { if (this.connecting === pending) this.connecting = null; });
    this.connecting = pending;
    return pending;
  }

  joinPlant(plantId: number): void {
    this.plantId = plantId;
    this.socket?.emit('joinPlant', plantId);
  }

  onMachineUpdate(callback: (data: any) => void): () => void {
    this.machineListeners.add(callback);
    return () => { this.machineListeners.delete(callback); };
  }

  onProgramJob(callback: (job: any) => void): () => void {
    this.jobListeners.add(callback);
    return () => { this.jobListeners.delete(callback); };
  }

  onUnreadCount(callback: (count: number) => void): () => void {
    this.unreadListeners.add(callback);
    return () => { this.unreadListeners.delete(callback); };
  }

  get isConnected(): boolean { return !!this.socket?.connected; }

  setMachineScope(owner: string, ids: number[]): void {
    this.scopes.set(owner, [...new Set(ids)]);
    this.sendScope();
  }
  clearMachineScope(owner: string): void { this.scopes.delete(owner); this.sendScope(); }
  private sendScope(): void {
    if (this.socket?.connected) this.socket.emit('subscribeMachines', this.paused || document.hidden ? [] : [...new Set([...this.scopes.values()].flat())]);
  }
  pauseUpdates(): void { this.paused = true; this.sendScope(); }
  resumeUpdates(): void { this.paused = false; this.sendScope(); }

  disconnect(): void {
    this.cancelConnect?.();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.connecting = null;
    this.userId = null;
    this.plantId = undefined;
    this.refreshing = false;
    this.paused = false;
    this.scopes.clear();
    this.machineListeners.clear();
    this.jobListeners.clear();
  }
}
