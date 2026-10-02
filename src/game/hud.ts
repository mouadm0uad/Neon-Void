/** Canvas HUD, drawn in CSS pixels on top of the post-processed frame. */
import type { Input } from '../engine/input';
import { TAU, clamp, easeOutBack } from '../engine/math';
import { C, PLAYER, rgb } from './config';
import { t } from './i18n';
import { drawShip } from './shapes';
import type { World } from './world';

const FONT = 'Orbitron, system-ui, sans-serif';
const SCORE_PULSE = 1.0;

export interface HudOptions {
  best: number;
  showFps: boolean;
  fps: number;
  playing: boolean;
}

export function drawHud(g: CanvasRenderingContext2D, w: World, input: Input, W: number, H: number, o: HudOptions): void {
  g.save();
  g.globalCompositeOperation = 'source-over';
  const s = clamp(Math.min(W, H) / 800, 0.6, 1.3);
  const pad = 20 * s;

  if (o.playing && !w.attract) {
    g.textBaseline = 'top';
    g.shadowBlur = 12;

    // Score + multiplier.
    g.textAlign = 'left';
    g.shadowColor = rgb(C.Cyan);
    g.fillStyle = rgb(C.Cyan, 0.75);
    g.font = `600 ${11 * s}px ${FONT}`;
    g.fillText(t('score').toUpperCase(), pad, pad);
    g.fillStyle = '#fff';
    g.font = `800 ${30 * s}px ${FONT}`;
    g.fillText(w.score.toLocaleString(), pad, pad + 14 * s);
    g.shadowColor = rgb(C.Green);
    g.fillStyle = rgb(C.Green);
    g.font = `700 ${18 * s}px ${FONT}`;
    g.fillText(`×${w.mult}`, pad, pad + 50 * s);
    // Shard wallet (spent in the upgrade bay).
    g.shadowColor = rgb(C.Gold);
    g.fillStyle = rgb(C.Gold, 0.95);
    g.font = `600 ${13 * s}px ${FONT}`;
    g.fillText(`◆ ${w.credits.toLocaleString()}`, pad, pad + 74 * s);
    if (w.combo >= 5) {
      const pulse = 1 + Math.max(0, w.comboT - SCORE_PULSE) * 0.4;
      g.fillStyle = rgb(C.Gold, clamp(w.comboT, 0, 1));
      g.shadowColor = rgb(C.Gold);
      g.font = `700 ${14 * s * pulse}px ${FONT}`;
      g.fillText(`${w.combo} COMBO`, pad + 70 * s, pad + 54 * s);
    }

    // Best + lives + bombs.
    g.textAlign = 'right';
    g.shadowColor = rgb(C.Magenta);
    g.fillStyle = rgb(C.Magenta, 0.8);
    g.font = `600 ${11 * s}px ${FONT}`;
    g.fillText(t('best').toUpperCase(), W - pad, pad);
    g.fillStyle = '#fff';
    g.font = `700 ${18 * s}px ${FONT}`;
    g.fillText(Math.max(o.best, w.score).toLocaleString(), W - pad, pad + 14 * s);
    g.shadowBlur = 0;

    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < Math.min(w.lives, 8); i++) {
      drawShip(g, W - pad - 12 * s - i * 28 * s, pad + 52 * s, -Math.PI / 2, C.Cyan, 1, 0.75 * s);
    }
    for (let i = 0; i < Math.min(w.bombs, 9); i++) {
      g.beginPath();
      g.arc(W - pad - 10 * s - i * 22 * s, pad + 82 * s, 7 * s, 0, TAU);
      g.strokeStyle = rgb(C.Magenta);
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(W - pad - 10 * s - i * 22 * s, pad + 82 * s, 3 * s, 0, TAU);
      g.fillStyle = rgb(C.Magenta);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // Wave label.
    g.textAlign = 'center';
    g.fillStyle = rgb(C.Violet, 0.85);
    g.font = `600 ${12 * s}px ${FONT}`;
    g.fillText(`${t('wave').toUpperCase()} ${w.wave}`, W / 2, pad);

    // Boss bar.
    if (w.boss) {
      const bw = Math.min(520 * s, W - 220 * s);
      const x = W / 2 - bw / 2;
      const y = pad + 22 * s;
      const f = w.boss.hp / w.boss.maxHp;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x, y, bw, 8 * s);
      const grad = g.createLinearGradient(x, 0, x + bw, 0);
      grad.addColorStop(0, rgb(C.Red));
      grad.addColorStop(0.5, rgb(C.Magenta));
      grad.addColorStop(1, rgb(C.Gold));
      g.fillStyle = grad;
      g.shadowBlur = 14;
      g.shadowColor = rgb(C.Magenta);
      g.fillRect(x, y, bw * f, 8 * s);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      for (const m of [1 / 3, 2 / 3]) g.fillRect(x + bw * m - 1, y - 2, 2, 12 * s);
      g.fillStyle = '#fff';
      g.font = `700 ${11 * s}px ${FONT}`;
      g.fillText(`${t('bossName')} · MK ${w.boss.tier}`, W / 2, y + 14 * s);
    }

    // Bottom-left: weapon & timed power-ups.
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    const by = H - pad;
    for (let i = 0; i < PLAYER.maxWeapon; i++) {
      g.fillStyle = i < w.weapon ? rgb(C.Gold) : 'rgba(255,255,255,0.12)';
      g.fillRect(pad + i * 16 * s, by - 10 * s, 12 * s, 10 * s);
    }
    g.fillStyle = rgb(C.Gold, 0.8);
    g.font = `600 ${10 * s}px ${FONT}`;
    g.fillText('WPN', pad, by - 14 * s);
    let row = 0;
    const timer = (label: string, v: number, max: number, col: number): void => {
      const y = by - 36 * s - row * 18 * s;
      g.fillStyle = rgb(col, 0.9);
      g.fillText(label, pad, y);
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(pad + 92 * s, y - 8 * s, 80 * s, 5 * s);
      g.fillStyle = rgb(col);
      g.fillRect(pad + 92 * s, y - 8 * s, 80 * s * (v / max), 5 * s);
      row++;
    };
    if (w.rapidT > 0) timer(t('pickupRapid').toUpperCase(), w.rapidT, 9, C.Orange);
    if (w.magnetT > 0) timer(t('pickupMagnet').toUpperCase(), w.magnetT, 10, C.Violet);
    if (w.shield) {
      g.fillStyle = rgb(C.Cyan);
      g.fillText(t('pickupShield').toUpperCase(), pad, by - 36 * s - row * 18 * s);
    }
    // Dash cooldown ring near bottom-left.
    const dashReady = w.dashCd <= 0;
    g.beginPath();
    g.arc(pad + 108 * s, by - 5 * s, 7 * s, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - w.dashCd / PLAYER.dashCooldown));
    g.strokeStyle = dashReady ? rgb(C.Cyan) : 'rgba(255,255,255,0.35)';
    g.lineWidth = 2.5;
    g.stroke();
  }

  // Wave / boss banner.
  if (w.banner && o.playing) {
    const b = w.banner;
    const inT = clamp(b.t / 0.4, 0, 1);
    const outT = clamp((b.t - 2.1) / 0.5, 0, 1);
    const a = inT * (1 - outT);
    const sc = easeOutBack(inT) * (1 + outT * 0.3);
    g.save();
    g.translate(W / 2, H * 0.36);
    g.scale(sc, sc);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowBlur = 30;
    g.shadowColor = rgb(b.color);
    g.fillStyle = rgb(b.color, a);
    g.font = `900 ${48 * s}px ${FONT}`;
    g.fillText(b.text.toUpperCase(), 0, 0);
    if (b.sub) {
      g.font = `700 ${20 * s}px ${FONT}`;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillText(b.sub, 0, 44 * s);
    }
    g.restore();
  }

  // Touch sticks.
  if (o.playing && input.state.device === 'touch') {
    const { left, right } = input.touchSticks;
    for (const st of [left, right]) {
      if (!st) continue;
      g.beginPath();
      g.arc(st.ox, st.oy, input.stickRadius, 0, TAU);
      g.strokeStyle = 'rgba(0,240,255,0.35)';
      g.lineWidth = 2;
      g.stroke();
      const dx = st.x - st.ox;
      const dy = st.y - st.oy;
      const d = Math.hypot(dx, dy);
      const k = d > input.stickRadius ? input.stickRadius / d : 1;
      g.beginPath();
      g.arc(st.ox + dx * k, st.oy + dy * k, 22, 0, TAU);
      g.fillStyle = 'rgba(0,240,255,0.35)';
      g.fill();
    }
  }

  // Crosshair.
  if (o.playing && !w.attract && input.state.device === 'keyboard') {
    const { mouseX: mx, mouseY: my } = input.state;
    g.strokeStyle = rgb(C.Cyan, 0.9);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(mx, my, 9, 0, TAU);
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      g.moveTo(mx + ax * 5, my + ay * 5);
      g.lineTo(mx + ax * 14, my + ay * 14);
    }
    g.stroke();
  }

  if (o.showFps) {
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(180,255,200,0.85)';
    g.font = `500 11px ui-monospace, monospace`;
    g.fillText(`${o.fps} FPS · ${w.particles.count} particles · ${w.activeEnemyCount} enemies`, W - 12, H - 10);
  }
  g.restore();
}

