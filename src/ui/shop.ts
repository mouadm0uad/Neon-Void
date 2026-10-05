/** Upgrade bay screen: 4 rolled upgrade offers, fixed supplies, reroll, launch. */
import type { AudioEngine } from '../engine/audio';
import { Rng } from '../engine/rng';
import { PALETTE } from '../game/config';
import { fmt, t } from '../game/i18n';
import { CONSUMABLE_IDS, UPGRADES, cost, isMaxed, rerollCost, rollOffers, type UpgradeId } from '../game/upgrades';
import type { World } from '../game/world';

const css = (i: number): string => `rgb(${PALETTE[i]!.join(',')})`;

export class ShopUI {
  private offers: UpgradeId[] = [];
  private rerolls = 0;
  private nextWave = 1;
  private rng = new Rng();
  private onClose: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    private readonly audio: AudioEngine,
  ) {
    root.querySelector('#shop-reroll')!.addEventListener('click', () => this.reroll());
    root.querySelector('#shop-continue')!.addEventListener('click', () => {
      this.audio.play('wave');
      this.onClose?.();
    });
  }

  open(nextWave: number, onClose: () => void): void {
    this.nextWave = nextWave;
    this.onClose = onClose;
    this.rerolls = 0;
    this.offers = rollOffers(this.rng, this.world.levels, 4);
    this.render(true);
  }

  /** Re-render text (e.g. after a language change). */
  refresh(): void {
    if (this.offers.length || !this.root.hidden) this.render();
  }

  private reroll(): void {
    const price = rerollCost(this.rerolls);
    if (this.world.credits < price) return this.deny();
    this.world.credits -= price;
    this.rerolls++;
    this.offers = rollOffers(this.rng, this.world.levels, 4, this.offers);
    this.audio.play('select');
    this.render(true);
  }

  private deny(): void {
    this.audio.play('deny');
    const w = this.root.querySelector<HTMLElement>('.wallet')!;
    w.classList.remove('shake');
    void w.offsetWidth; // restart animation
    w.classList.add('shake');
  }

  private buy(id: UpgradeId): void {
    if (!this.world.buy(id)) return this.deny();
    this.audio.play('buy');
    this.render();
    this.root.querySelector(`[data-upgrade="${id}"]`)?.classList.add('bought');
  }

  private card(id: UpgradeId): HTMLButtonElement {
    const u = UPGRADES[id];
    const lv = this.world.levels[id];
    const maxed = isMaxed(id, this.world.levels);
    const price = cost(id, this.world.levels);
    const affordable = this.world.credits >= price;
    const b = document.createElement('button');
    b.className = 'card';
    b.dataset.upgrade = id;
    b.style.setProperty('--c', css(u.color));
    b.disabled = maxed;
    if (!affordable && !maxed) b.classList.add('poor');
    const pips = u.consumable
      ? `<span class="lv">${lv > 0 ? '×' + lv : ''}</span>`
      : `<span class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`;
    b.innerHTML = `
      <span class="glyph" aria-hidden="true">${u.glyph}</span>
      <span class="name">${t(u.name)}</span>
      <span class="desc">${t(u.desc)}</span>
      ${pips}
      <span class="price">${maxed ? t('maxed') : `◆ ${price}`}</span>`;
    b.setAttribute('aria-label', `${t(u.name)}. ${t(u.desc)}. ${maxed ? t('maxed') : price}`);
    b.addEventListener('click', () => this.buy(id));
    return b;
  }

  private render(rolled = false): void {
    const r = this.root;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.upgrade;
    const focusedBtn = document.activeElement?.id;
    r.querySelector('#shop-credits')!.textContent = fmt(this.world.credits);
    const offers = r.querySelector('#shop-offers')!;
    offers.replaceChildren(...this.offers.map((id) => this.card(id)));
    offers.classList.remove('rolled');
    if (rolled) {
      void (offers as HTMLElement).offsetWidth;
      offers.classList.add('rolled');
    }
    r.querySelector('#shop-supplies')!.replaceChildren(...CONSUMABLE_IDS.map((id) => this.card(id)));
    const rr = r.querySelector<HTMLButtonElement>('#shop-reroll')!;
    rr.textContent = t('reroll', { c: rerollCost(this.rerolls) });
    rr.classList.toggle('poor', this.world.credits < rerollCost(this.rerolls));
    r.querySelector('#shop-continue')!.textContent = t('continueRun', { n: this.nextWave });

    // Loadout summary.
    const owned = (Object.keys(UPGRADES) as UpgradeId[]).filter((id) => !UPGRADES[id].consumable && this.world.levels[id] > 0);
    r.querySelector('#shop-owned')!.innerHTML = owned
      .map(
        (id) =>
          `<span class="chip" style="--c:${css(UPGRADES[id].color)}">${UPGRADES[id].glyph} ${t(UPGRADES[id].name)} · ${this.world.levels[id]}</span>`,
      )
      .join('');

    // Keep focus stable across re-renders (keyboard / gamepad users).
    const target =
      (focusedId && r.querySelector<HTMLElement>(`[data-upgrade="${focusedId}"]:not([disabled])`)) ||
      (focusedBtn && r.querySelector<HTMLElement>(`#${focusedBtn}`)) ||
      null;
    if (target) target.focus({ preventScroll: true });
    else if (focusedId) r.querySelector<HTMLElement>('#shop-continue')!.focus({ preventScroll: true });
  }
}
