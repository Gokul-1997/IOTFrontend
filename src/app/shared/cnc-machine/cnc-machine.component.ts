import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostBinding, Input, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';

let uid = 0;

/**
 * A vertical machining centre, drawn live. The stack light shows the state
 * (green running, amber idle, red blinking on an alarm); while the machine
 * runs, the cutter turns, the table traverses, the head plunges, coolant
 * flows and chips fly. Idle and offline machines stand still, and a drawing
 * scrolled out of view pauses entirely. Motion stops for anyone who asked
 * the system for less of it.
 */
@Component({
  selector: 'app-cnc-machine',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <svg viewBox="0 0 300 210" role="img" [attr.aria-label]="ariaLabel" focusable="false">
    <defs>
      <linearGradient [attr.id]="id('steel')" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--steel-2)"/><stop offset=".45" style="stop-color:var(--steel-1)"/><stop offset="1" style="stop-color:var(--steel-3)"/>
      </linearGradient>
      <linearGradient [attr.id]="id('dark')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--steel-3)"/><stop offset="1" style="stop-color:var(--steel-4)"/>
      </linearGradient>
      <linearGradient [attr.id]="id('inside')" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0d1f33"/><stop offset="1" stop-color="#1b3854"/>
      </linearGradient>
      <linearGradient [attr.id]="id('glass')" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".26"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".04"/><stop offset="1" stop-color="#9fd3ff" stop-opacity=".14"/>
      </linearGradient>
      <radialGradient [attr.id]="id('lightglow')" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#fff6d6" stop-opacity=".55"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0"/>
      </radialGradient>
      <clipPath [attr.id]="id('win')"><rect x="28" y="56" width="172" height="114" rx="6"/></clipPath>
      <clipPath [attr.id]="id('tool')"><rect x="112" y="117" width="8" height="17" rx="1.5"/></clipPath>
      <filter [attr.id]="id('glow')" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <g class="drawing">
      <ellipse class="shadow" cx="150" cy="202" rx="138" ry="5"/>

      <!-- stack light -->
      <rect x="31" y="29" width="3" height="12" class="pole"/>
      <rect x="25" y="2" width="15" height="2.6" rx="1.3" class="pole"/>
      <rect x="26" y="4.5" width="13" height="7.6" rx="2" class="lamp red" [class.on]="lamp === 'red'" [attr.filter]="lamp === 'red' ? url('glow') : null"/>
      <rect x="26" y="12.7" width="13" height="7.6" rx="2" class="lamp amber" [class.on]="lamp === 'amber'" [attr.filter]="lamp === 'amber' ? url('glow') : null"/>
      <rect x="26" y="20.9" width="13" height="7.6" rx="2" class="lamp green" [class.on]="lamp === 'green'" [attr.filter]="lamp === 'green' ? url('glow') : null"/>

      <!-- cabinet -->
      <rect x="14" y="40" width="272" height="146" rx="9" class="frame" [attr.fill]="url('steel')"/>
      <rect x="14" y="40" width="272" height="10" rx="5" class="roof"/>
      <rect x="14" y="46" width="272" height="4" class="roof-edge"/>

      <!-- inside the guard -->
      <g [attr.clip-path]="url('win')">
        <rect x="28" y="56" width="172" height="114" [attr.fill]="url('inside')"/>
        <ellipse class="worklight" cx="62" cy="60" rx="46" ry="26" [attr.fill]="url('lightglow')"/>
        <rect x="150" y="56" width="36" height="114" class="column"/>
        <rect x="145" y="62" width="5" height="100" class="rail"/>
        <rect x="38" y="158" width="152" height="12" class="saddle"/>

        <g class="xaxis mv">
          <rect x="50" y="147" width="116" height="10" rx="1.5" class="table"/>
          <line x1="58" y1="152" x2="158" y2="152" class="slot"/>
          <rect x="88" y="137" width="46" height="10" rx="1" class="vise"/>
          <rect x="96" y="130" width="30" height="8" rx="1" class="work"/>
          <path d="M100 130.4 h11" class="cut-mark"/>
        </g>

        <g class="zaxis mv">
          <rect x="97" y="53" width="38" height="9" rx="2" class="motor"/>
          <rect x="92" y="60" width="48" height="40" rx="4" class="head"/>
          <rect x="99" y="67" width="34" height="3" rx="1.5" class="head-line"/>
          <rect x="107" y="100" width="18" height="10" rx="2" class="nose"/>
          <rect x="110" y="110" width="12" height="7" rx="1.5" class="holder"/>
          <g [attr.clip-path]="url('tool')">
            <rect x="112" y="117" width="8" height="17" class="tool"/>
            <g class="flutes mv">
              <line *ngFor="let k of flutes" [attr.x1]="k" y1="134" [attr.x2]="k + 9" y2="115" class="flute"/>
            </g>
          </g>
          <path d="M136 94 q 9 12 -3 27" class="hose"/>
          <path d="M132 121 q -5 6 -11 9" class="coolant mv"/>
        </g>

        <g class="chips">
          <rect *ngFor="let c of chips" x="115" y="130" width="2.4" height="1.4" rx=".6" class="chip mv"
                [style.--dx.px]="c.dx" [style.--dy.px]="c.dy" [style.--r.deg]="c.r" [style.animation-delay.s]="c.delay"/>
        </g>

        <rect class="alarm-flash" x="28" y="56" width="172" height="114"/>
      </g>

      <!-- glass guard and doors -->
      <rect x="28" y="56" width="172" height="114" rx="6" class="glass" [attr.fill]="url('glass')"/>
      <path d="M44 56 L72 56 L38 170 L28 170 L28 110 Z" class="reflect"/>
      <path d="M150 56 L160 56 L128 170 L118 170 Z" class="reflect thin"/>
      <rect x="26" y="54" width="176" height="118" rx="7" class="door-frame"/>
      <line x1="114" y1="54" x2="114" y2="172" class="door-split"/>
      <rect x="108" y="100" width="3" height="18" rx="1.5" class="handle"/>
      <rect x="117" y="100" width="3" height="18" rx="1.5" class="handle"/>

      <!-- control panel -->
      <rect x="210" y="56" width="66" height="116" rx="6" class="panel"/>
      <rect x="216" y="62" width="54" height="34" rx="3" class="hmi"/>
      <text x="221" y="71.5" class="hmi-sub">{{ hmiLabel }}</text>
      <text x="243" y="88" class="hmi-text" text-anchor="middle" [attr.font-size]="hmiValue.length > 5 ? 10 : 13">{{ hmiValue }}</text>
      <rect [attr.x]="243 + hmiValue.length * (hmiValue.length > 5 ? 3.1 : 4) + 2" y="79.5" width="2.2" height="9" class="hmi-caret mv"/>
      <g class="keys">
        <rect *ngFor="let k of keys" [attr.x]="k.x" [attr.y]="k.y" width="12" height="5.5" rx="1.2" class="key"/>
      </g>
      <circle cx="223" cy="138" r="4.6" class="btn-start"/>
      <circle cx="236" cy="138" r="4.6" class="btn-hold"/>
      <circle cx="259" cy="139" r="8" class="estop-ring"/>
      <circle cx="259" cy="139" r="5.4" class="estop"/>
      <rect x="216" y="152" width="54" height="13" rx="2" class="plate"/>
      <text x="243" y="161.4" class="plate-text" text-anchor="middle" [attr.font-size]="code.length > 9 ? 6 : 7.5">{{ code }}</text>

      <!-- base -->
      <rect x="10" y="184" width="280" height="12" rx="3" class="base" [attr.fill]="url('dark')"/>
      <line *ngFor="let v of vents" [attr.x1]="v" y1="188" [attr.x2]="v + 16" y2="188" class="vent"/>
      <line *ngFor="let v of vents" [attr.x1]="v" y1="192" [attr.x2]="v + 16" y2="192" class="vent"/>
    </g>
  </svg>
  <div class="offline-tag" *ngIf="offline"><span>{{ status === 'OFFLINE' ? 'DISCONNECTED' : 'NO DATA YET' }}</span></div>
  `,
  styles: [`
    :host { display: block; position: relative; width: 100%; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .drawing { transition: filter .4s, opacity .4s; }
    :host(.st-OFFLINE) .drawing, :host(.st-UNKNOWN) .drawing { filter: grayscale(1); opacity: .5; }
    .offline-tag { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
    .offline-tag span {
      display: inline-flex; align-items: center; gap: .4rem; padding: .3rem .75rem; border-radius: 999px;
      background: rgba(30, 32, 44, .82); color: #fff; font-size: .72rem; font-weight: 800; letter-spacing: .08em;
    }

    .shadow { fill: rgba(0, 0, 0, .13); }
    .pole { fill: var(--frame-dark); }
    .lamp { fill: #3a3f4b; transition: fill .3s; }
    .lamp.red.on { fill: #ff3b3b; animation: blink 1s steps(2, jump-none) infinite; }
    .lamp.amber.on { fill: #ffb81c; }
    .lamp.green.on { fill: #2fe02f; }
    .frame { stroke: var(--frame-dark); stroke-width: .8; }
    .roof { fill: var(--accent, #5b3df5); transition: fill .4s; }
    .roof-edge { fill: rgba(0, 0, 0, .12); }
    .worklight { opacity: 0; transition: opacity .6s; }
    :host(.st-RUNNING) .worklight, :host(.st-IDLE) .worklight { opacity: 1; }
    .column { fill: #2e4865; }
    .rail { fill: #5d7896; }
    .saddle { fill: #25405c; }
    .table { fill: #8fa2b8; }
    .slot { stroke: #5f738a; stroke-width: 1.4; stroke-dasharray: 5 4; }
    .vise { fill: #4a5d73; }
    .work { fill: #d9e1ea; stroke: #9aa9ba; stroke-width: .6; }
    .cut-mark { stroke: #fff; stroke-width: 1; opacity: .75; }
    .motor { fill: #6f839a; }
    .head { fill: #b8c6d6; stroke: #7d90a6; stroke-width: .6; }
    .head-line { fill: var(--accent, #5b3df5); opacity: .85; }
    .nose { fill: #7f92a8; }
    .holder { fill: #56687d; }
    .tool { fill: #e3e8ee; }
    .flute { stroke: #8a97a6; stroke-width: 1.3; }
    .hose { fill: none; stroke: #e0a64b; stroke-width: 2.2; stroke-linecap: round; }
    .coolant { fill: none; stroke: #6cd0ff; stroke-width: 1.6; stroke-dasharray: 2 2.6; stroke-linecap: round; opacity: 0; }
    .chip { fill: #e9c46a; opacity: 0; transform-box: fill-box; transform-origin: center; }
    .chip:nth-child(even) { fill: #dfe6ee; }
    .alarm-flash { fill: #ff3030; opacity: 0; pointer-events: none; }
    .glass { stroke: var(--glass-line); stroke-width: 1; }
    .reflect { fill: #ffffff; opacity: .1; pointer-events: none; }
    .reflect.thin { opacity: .06; }
    .door-frame { fill: none; stroke: var(--frame-dark); stroke-width: 1.6; }
    .door-split { stroke: var(--frame-dark); stroke-width: 1.2; opacity: .8; }
    .handle { fill: var(--steel-4); }
    .panel { fill: var(--steel-1); stroke: var(--frame-dark); stroke-width: .8; }
    .hmi { fill: var(--hmi); }
    .hmi-sub { fill: #8fa3bf; font-family: var(--font); font-size: 5.6px; font-weight: 700; letter-spacing: .08em; }
    .hmi-text { fill: var(--hmi-ink); font-family: var(--mono); font-weight: 700; }
    .hmi-caret { fill: var(--hmi-ink); opacity: 0; }
    .key { fill: var(--steel-3); }
    .btn-start { fill: #1fa31f; }
    .btn-hold { fill: #e7a51c; }
    .estop-ring { fill: #f2c200; }
    .estop { fill: #d42a2a; }
    .plate { fill: var(--hmi); }
    .plate-text { fill: #fff; font-family: var(--mono); font-weight: 700; letter-spacing: .04em; }
    .base { stroke: var(--frame-dark); stroke-width: .6; }
    .vent { stroke: var(--steel-3); stroke-width: 1.4; stroke-linecap: round; }

    /* motion: defined once, run only while the machine runs */
    .flutes { animation: turn .16s linear infinite; }
    .zaxis { animation: plunge 2.6s ease-in-out infinite; }
    .xaxis { animation: traverse 3.8s ease-in-out infinite alternate; }
    .coolant { animation: flow .45s linear infinite; }
    .chip { animation: fly .9s ease-out infinite; }
    .hmi-caret { animation: blink 1s steps(2, jump-none) infinite; }
    .mv { animation-play-state: paused; }
    :host(.st-RUNNING) .mv { animation-play-state: running; }
    :host(.st-RUNNING) .coolant { opacity: .9; }
    :host(.st-RUNNING) .hmi-caret { opacity: 1; }
    :host(.alarm) .alarm-flash { animation: flash 1.2s ease-in-out infinite; }
    :host(.offscreen) :is(.mv, .lamp, .alarm-flash) { animation-play-state: paused !important; }

    @keyframes turn { from { transform: translateX(0); } to { transform: translateX(-5px); } }
    @keyframes plunge { 0%, 100% { transform: translateY(0); } 45%, 60% { transform: translateY(6px); } }
    @keyframes traverse { from { transform: translateX(-16px); } to { transform: translateX(16px); } }
    @keyframes flow { to { stroke-dashoffset: -9.2; } }
    @keyframes fly {
      0% { transform: translate(0, 0) rotate(0); opacity: 0; }
      12% { opacity: 1; }
      100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; }
    }
    @keyframes flash { 0%, 100% { opacity: 0; } 50% { opacity: .28; } }
    @keyframes blink { 50% { opacity: .25; } }
    @media (prefers-reduced-motion: reduce) {
      :is(.mv, .lamp, .alarm-flash) { animation: none !important; }
    }
  `]
})
export class CncMachineComponent implements AfterViewInit, OnDestroy {
  /** RUNNING, IDLE, ALARM, OFFLINE or anything else (drawn as not yet reporting). */
  @Input() status: string | null | undefined = 'UNKNOWN';
  /** The alarm flag, kept apart from the status: a machine can run with an alarm on. */
  @Input() alarm = false;
  @Input() code = '';
  /** Spindle load in % (shown on the HMI when known). */
  @Input() load: number | null | undefined = null;
  /** Parts made (shown on the HMI when there is no load reading). */
  @Input() parts: number | null | undefined = null;
  @Input() label = '';

  private readonly prefix = `cnc${++uid}-`;
  private observer?: IntersectionObserver;
  private visible = true;

  readonly flutes = [96, 101, 106, 111, 116, 121, 126];
  readonly vents = [24, 48, 72, 208, 232, 256];
  readonly keys = [216, 229, 242, 255].flatMap(x => [102, 110, 118].map(y => ({ x: x + 1, y }))).filter((_, i) => i < 12);
  readonly chips = [
    { dx: -26, dy: -18, r: 240, delay: 0 },   { dx: 22, dy: -22, r: -200, delay: .15 },
    { dx: -34, dy: -6, r: 300, delay: .3 },   { dx: 30, dy: -10, r: -260, delay: .45 },
    { dx: -14, dy: -26, r: 180, delay: .6 },  { dx: 16, dy: -28, r: -150, delay: .75 },
  ];

  constructor(private el: ElementRef<HTMLElement>, private cdr: ChangeDetectorRef) {}

  get state(): string {
    const s = String(this.status || '').toUpperCase();
    return ['RUNNING', 'IDLE', 'ALARM', 'OFFLINE'].includes(s) ? s : 'UNKNOWN';
  }
  get offline(): boolean { return this.state === 'OFFLINE' || this.state === 'UNKNOWN'; }
  get inAlarm(): boolean { return this.alarm || this.state === 'ALARM'; }
  get lamp(): 'red' | 'amber' | 'green' | null {
    if (this.inAlarm) return 'red';
    if (this.state === 'RUNNING') return 'green';
    if (this.state === 'IDLE') return 'amber';
    return null;
  }

  @HostBinding('class') get hostClass(): string {
    return `cnc st-${this.state}${this.inAlarm ? ' alarm' : ''}${this.visible ? '' : ' offscreen'}`;
  }

  /** What the HMI's big figure is: the spindle load when known, else the part count. */
  private get showing(): 'LOAD' | 'PARTS' | null {
    if (this.load !== null && this.load !== undefined && Number.isFinite(Number(this.load))) return 'LOAD';
    if (this.parts !== null && this.parts !== undefined && Number.isFinite(Number(this.parts))) return 'PARTS';
    return null;
  }
  get hmiLabel(): string {
    const word = this.inAlarm ? 'ALARM'
      : ({ RUNNING: 'RUN', IDLE: 'IDLE', OFFLINE: 'OFFLINE' } as Record<string, string>)[this.state] || 'NO DATA';
    const showing = this.showing;
    return showing && word !== 'OFFLINE' && word !== 'NO DATA' ? `${word} · ${showing}` : word;
  }
  get hmiValue(): string {
    if (this.showing === 'LOAD') return `${Math.round(Number(this.load))}%`;
    if (this.showing === 'PARTS') return String(Math.round(Number(this.parts)));
    return this.state === 'RUNNING' ? 'RUN' : '--';
  }
  get ariaLabel(): string {
    const word = this.inAlarm ? 'in alarm' : ({ RUNNING: 'running', IDLE: 'idle', OFFLINE: 'offline' } as Record<string, string>)[this.state] || 'not reporting';
    return this.label || `${this.code || 'Machine'} ${word}`;
  }

  id(name: string): string { return this.prefix + name; }
  url(name: string): string { return `url(#${this.prefix + name})`; }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting === this.visible) return;
      this.visible = entry.isIntersecting;
      this.cdr.markForCheck();
    }, { rootMargin: '120px' });
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void { this.observer?.disconnect(); }
}
