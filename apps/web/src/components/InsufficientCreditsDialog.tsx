// Insufficient-credits upgrade flow.
//
// Triggered when credits run out mid-use. Branches on the current plan:
//  - below 团队版: offer the upgrade tiers reachable from here, priced as a
//    pro-rated top-up ("按当前已使用天数补差价"); 确认支付 → upgrade takes effect.
//  - 团队版 (top tier): no higher tier — offer Token / 积分包 purchases instead.
// Demo-only: no real billing.

import { useState } from 'react';
import { Icon } from './Icon';
import type { DemoPlan } from './DemoControlBar';

type BillingCycle = 'annual' | 'monthly';

interface TierOption {
  plan: DemoPlan;
  label: string;
  desc: string;
  /** Per-month price (¥), billed monthly. */
  monthly: number;
  /** Per-month price (¥) when billed annually. */
  annual: number;
}

const PLUS: TierOption = { plan: 'plus', label: '个人版 Plus', desc: '基础 Token 用量 · SOTA 模型', monthly: 39, annual: 29 };
const PRO: TierOption = { plan: 'pro', label: '个人版 Pro', desc: '3 倍 Token 用量 · 顶级多模态', monthly: 99, annual: 79 };
const MAX: TierOption = { plan: 'max', label: '个人版 Max', desc: '10 倍 Token 用量 · 顶级多模态', monthly: 199, annual: 159 };
const TEAM: TierOption = { plan: 'team', label: '团队版', desc: '多人协作 · 资产共享 · 角色权限', monthly: 119, annual: 99 };

// Tiers reachable from each plan, in order. 团队版 has none (top tier).
const UPGRADE_TARGETS: Record<DemoPlan, TierOption[]> = {
  free: [PLUS, PRO, MAX, TEAM],
  plus: [PRO, MAX, TEAM],
  pro: [MAX, TEAM],
  max: [TEAM],
  team: [],
};

const CREDIT_PACKS = [
  { id: 'pack-s', label: '5,000 积分包', price: '¥39' },
  { id: 'pack-m', label: '20,000 积分包', price: '¥129' },
  { id: 'pack-l', label: '50,000 积分包', price: '¥289' },
];

interface Props {
  open: boolean;
  plan: DemoPlan;
  onClose: () => void;
  /** Confirmed an upgrade to a higher tier. */
  onUpgrade: (target: DemoPlan) => void;
  /** Confirmed a Token / credit-pack purchase (team tier). */
  onBuyPack: (packLabel: string) => void;
}

export function InsufficientCreditsDialog({ open, plan, onClose, onUpgrade, onBuyPack }: Props) {
  const targets = UPGRADE_TARGETS[plan];
  const isTopTier = targets.length === 0;

  const [selectedTier, setSelectedTier] = useState<DemoPlan>(targets[0]?.plan ?? 'team');
  const [selectedPack, setSelectedPack] = useState<string>(CREDIT_PACKS[0]!.id);
  // Billing cycle for tier upgrades — defaults to annual (年付).
  const [cycle, setCycle] = useState<BillingCycle>('annual');

  if (!open) return null;

  return (
    <div className="entry-invite" role="dialog" aria-modal="true" aria-label="积分不足">
      <div className="entry-invite__backdrop" onClick={onClose} />
      <div className="credit-upgrade">
        <button type="button" className="entry-invite__close" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={16} />
        </button>

        <div className="credit-upgrade__badge" aria-hidden>
          <Icon name="sparkles" size={20} />
        </div>
        <h2 className="credit-upgrade__title">积分已用尽</h2>
        <p className="credit-upgrade__subtitle">
          {isTopTier
            ? '你已是团队版（最高版本），没有更高版本可升级。可按需购买 Token / 积分包继续使用。'
            : '继续使用需要更多积分。升级到更高版本可立即提升额度，费用按当前周期已使用天数补差价。'}
        </p>

        {isTopTier ? (
          <div className="credit-upgrade__options">
            {CREDIT_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                className={`credit-upgrade__option${selectedPack === pack.id ? ' is-active' : ''}`}
                onClick={() => setSelectedPack(pack.id)}
              >
                <span className="credit-upgrade__option-radio" aria-hidden />
                <span className="credit-upgrade__option-text">
                  <span className="credit-upgrade__option-label">{pack.label}</span>
                </span>
                <span className="credit-upgrade__option-price">{pack.price}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="credit-upgrade__options">
            <div className="credit-upgrade__cycle" role="tablist" aria-label="计费周期">
              <button
                type="button"
                role="tab"
                aria-selected={cycle === 'annual'}
                className={`credit-upgrade__cycle-tab${cycle === 'annual' ? ' is-active' : ''}`}
                onClick={() => setCycle('annual')}
              >
                年付 <span className="credit-upgrade__cycle-save">省 20%</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={cycle === 'monthly'}
                className={`credit-upgrade__cycle-tab${cycle === 'monthly' ? ' is-active' : ''}`}
                onClick={() => setCycle('monthly')}
              >
                月付
              </button>
            </div>
            {targets.map((tier) => {
              const price = cycle === 'annual' ? tier.annual : tier.monthly;
              const perSeat = tier.plan === 'team' ? '/席' : '';
              return (
                <button
                  key={tier.plan}
                  type="button"
                  className={`credit-upgrade__option${selectedTier === tier.plan ? ' is-active' : ''}`}
                  onClick={() => setSelectedTier(tier.plan)}
                >
                  <span className="credit-upgrade__option-radio" aria-hidden />
                  <span className="credit-upgrade__option-text">
                    <span className="credit-upgrade__option-label">{tier.label}</span>
                    <span className="credit-upgrade__option-desc">{tier.desc}</span>
                  </span>
                  <span className="credit-upgrade__option-price">
                    ¥{price}
                    <span className="credit-upgrade__option-unit">/月{perSeat}</span>
                  </span>
                </button>
              );
            })}
            <p className="credit-upgrade__prorate">
              <Icon name="info" size={13} />
              {cycle === 'annual' ? '按年付费，立省 20%；' : '按月付费；'}
              升级按当前周期已使用天数补差价，立即生效。
            </p>
          </div>
        )}

        <div className="credit-upgrade__foot">
          <button type="button" className="entry-invite__btn" onClick={onClose}>
            取消
          </button>
          {isTopTier ? (
            <button
              type="button"
              className="entry-invite__btn is-primary"
              onClick={() => onBuyPack(CREDIT_PACKS.find((p) => p.id === selectedPack)!.label)}
            >
              <Icon name="sparkles" size={14} /> 确认购买
            </button>
          ) : (
            <button
              type="button"
              className="entry-invite__btn is-primary"
              onClick={() => onUpgrade(selectedTier)}
            >
              <Icon name="sparkles" size={14} /> 确认支付并升级
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
