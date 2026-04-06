import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DashboardService } from './dashboard.service';
import { SocketService } from '../../core/services/socket.service';
import {
  Subject,
  interval,
  switchMap,
  startWith,
  takeUntil
} from 'rxjs';

/* ─────────────────────────────────────────
   SOCKET  → status (RUNNING / IDLE / OFFLINE)
             + alarm ONLY
             instant visual feedback, no calc

   API 30s → run_time, idle_time,
             utilization, achieved_qty,
             operator, part_name, target_qty
             smooth field-level patch only
───────────────────────────────────────── */

const POLL_MS              = 30_000;
const OFFLINE_THRESHOLD_SEC = 10;

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {

  /* ── public state ── */
  machines: any[] = [];
  summary:  any   = {};
  shift:    any   = {};
  currentTime = '';
  currentDateStr = '';

  /* ── private ── */
  private destroy$         = new Subject<void>();
  private clockInterval: any;
  private machineMap       = new Map<number, any>();
  private updateQueue:     any[]  = [];
  private updateScheduled         = false;

  private visibilityHandler = () => {
    if (document.hidden) {
      this.socketService.pauseUpdates();
    } else {
      this.socketService.resumeUpdates();
      this.fetchMetrics(); // immediate re-fetch on tab restore
    }
  };

  constructor(
    private service:       DashboardService,
    private socketService: SocketService,
    private zone:          NgZone,
    private cdr:           ChangeDetectorRef,
    private router:        Router
  ) {}

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  async ngOnInit(): Promise<void> {

    const user    = JSON.parse(localStorage.getItem('user') || '{}');
    const plantId = user?.plant_id;

    await this.socketService.connect();

    if (plantId) {
      this.socketService.joinPlant(plantId);
    }

    /* ── 30s API poll ──────────────────────
       startWith(0) → fires instantly on init
       switchMap    → cancels stale request
    ──────────────────────────────────────── */
    interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.service.getLive()),
        takeUntil(this.destroy$)
      )
      .subscribe((res: any) => this.applyApiResponse(res));

    /* ── Socket → status + alarm ONLY ─── */
    this.socketService.onMachineUpdate((data: any) => {
      this.handleSocketUpdate(data);
    });

    document.addEventListener('visibilitychange', this.visibilityHandler);

    /* ── Live clock (IST) ── */
    const tick = () => {
      const now = new Date();
      this.currentTime = now.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true, timeZone: 'Asia/Kolkata'
      });
      this.currentDateStr = now.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        timeZone: 'Asia/Kolkata'
      });
      this.cdr.markForCheck();
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  /* ════════════════════════════════════════
     API RESPONSE
     ✅ Owns: run_time, idle_time, utilization,
              achieved_qty, target_qty,
              operator_name, part_name
     ❌ Never touches: status, alarm
  ════════════════════════════════════════ */
  private applyApiResponse(res: any): void {

    const incoming: any[] = res.machines || [];
    this.shift = res.shift || this.shift;

    /* First load — set everything directly */
    if (this.machines.length === 0) {
      this.machines = incoming;
      this.summary  = res.summary || {};
      this.machineMap.clear();
      for (const m of this.machines) {
        this.machineMap.set(m.machine_id, m);
      }
      this.cdr.markForCheck();
      return;
    }

    /* Subsequent polls — patch metric fields only */
    for (const fresh of incoming) {
      const existing = this.machineMap.get(fresh.machine_id);
      if (!existing) {
        this.machines.push(fresh);
        this.machineMap.set(fresh.machine_id, fresh);
        continue;
      }
      this.patchMetrics(existing, fresh);
    }

    // Remove machines that no longer exist
    const freshIds = new Set(incoming.map((m: any) => m.machine_id));
    this.machines  = this.machines.filter(m => freshIds.has(m.machine_id));

    this.summary = res.summary || this.summary;
    this.cdr.markForCheck();
  }

  /**
   * Patch ONLY the fields the API owns.
   * status and alarm are deliberately excluded —
   * the socket owns those and updates them in real-time.
   */
  private patchMetrics(target: any, source: any): void {
    if (source.run_time      !== undefined) target.run_time      = source.run_time;
    if (source.idle_time     !== undefined) target.idle_time     = source.idle_time;
    if (source.run_minutes   !== undefined) target.run_minutes   = source.run_minutes;
    if (source.idle_minutes  !== undefined) target.idle_minutes  = source.idle_minutes;
    if (source.utilization   !== undefined) target.utilization   = source.utilization;
    if (source.achieved_qty  !== undefined) target.achieved_qty  = source.achieved_qty;
    if (source.target_qty    !== undefined) target.target_qty    = source.target_qty;
    if (source.produced_qty  !== undefined) target.produced_qty  = source.produced_qty;
    if (source.operator_name !== undefined) target.operator_name = source.operator_name;
    if (source.part_name     !== undefined) target.part_name     = source.part_name;
    if (source.component_id  !== undefined) target.component_id  = source.component_id;
    // ❌ status  → socket owns this
    // ❌ alarm   → socket owns this
  }

  /* ════════════════════════════════════════
     MANUAL FETCH  (called on tab restore)
  ════════════════════════════════════════ */
  private fetchMetrics(): void {
    this.service.getLive()
      .pipe(takeUntil(this.destroy$))
      .subscribe((res: any) => this.applyApiResponse(res));
  }

  /* ════════════════════════════════════════
     SOCKET → status + alarm ONLY

     ❌ achieved_qty  → NOT touched (API owns)
     ❌ run_time      → NOT touched (API owns)
     ❌ utilization   → NOT touched (API owns)
  ════════════════════════════════════════ */
  private handleSocketUpdate(data: any): void {

    this.updateQueue.push(data);

    if (!this.updateScheduled) {
      this.updateScheduled = true;

      requestAnimationFrame(() => {

        const updates        = [...this.updateQueue];
        this.updateQueue     = [];
        this.updateScheduled = false;

        this.zone.run(() => {

          let changed = false;

          for (const update of updates) {

            const machine = this.machineMap.get(update.machine_id);
            if (!machine) continue;

            /* ── Resolve status from socket payload ── */
            const nowSec         = Math.floor(Date.now() / 1000);
            const receivedAtSec  = Number(update.received_at || 0);
            const freshDiff      = receivedAtSec
              ? (nowSec - receivedAtSec)
              : null;

            let newStatus: string;

            if (
              !receivedAtSec ||
              (freshDiff !== null && freshDiff > OFFLINE_THRESHOLD_SEC)
            ) {
              newStatus = 'OFFLINE';
            } else if (
              ['RUN', 'RUNNING', 'CUTTING'].includes(
                (update.machine_status || '').toUpperCase()
              )
            ) {
              newStatus = 'RUNNING';
            } else {
              newStatus = 'IDLE';
            }

            /* ── Only mark changed if value actually differs ── */
            if (machine.status !== newStatus) {
              machine.status      = newStatus;
              machine.received_at = update.received_at ?? machine.received_at;
              changed = true;
            }

            const newAlarm = update.alarm === true;
            if (machine.alarm !== newAlarm) {
              machine.alarm = newAlarm;
              changed       = true;
            }
          }

          if (changed) {
            this.recalculateSummaryStatus();
            this.cdr.markForCheck();
          }
        });
      });
    }
  }

  /* ════════════════════════════════════════
     SUMMARY — recount running/idle from live array
     (only called after socket status updates)
  ════════════════════════════════════════ */
  private recalculateSummaryStatus(): void {
    let running = 0;
    let idle    = 0;

    for (const m of this.machines) {
      if (m.status === 'RUNNING')      running++;
      else if (m.status === 'IDLE')    idle++;
    }

    this.summary = {
      ...this.summary,
      running,
      idle,
      total: this.machines.length
    };
  }

  /* ════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════ */
  getLastSeen(last: string | null): string {
    if (!last) return 'No Data';
    const diff = (Date.now() - new Date(last).getTime()) / 1000;
    if (diff < 60)   return `${Math.floor(diff)} sec ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    return `${Math.floor(diff / 3600)} hr ago`;
  }

  /* ════════════════════════════════════════
     NAVIGATION
  ════════════════════════════════════════ */
  goToLive(id: number): void {
    this.router.navigate(['/dashboard/live', id]);
  }

  trackByMachine(_index: number, item: any): number {
    return item.machine_id;
  }

  /* ════════════════════════════════════════
     DESTROY
  ════════════════════════════════════════ */
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.socketService.offMachineUpdate();
    clearInterval(this.clockInterval);
  }
}