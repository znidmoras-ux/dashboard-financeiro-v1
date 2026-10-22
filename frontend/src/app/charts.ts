import { Component, computed, input, signal } from '@angular/core';

export const brl = (v: number, d = 2) => 'R$ ' + (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const compact = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  return a >= 1000 ? s + (a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : s + a.toFixed(0);
};
export function nice(max: number, ticks = 4) {
  if (max <= 0) return { max: 1, step: 0.25 };
  const raw = max / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  return { max: Math.ceil(max / step) * step, step };
}

export interface Serie { name: string; color: string; values: number[]; colors?: string[]; dashed?: boolean; }
export interface Ref { label: string; value: number; color: string; }

const W = 640, H = 240, L = 46, R = 12, T = 14, B = 28;

@Component({
  selector: 'app-columns',
  standalone: true,
  template: `
  <div class="chart" (mouseleave)="hover.set(-1)">
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="label()">
      @for (t of ticks(); track t) {
        <line [attr.x1]="L" [attr.x2]="W - R" [attr.y1]="y(t)" [attr.y2]="y(t)" class="gl" [class.zero]="t === 0"/>
        <text [attr.x]="L - 6" [attr.y]="y(t) + 4" class="tick" text-anchor="end">{{ fmtTick(t) }}</text>
      }
      @for (r of refs(); track r.label) {
        <line [attr.x1]="L" [attr.x2]="W - R" [attr.y1]="y(r.value)" [attr.y2]="y(r.value)" [attr.stroke]="r.color" stroke-width="1.5" stroke-dasharray="5 4"/>
        <text [attr.x]="W - R" [attr.y]="y(r.value) - 5" text-anchor="end" class="reflabel" [attr.fill]="r.color">{{ r.label }}</text>
      }
      @for (l of labels(); track $index; let i = $index) {
        @if (hover() === i) { <rect [attr.x]="x0(i)" [attr.y]="T" [attr.width]="band()" [attr.height]="H - T - B" class="hl"/> }
        @for (s of series(); track s.name; let j = $index) {
          <path [attr.d]="bar(i, j, s.values[i])" [attr.fill]="s.colors ? s.colors[i] : s.color"/>
        }
        @if (showLabel(i)) { <text [attr.x]="x0(i) + band() / 2" [attr.y]="H - 9" class="tick" text-anchor="middle">{{ l }}</text> }
        <rect [attr.x]="x0(i)" [attr.y]="T" [attr.width]="band()" [attr.height]="H - T - B" fill="transparent" (mouseenter)="hover.set(i)" (touchstart)="hover.set(i)"/>
      }
    </svg>
    @if (hover() >= 0) {
      <div class="tip" [style.left.%]="(x0(hover()) + band() / 2) / W * 100" [class.flip]="(x0(hover()) + band() / 2) / W > .6">
        <b>{{ tipTitle()(hover()) }}</b>
        @for (s of series(); track s.name) {
          <span><i [style.background]="s.color"></i>{{ s.name }} <em>{{ fmt()(s.values[hover()]) }}</em></span>
        }
      </div>
    }
  </div>
  @if (series().length > 1) {
    <div class="legend">@for (s of series(); track s.name) { <span><i [style.background]="s.color"></i>{{ s.name }}</span> }</div>
  }`,
})
export class ColumnsChart {
  labels = input<string[]>([]); series = input<Serie[]>([]); refs = input<Ref[]>([]); label = input('Gráfico de colunas');
  fmt = input<(v: number) => string>(brl); title = input<((i: number) => string) | null>(null);
  hover = signal(-1);
  W = W; H = H; L = L; R = R; T = T; B = B;
  scale = computed(() => {
    const vals = this.series().flatMap(s => s.values).concat(this.refs().map(r => r.value));
    const mx = Math.max(0, ...vals), mn = Math.min(0, ...vals);
    const n = nice(Math.max(mx, -mn));
    return { max: mx > 0 ? n.max : 0, min: mn < 0 ? -n.max : 0, step: n.step };
  });
  ticks = computed(() => { const s = this.scale(), t: number[] = []; for (let v = s.min; v <= s.max + 1e-9; v += s.step) t.push(Math.round(v * 100) / 100); return t; });
  fmtTick = (t: number) => compact(t);
  y = (v: number) => { const s = this.scale(); const r = (s.max - s.min) || 1; return T + (s.max - v) / r * (H - T - B); };
  band = computed(() => (W - L - R) / Math.max(1, this.labels().length));
  x0 = (i: number) => L + i * this.band();
  tipTitle = computed(() => this.title() ?? ((i: number) => this.labels()[i]));
  showLabel = (i: number) => this.labels().length <= 14 || i % 2 === 0;
  bar(i: number, j: number, v: number) {
    const n = this.series().length, bw = this.band(), gap = Math.min(10, bw * .25), gw = bw - gap, w = Math.min(34, (gw - (n - 1) * 3) / n);
    const x = this.x0(i) + (bw - (n * w + (n - 1) * 3)) / 2 + j * (w + 3);
    const y0 = this.y(0), y1 = this.y(v); if (Math.abs(y0 - y1) < .5) return '';
    const top = Math.min(y0, y1), h = Math.abs(y0 - y1), r = Math.min(4, w / 2, h);
    return v >= 0 ? `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`
      : `M${x},${y0}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + w - r}Q${x + w},${top + h} ${x + w},${top + h - r}V${y0}Z`;
  }
}

@Component({
  selector: 'app-donut',
  standalone: true,
  template: `
  <div class="donut">
    <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="label()">
      <circle cx="60" cy="60" r="46" fill="none" class="donut-bg" stroke-width="16"/>
      @for (a of arcs(); track a.k) {
        <circle cx="60" cy="60" r="46" fill="none" [attr.stroke]="a.color" stroke-width="16" [attr.stroke-dasharray]="a.dash" [attr.stroke-dashoffset]="a.off" transform="rotate(-90 60 60)" (mouseenter)="hover.set(a.k)" (mouseleave)="hover.set('')" [attr.opacity]="hover() && hover() !== a.k ? .35 : 1"/>
      }
      <text x="60" y="56" text-anchor="middle" class="d-top">{{ hover() ? hover() : centerTop() }}</text>
      <text x="60" y="72" text-anchor="middle" class="d-val">{{ hover() ? fmt()(valueOf(hover())) : centerValue() }}</text>
    </svg>
    <ul>
      @for (a of arcs(); track a.k) {
        <li (mouseenter)="hover.set(a.k)" (mouseleave)="hover.set('')"><i [style.background]="a.color"></i><span>{{ a.k }}</span><em>{{ fmt()(a.v) }}</em><small>{{ a.pct }}%</small></li>
      }
    </ul>
  </div>`,
})
export class DonutChart {
  items = input<{ k: string; v: number }[]>([]); colors = input<string[]>([]); label = input('Gráfico de rosca');
  centerTop = input('Total'); centerValue = input(''); fmt = input<(v: number) => string>(brl);
  hover = signal('');
  valueOf = (k: string) => this.items().find(i => i.k === k)?.v ?? 0;
  arcs = computed(() => {
    const tot = this.items().reduce((a, b) => a + b.v, 0) || 1, C = 2 * Math.PI * 46; let acc = 0;
    return this.items().map((i, idx) => {
      const len = i.v / tot * C, gap = this.items().length > 1 ? 2 : 0;
      const o = { k: i.k, v: i.v, color: this.colors()[idx % this.colors().length], dash: `${Math.max(0, len - gap)} ${C}`, off: -acc, pct: (i.v / tot * 100).toFixed(0) };
      acc += len; return o;
    });
  });
}
