// Upgrade-to-team guidance dialog.
//
// Shown when a free-plan user tries to invite collaborators. Demo-only:
// surfaces the team-plan value props and a single upgrade CTA, no billing.

import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
  /** "升级到团队版" — defaults to onClose when omitted. */
  onConfirm?: () => void;
}

const TEAM_BENEFITS = [
  '资产共享与管理：项目 / 设计系统 / 插件',
  '协作：评论 / 变更 / 历史版本',
  '基于角色的权限管理（管理员 / 编辑者 / 查看者）',
  '团队用量面板与计费管理',
  '自定义网站部署域名',
];

export function UpgradeTeamDialog({ open, onClose, onConfirm }: Props) {
  if (!open) return null;

  return (
    <div className="entry-invite" role="dialog" aria-modal="true" aria-label="升级到团队版">
      <div className="entry-invite__backdrop" onClick={onClose} />
      <div className="upgrade-team">
        <button
          type="button"
          className="entry-invite__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="close" size={16} />
        </button>

        <div className="upgrade-team__badge" aria-hidden>
          <Icon name="share" size={20} />
        </div>
        <h2 className="upgrade-team__title">邀请协作者，先升级到团队版</h2>
        <p className="upgrade-team__subtitle">
          你当前使用的是免费版，仅含 1 个席位。升级到团队版即可邀请同事、共享资产并进行多人协作。
        </p>

        <ul className="upgrade-team__benefits">
          {TEAM_BENEFITS.map((b) => (
            <li key={b} className="upgrade-team__benefit">
              <span className="upgrade-team__check" aria-hidden>
                <Icon name="check" size={13} />
              </span>
              {b}
            </li>
          ))}
        </ul>

        <div className="upgrade-team__price">
          <span className="upgrade-team__price-label">团队版</span>
          <span className="upgrade-team__price-hint">3 个席位起，按席位计费</span>
        </div>

        <div className="upgrade-team__foot">
          <button type="button" className="entry-invite__btn" onClick={onClose}>
            暂不升级
          </button>
          <button type="button" className="entry-invite__btn is-primary" onClick={onConfirm ?? onClose}>
            <Icon name="sparkles" size={14} /> 升级到团队版
          </button>
        </div>
      </div>
    </div>
  );
}
